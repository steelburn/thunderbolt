import { A, useNavigate } from '@solidjs/router'
import { Settings } from 'lucide-solid'
import { createResource, For } from 'solid-js'
import { v7 as uuidv7 } from 'uuid'
import { Button } from './components/button'
import { useDrizzle } from './components/drizzle'
import { Sidebar } from './components/sidebar'
import { chatThreadsTable } from './db/schema'

export function HomeSidebar() {
  const navigate = useNavigate()
  const { db } = useDrizzle()

  const [chatThreads] = createResource(async () => {
    return await db.select().from(chatThreadsTable).orderBy(chatThreadsTable.id)
  })

  const createNewChat = async () => {
    const chatThreadId = uuidv7()
    await db.insert(chatThreadsTable).values({ id: chatThreadId, title: 'New Chat' }).returning()
    navigate(`/chats/${chatThreadId}`)
  }

  return (
    <Sidebar>
      <div class="flex flex-col gap-4">
        <Button as={A} href="/settings/accounts" variant="outline">
          <Settings class="size-4" />
          Settings
        </Button>
        <div class="flex flex-col gap-2">
          <Button onClick={createNewChat} variant="ghost" class="justify-start">
            New Chat
          </Button>
          <Button as={A} href="/ui-kit" variant="ghost" class="justify-start">
            UI Kit
          </Button>
        </div>
        <div class="flex flex-col gap-2">
          <For each={chatThreads()}>
            {(thread) => (
              <Button as={A} href={`/chats/${thread.id}`} variant="ghost" class="justify-start">
                {thread.title}
              </Button>
            )}
          </For>
        </div>
      </div>
    </Sidebar>
  )
}
