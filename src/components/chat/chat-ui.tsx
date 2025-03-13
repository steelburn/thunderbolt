import type { UseChatHelpers } from '@ai-sdk/react'
import { useEffect, useRef } from 'react'
import { AgentToolResponse } from './agent-tool-response'

interface ChatUIProps {
  chatHelpers: UseChatHelpers
}

export default function ChatUI({ chatHelpers }: ChatUIProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [chatHelpers.messages])

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-hidden">
      <div className="flex-1 p-4 overflow-y-auto space-y-4">
        {chatHelpers.messages.map((message, i) => {
          if (message.role === 'assistant') {
            return (
              <div key={i} className="p-4 space-y-2 rounded-tl-lg rounded-tr-lg rounded-br-lg max-w-3/4 bg-white border border-gray-200 mr-auto">
                {message.content && <div className="text-gray-700 leading-relaxed">{message.content}</div>}
                {message.parts
                  ?.filter((part) => part.type === 'tool-invocation')
                  .map((part, j) => (
                    <AgentToolResponse key={j} part={part} />
                  ))}
              </div>
            )
          } else if (message.role === 'user') {
            return (
              <div key={i} className="p-4 rounded-tl-lg rounded-tr-lg rounded-bl-lg max-w-3/4 bg-indigo-100 text-gray-800 ml-auto">
                <div className="space-y-2">
                  <div className="text-gray-700 leading-relaxed">{message.content}</div>
                </div>
              </div>
            )
          }
          return null
        })}
        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-gray-200 p-4 bg-white">
        <form onSubmit={chatHelpers.handleSubmit} className="flex gap-2">
          <input
            autoFocus
            value={chatHelpers.input}
            onChange={chatHelpers.handleInputChange}
            placeholder="Say something..."
            className="flex-1 px-4 py-2 border border-gray-300 rounded-full focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
          <button
            type="submit"
            className="bg-indigo-600 text-white px-4 py-2 rounded-full hover:bg-indigo-700 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  )
}
