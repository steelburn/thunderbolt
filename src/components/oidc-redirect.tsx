import { useEffect, useState } from 'react'
import { http } from '@/lib/http'
import { useSettings } from '@/hooks/use-settings'
import Loading from '@/loading'

/** Validate that an OIDC redirect URL uses a safe protocol. */
export const validateOidcRedirectUrl = (rawUrl: string): URL => {
  const url = new URL(rawUrl)
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')))) {
    throw new Error('OIDC redirect must use HTTPS')
  }
  return url
}

/**
 * In OIDC mode, redirects unauthenticated users to the backend's OIDC sign-in endpoint,
 * which in turn redirects to the OIDC provider. The user never sees a login page on our app.
 */
const OidcRedirect = () => {
  const { cloudUrl } = useSettings({ cloud_url: String })
  const [error, setError] = useState<string | null>(null)

  // Legitimate useEffect: triggers an external navigation side-effect (redirect to OIDC provider)
  // that depends on an async setting value. Cannot be computed during render.
  useEffect(() => {
    if (cloudUrl.isLoading || !cloudUrl.value) {
      return
    }

    const abortController = new AbortController()
    const baseUrl = cloudUrl.value.replace(/\/v1$/, '')

    // Use credentials: 'include' so the browser stores Better Auth's OAuth state cookie.
    // Without it, the state cookie is lost and the callback fails with state_mismatch.
    const redirectToOidc = async () => {
      try {
        const data = await http
          .post(`${baseUrl}/v1/api/auth/sign-in/oauth2`, {
            json: { providerId: 'oidc', callbackURL: window.location.origin + '/' },
            credentials: 'include',
            signal: abortController.signal,
          })
          .json<{ url: string }>()

        const validatedUrl = validateOidcRedirectUrl(data.url)
        window.location.href = validatedUrl.href
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return
        }
        console.error('OIDC redirect failed:', err)
        setError('Failed to start authentication. Please try again or contact your administrator.')
      }
    }

    redirectToOidc()

    return () => abortController.abort()
  }, [cloudUrl.isLoading, cloudUrl.value])

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    )
  }

  return <Loading />
}

export default OidcRedirect
