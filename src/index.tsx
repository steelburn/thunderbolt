import { Route, Router } from '@solidjs/router'
import { createSignal, onMount, Show } from 'solid-js'
import { render } from 'solid-js/web'
import ChatDetailPage from './chats/detail'
import { DrizzleProvider } from './components/drizzle'
import { initializeDrizzleDatabase } from './db/database'
import { migrate } from './db/migrate'
import Home from './home'
import Layout from './layout'
import { createAppDataDir } from './lib/fs'
import { createTray } from './lib/tray'
import NotFound from './not-found'
import Settings from './settings'
import AccountsSettingsPage from './settings/accounts'
import ModelsSettingsPage from './settings/models'
import { SettingsProvider } from './settings/provider'
import { DrizzleContextType } from './types'
import UiKitPage from './ui-kit'

const init = async () => {
  createTray()
  createAppDataDir()

  const { db, sqlite } = await initializeDrizzleDatabase()

  await migrate({ sqlite })

  return {
    db,
    sqlite,
  }
  // console.log('11111')

  // const libsql = await Database.load('data/local.db')
  // console.log('🚀 ~ db:', libsql)

  // // Create the setting table if it doesn't exist
  // await libsql.execute(`
  //   CREATE TABLE IF NOT EXISTS \`setting\` (
  //     \`id\` integer PRIMARY KEY NOT NULL,
  //     \`value\` text,
  //     \`updated_at\` text DEFAULT 'CURRENT_TIMESTAMP',
  //     \`embedding\` vector(32)
  //   );
  // `)

  // // Create the unique index if it doesn't exist
  // await libsql.execute(`
  //   CREATE UNIQUE INDEX IF NOT EXISTS \`setting_id_unique\` ON \`setting\` (\`id\`);
  // `)

  // console.log('00000')

  // await db.insert(settings).values([{ embedding: sql`vector32(${JSON.stringify([1.1, 2.2, 3.3])})` }])

  // console.log('aaaa')

  // const res = await db
  //   .select({
  //     id: settings.id,
  //     distance: sql<number>`vector_distance_cos(${settings.embedding}, vector32(${JSON.stringify([2.2, 3.3, 4.4])}))`,
  //   })
  //   .from(settings)

  // console.log('bbbb')

  // console.log(res)
}

export const App = () => {
  const [context, setContext] = createSignal<DrizzleContextType>()

  onMount(async () => {
    const { db, sqlite } = await init()
    setContext({ db, sqlite })
  })

  return (
    <Show when={context()} fallback={<div>Loading...</div>}>
      <DrizzleProvider context={context()!}>
        <SettingsProvider key="main">
          <Router root={Layout}>
            <Route path="/" component={Home} />
            <Route path="/chats/:chatThreadId" component={ChatDetailPage} />
            <Route path="/settings" component={Settings}>
              <Route path="/accounts" component={AccountsSettingsPage} />
              <Route path="/models" component={ModelsSettingsPage} />
            </Route>
            <Route path="/ui-kit" component={UiKitPage} />
            <Route path="*404" component={NotFound} />
          </Router>
        </SettingsProvider>
      </DrizzleProvider>
    </Show>
  )
}

render(App, document.getElementById('root') as HTMLElement)
