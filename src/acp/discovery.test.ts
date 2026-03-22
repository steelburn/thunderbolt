import { describe, expect, it } from 'bun:test'
import type { CommandExistsChecker } from './discovery'
import { discoverLocalAgents, knownCliAgents } from './discovery'

const noCommandsExist: CommandExistsChecker = async () => false
const allCommandsExist: CommandExistsChecker = async () => true

const onlyCommand = (target: string): CommandExistsChecker => {
  return async (command) => command === target
}

describe('discoverLocalAgents', () => {
  it('should return empty array when no commands are found', async () => {
    const agents = await discoverLocalAgents(noCommandsExist)
    expect(agents).toEqual([])
  })

  it('should discover all agents when all commands exist', async () => {
    const agents = await discoverLocalAgents(allCommandsExist)
    expect(agents).toHaveLength(knownCliAgents.length)
  })

  it('should discover only claude when only claude command exists', async () => {
    const agents = await discoverLocalAgents(onlyCommand('claude'))
    expect(agents).toHaveLength(1)
    expect(agents[0]?.name).toBe('Claude Code')
    expect(agents[0]?.command).toBe('claude')
  })

  it('should discover only codex when only codex command exists', async () => {
    const agents = await discoverLocalAgents(onlyCommand('codex'))
    expect(agents).toHaveLength(1)
    expect(agents[0]?.name).toBe('Codex')
    expect(agents[0]?.command).toBe('codex')
  })

  it('should discover only goose when only goose command exists', async () => {
    const agents = await discoverLocalAgents(onlyCommand('goose'))
    expect(agents).toHaveLength(1)
    expect(agents[0]?.name).toBe('Goose')
  })

  it('should return agents with correct type and transport', async () => {
    const agents = await discoverLocalAgents(allCommandsExist)
    for (const agent of agents) {
      expect(agent.type).toBe('local')
      expect(agent.transport).toBe('stdio')
    }
  })

  it('should return agents with deterministic IDs based on command name', async () => {
    const agents = await discoverLocalAgents(allCommandsExist)
    const claudeAgent = agents.find((a) => a.command === 'claude')
    expect(claudeAgent?.id).toBe('agent-local-claude')
  })

  it('should return agents marked as system and enabled', async () => {
    const agents = await discoverLocalAgents(allCommandsExist)
    for (const agent of agents) {
      expect(agent.isSystem).toBe(1)
      expect(agent.enabled).toBe(1)
    }
  })

  it('should return agents with args for ACP mode', async () => {
    const agents = await discoverLocalAgents(allCommandsExist)
    for (const agent of agents) {
      expect(agent.args).toBe('["--acp"]')
    }
  })

  it('should return agents with null url and authMethod', async () => {
    const agents = await discoverLocalAgents(allCommandsExist)
    for (const agent of agents) {
      expect(agent.url).toBeNull()
      expect(agent.authMethod).toBeNull()
    }
  })

  it('should handle multiple commands found', async () => {
    const checker: CommandExistsChecker = async (command) => command === 'claude' || command === 'goose'
    const agents = await discoverLocalAgents(checker)
    expect(agents).toHaveLength(2)
    expect(agents.map((a) => a.command)).toContain('claude')
    expect(agents.map((a) => a.command)).toContain('goose')
  })

  it('should handle commandExists throwing errors gracefully', async () => {
    const faultyChecker: CommandExistsChecker = async (command) => {
      if (command === 'codex') throw new Error('Command check failed')
      return command === 'claude'
    }

    // When commandExists throws, the individual promise rejects and
    // discoverLocalAgents propagates it (caller should handle)
    await expect(discoverLocalAgents(faultyChecker)).rejects.toThrow('Command check failed')
  })
})

describe('knownCliAgents', () => {
  it('should contain claude, codex, and goose', () => {
    const commands = knownCliAgents.map((a) => a.command)
    expect(commands).toContain('claude')
    expect(commands).toContain('codex')
    expect(commands).toContain('goose')
  })

  it('should have names for all entries', () => {
    for (const agent of knownCliAgents) {
      expect(agent.name).toBeTruthy()
    }
  })

  it('should have icons for all entries', () => {
    for (const agent of knownCliAgents) {
      expect(agent.icon).toBeTruthy()
    }
  })
})
