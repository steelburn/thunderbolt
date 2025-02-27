import { createOpenAI } from '@ai-sdk/openai'
import { invoke } from '@tauri-apps/api/core'
import { Message, streamText, tool, ToolInvocation } from 'ai'
import { z } from 'zod'

export type ToolInvocationWithResult<T = object> = ToolInvocation & {
  result: T
}

const user = {
  first_name: 'John',
  last_name: 'Doe',
  email: 'john.doe@example.com',
}

const p2 = `
    You are a helpful executive assistant that assists users with their email and calendar.
    
    The current date and time is ${new Date().toISOString()}.
  
    The current user is ${user.first_name} ${user.last_name} (${user.email}).
    
    Call the "search" tool once to search the user's inbox and contacts for relevant information.
    
    Some of these documents may not be relevant to the user's question. It is your job to read through the content of the results to decide if they are relevant.
    
    If none of the search results are relevant, that's ok, but you don't need to search again.
    
    If you are unable to answer the user's question based on the search results, just say so. Do not make up an answer.
    
    Call the "answer" tool to provide your final response to the user. Example:
    
    {
      "text": "I found several Postmark receipts in your inbox. Here are the details of the receipts:",
      "results": [
        {
          "id": "gmail/1234567890",
          "type": "message"
        },
        {
          "id": "gmail/1234567891",
          "type": "message"
        },
        {
          "id": "gmail/1234567892",
          "type": "thread"
        },
        {
          "id": "2026780c-8af3-4d02-91dc-36a62a7413e2",
          "type": "contact"
        }
      ]
    }
  
    Note: you need to include the "gmail/" prefix for message and thread ids.
    `

export const ollama = createOpenAI({
  baseURL: 'http://localhost:11434/v1',
  // compatibility: 'compatible',
  apiKey: 'ollama',
})

export const aiFetchStreamingResponse = async (_requestInfoOrUrl: RequestInfo | URL, init: RequestInit = {}) => {
  // _requestInfoOrUrl is not used, but is required by fetch. The OpenAI wrapper handles the URL For us.

  const apiKey = await invoke<string | undefined>('get_openai_api_key')

  if (!apiKey) {
    throw new Error('No OpenAI API key found')
  }

  const openai = createOpenAI({
    apiKey,
  })

  const options = init as RequestInit & { body: string }
  const body = JSON.parse(options.body)

  const { messages } = body as { messages: Message[] }

  const processedMessages = messages.map((message) => ({
    ...message,
    parts: message.parts?.map((part) => {
      if (part.type === 'tool-invocation' && !(part.toolInvocation as ToolInvocationWithResult).result) {
        return {
          ...part,
          toolInvocation: {
            ...part.toolInvocation,
            result: true,
          },
        }
      }
      return part
    }),
  }))

  const result = streamText({
    maxSteps: 5,
    // Currently llama is able to call the search tool, but it does not call the answer tool afterwards - need to debug why.
    // model: ollama('llama3.2:3b-instruct-q4_1', {
    //   structuredOutputs: true,
    // }),
    model: openai('gpt-4o', {
      structuredOutputs: true,
    }),
    system: p2,
    messages: processedMessages,
    toolCallStreaming: true, // Causes issues because this results in incomplete result objects getting passed to React components. Experimentation to block rendering until the full objects are available is needed.
    tools: {
      search: tool({
        description: "A tool for searching the user's inbox.",
        parameters: z.object({
          query: z.string().describe("The query to search the user's inbox with."),
          originalUserMessage: z.string().describe('The original user message that triggered this tool call.'),
        }),
        execute: async ({ query, originalUserMessage }) => {
          // @todo
          return 'No results found.'
        },
      }),
      answer: tool({
        description: 'Provide your final response to the user.',
        parameters: z.object({
          text: z.string().describe('The verbal response to the user. Do not list anything here.'),
          results: z.array(z.string()),
        }),
        // Important: Do NOT have an execute function otherwise it will call this tool multiple times.
        // But: it is helpful for debugging :)
        // execute: async ({ text, results }) => {
        //   console.log('answer', text, results)
        // },
      }),
    },
    onFinish: async () => {
      // console.log('done', result.reasoning, result.finishReason, result.warnings, result.text, result.toolResults)
    },
    toolChoice: 'required',
  })

  return result.toDataStreamResponse()
}
