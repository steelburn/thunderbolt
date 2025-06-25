import { getSetting } from '@/dal'
import * as tasksTools from '@/extensions/tasks/tools'
import { configs as googleConfigs } from '@/integrations/google/tools'
import { configs as microsoftConfigs } from '@/integrations/microsoft/tools'
import type { ToolConfig } from '@/types'
import { tool, type Tool } from 'ai'

export const getAvailableTools = async (): Promise<ToolConfig[]> => {
  const baseTools: ToolConfig[] = [...Object.values(tasksTools)]

  const googleEnabled = await getSetting('integrations_google_is_enabled')
  const microsoftEnabled = await getSetting('integrations_microsoft_is_enabled')

  if (googleEnabled === 'true') {
    baseTools.push(...googleConfigs)
  }

  if (microsoftEnabled === 'true') {
    baseTools.push(...microsoftConfigs)
  }

  return baseTools
}

export const tools = [...Object.values(tasksTools)]

export const createTool = (config: ToolConfig) => {
  return tool({
    description: config.description,
    parameters: config.parameters,
    execute: config.execute,
  })
}

export const createToolset = (tools: ToolConfig[]) => {
  return {
    ...tools.reduce(
      (acc, tool) => {
        acc[tool.name] = createTool(tool)
        return acc
      },
      {} as Record<string, Tool>,
    ),
  }
}
