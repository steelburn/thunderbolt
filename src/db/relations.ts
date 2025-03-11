import { relations } from 'drizzle-orm'
import { chatMessagesTable, chatThreadsTable } from './schema'

export const chatThreadsRelations = relations(chatThreadsTable, ({ many }) => ({
  messages: many(chatMessagesTable),
}))

export const chatMessagesRelations = relations(chatMessagesTable, ({ one }) => ({
  thread: one(chatThreadsTable, {
    fields: [chatMessagesTable.chat_thread_id],
    references: [chatThreadsTable.id],
  }),
}))
