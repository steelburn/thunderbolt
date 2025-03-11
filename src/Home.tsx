import { useChat } from '@ai-sdk/solid'
import ChatUI from './components/chat/ChatUI'
import { HomeSidebar } from './home-sidebar'
import { aiFetchStreamingResponse } from './lib/ai'
import { useSettings } from './settings/provider'

export default function Home() {
  const settingsContext = useSettings()

  const chatHelpers = useChat({
    fetch: (requestInfoOrUrl, init) => {
      const apiKey = settingsContext.settings.models?.openai_api_key

      if (!apiKey) {
        // @todo: show a toast
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
        <ChatUI chatHelpers={chatHelpers} />
      </div>
    </>
  )
}
