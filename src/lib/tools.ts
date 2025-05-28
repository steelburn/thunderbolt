import * as tasksTools from '@/extensions/tasks/tools'
import type { ToolConfig } from '@/types'
import { tool, type Tool } from 'ai'

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
    ...tools.reduce((acc, tool) => {
      acc[tool.name] = createTool(tool)
      return acc
    }, {} as Record<string, Tool>),
  }
}
