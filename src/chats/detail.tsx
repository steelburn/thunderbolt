import ChatUI from '@/components/chat/ChatUI'
import { useDrizzle } from '@/components/drizzle'
import { chatMessagesTable } from '@/db/schema'
import { HomeSidebar } from '@/home-sidebar'
import { aiFetchStreamingResponse } from '@/lib/ai'
import { uuidToDate } from '@/lib/utils'
import { useSettings } from '@/settings/provider'
import { useChat } from '@ai-sdk/solid'
import { useParams } from '@solidjs/router'
import { eq } from 'drizzle-orm'
import { createResource, Show, Suspense } from 'solid-js'

export default function ChatDetailPage() {
  const params = useParams()
  const { db } = useDrizzle()
  const settingsContext = useSettings()

  const [messages] = createResource(async () => {
    if (!params.chatThreadId) return []

    const chatMessages = await db.select().from(chatMessagesTable).where(eq(chatMessagesTable.chat_thread_id, params.chatThreadId)).orderBy(chatMessagesTable.id)

    return chatMessages.map((message) => ({
      id: message.id,
      parts: message.parts,
      role: message.role,
      content: message.content,
      createdAt: uuidToDate(message.id),
    }))
  })

  const chatHelpers = useChat({
    initialMessages: messages() || [],
    fetch: (requestInfoOrUrl, init) => {
      const apiKey = settingsContext.settings.models?.openai_api_key

      if (!apiKey) {
        throw new Error('No API key found')
      }

      return aiFetchStreamingResponse(apiKey, requestInfoOrUrl, init)
    },
    maxSteps: 5,
  })

  return (
    <>
      <HomeSidebar />
      <div class="h-full w-full">
        <Suspense fallback={<div class="flex items-center justify-center h-full">Loading chat...</div>}>
          <Show when={messages()} fallback={<div>Error loading chat</div>}>
            <ChatUI chatHelpers={chatHelpers} />
          </Show>
        </Suspense>
      </div>
    </>
  )
}
