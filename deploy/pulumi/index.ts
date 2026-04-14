import * as pulumi from '@pulumi/pulumi'
import { createVpc } from './src/vpc'
import { createEksCluster } from './src/eks'
import { createStorage } from './src/storage'
import { createCluster } from './src/cluster'
import { createServiceDiscovery } from './src/discovery'
import { createAlb } from './src/alb'
import { createServices } from './src/services'

const config = new pulumi.Config()
const stackName = pulumi.getStack()
const name = `tb-${stackName}`
const platform = config.get('platform') || 'fargate'
const version = config.require('version')

// All images are pre-built and published to GHCR by the enterprise-publish workflow
const imagePrefix = 'ghcr.io/thunderbird/thunderbolt'
const images = {
  frontend: `${imagePrefix}/thunderbolt-frontend:${version}`,
  backend: `${imagePrefix}/thunderbolt-backend:${version}`,
  postgres: `${imagePrefix}/thunderbolt-postgres:${version}`,
  keycloak: `${imagePrefix}/thunderbolt-keycloak:${version}`,
  powersync: `${imagePrefix}/thunderbolt-powersync:${version}`,
}

/**
 * Returns a Pulumi secret, falling back to a default only for sandbox stacks.
 * Production stacks must configure all secrets explicitly.
 */
const getSecretWithSandboxDefault = (key: string, sandboxDefault: string): pulumi.Output<string> => {
  const value = config.getSecret(key)
  if (value) return value

  if (stackName.includes('sandbox')) {
    pulumi.log.warn(`Using default value for '${key}' — only acceptable for sandbox stacks`)
    return pulumi.output(sandboxDefault)
  }

  return config.requireSecret(key)
}

// Secrets with sensible defaults for sandbox (override via `pulumi config set --secret`)
const secrets = {
  postgresPassword: getSecretWithSandboxDefault('postgresPassword', 'postgres'),
  keycloakAdminPassword: getSecretWithSandboxDefault('keycloakAdminPassword', 'admin'),
  oidcClientSecret: getSecretWithSandboxDefault('oidcClientSecret', 'thunderbolt-enterprise-secret'),
  powersyncJwtSecret: getSecretWithSandboxDefault('powersyncJwtSecret', 'enterprise-powersync-secret'),
  betterAuthSecret: getSecretWithSandboxDefault('betterAuthSecret', 'enterprise-better-auth-secret'),
  powersyncDbPassword: getSecretWithSandboxDefault('powersyncDbPassword', 'myhighlyrandompassword'),
}

// Shared: VPC (both platforms need this)
const { vpc, publicSubnets, privateSubnets, albSg, servicesSg } = createVpc(name)

if (platform === 'k8s') {
  // ---------- Kubernetes (EKS) ----------
  const appUrl = config.get('appUrl') || 'http://localhost'
  const { cluster } = createEksCluster({
    name,
    version,
    imagePrefix,
    appUrl,
    vpcId: vpc.id,
    publicSubnetIds: publicSubnets.map((s) => s.id),
    privateSubnetIds: privateSubnets.map((s) => s.id),
    ghcrToken: config.getSecret('ghcrToken'),
  })

  module.exports = {
    platform: 'k8s',
    kubeconfig: cluster.kubeconfigJson,
    note: 'Run: kubectl get svc -n ingress-nginx ingress-nginx-controller -o jsonpath="{.status.loadBalancer.ingress[0].hostname}" to get the URL',
    stackInfo: {
      name: stackName,
      destroy: `pulumi destroy -s ${stackName} -y`,
    },
  }
} else {
  // ---------- Fargate (ECS) ----------
  const storage = createStorage(
    name,
    vpc.id,
    privateSubnets.map((s) => s.id),
    servicesSg.id,
  )

  const { cluster, logGroup } = createCluster(name)
  const { services: discoveryServices } = createServiceDiscovery(name, vpc.id)

  const { alb, listener, frontendTg, backendTg, keycloakTg, powersyncTg } = createAlb({
    name,
    vpcId: vpc.id,
    publicSubnetIds: publicSubnets.map((s) => s.id),
    albSgId: albSg.id,
  })

  createServices({
    name,
    cluster,
    logGroup,
    privateSubnetIds: privateSubnets.map((s) => s.id),
    servicesSgId: servicesSg.id,
    efsId: storage.efs.id,
    pgAccessPointId: storage.pgAccessPoint.id,
    mongoAccessPointId: storage.mongoAccessPoint.id,
    images,
    secrets,
    ghcrToken: config.getSecret('ghcrToken'),
    albDnsName: alb.dnsName,
    albListener: listener,
    targetGroups: {
      frontend: frontendTg,
      backend: backendTg,
      keycloak: keycloakTg,
      powersync: powersyncTg,
    },
    discoveryServices,
  })

  module.exports = {
    platform: 'fargate',
    url: pulumi.interpolate`http://${alb.dnsName}`,
    keycloakAdmin: pulumi.interpolate`http://${alb.dnsName}/auth/admin`,
    stackInfo: {
      name: stackName,
      destroy: `pulumi destroy -s ${stackName} -y`,
    },
  }
}
