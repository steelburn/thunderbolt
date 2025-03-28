import { emailAddressesTable, emailMessagesTable, emailMessagesToAddressesTable } from '@/db/schema'
import { DrizzleContextType, ImapEmailMessage, ParsedEmail } from '@/types'
import { count, sql } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import ImapClient, { ImapEmailAddress } from './imap'

/**
 * **ImapSyncer**
 *
 * The `ImapSyncer` class manages the syncing state of IMAP mailboxes.
 * It fetches messages from a specified mailbox and stores them in the database.
 */
export class ImapSyncer {
  private db: DrizzleContextType['db']
  private mailbox: string
  private pageSize: number
  private isSyncing: boolean
  private shouldCancelAfterNextBatch: boolean
  private messagesProcessed: number
  private totalMessages: number
  private messagesSynced: number
  private imapClient: ImapClient

  /**
   * Creates a new ImapSyncer instance
   * @param db Database connection
   * @param mailbox The mailbox to sync (default: 'All Mail')
   * @param pageSize Number of messages to fetch in each batch (default: 50)
   */
  constructor(db: DrizzleContextType['db'], mailbox: string = 'All Mail', pageSize: number = 50) {
    this.db = db
    this.mailbox = mailbox
    this.pageSize = pageSize
    this.isSyncing = false
    this.shouldCancelAfterNextBatch = false
    this.messagesProcessed = 0
    this.totalMessages = 0
    this.messagesSynced = 0
    this.imapClient = new ImapClient()
  }

  /**
   * Cancels the syncing process after the current batch completes
   */
  cancel(): void {
    this.shouldCancelAfterNextBatch = true
  }

  /**
   * Get the current syncing status
   * @returns An object containing the current syncing status
   */
  getStatus(): { messagesProcessed: number; messagesSynced: number; totalMessages: number; isSyncing: boolean; progress: number } {
    return {
      messagesProcessed: this.messagesProcessed,
      messagesSynced: this.messagesSynced,
      totalMessages: this.totalMessages,
      isSyncing: this.isSyncing,
      progress: this.totalMessages > 0 ? (this.messagesSynced / this.totalMessages) * 100 : 0,
    }
  }

  async syncPage(startIndex: number, pageSize: number, since?: Date): Promise<{ hasMoreMessages: boolean }> {
    const result = await this.imapClient.fetchMessages(this.mailbox, startIndex, pageSize)

    if (result.messages.length === 0) {
      return { hasMoreMessages: false }
    }

    this.totalMessages = Math.max(this.totalMessages, result.total)

    // Filter messages by date if 'since' is provided
    const filteredMessages = since ? result.messages.filter((msg) => msg.sentAt >= since.getTime()) : result.messages

    // Process and store the messages
    const savedCount = await this.storeMessages(filteredMessages)

    // Update both counters
    this.messagesProcessed += filteredMessages.length
    this.messagesSynced += savedCount

    // If we got fewer messages than requested, we've reached the end
    return { hasMoreMessages: result.messages.length === pageSize }
  }

  async syncMailbox(since?: Date, onProgress?: (status: ReturnType<typeof this.getStatus>) => void): Promise<void> {
    this.isSyncing = true
    this.shouldCancelAfterNextBatch = false
    this.messagesProcessed = 0

    try {
      // Get initial count of messages in the database for this mailbox
      const initialCount = await this.db.select({ count: count() }).from(emailMessagesTable).get()
      this.messagesSynced = initialCount?.count ?? 0

      console.log('Initial count of messages in the database:', this.messagesSynced)

      let startIndex = 1
      let hasMoreMessages = true

      while (hasMoreMessages && !this.shouldCancelAfterNextBatch) {
        // Process a batch
        const result = await this.syncPage(startIndex, this.pageSize, since)

        // Notify about progress if callback provided
        if (onProgress) {
          onProgress(this.getStatus())
        }

        if (!result.hasMoreMessages) {
          hasMoreMessages = false
          break
        }

        startIndex += this.pageSize

        // Add a small delay to let the event loop breathe
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
    } catch (error) {
      console.error(`Failed to sync mailbox ${this.mailbox}:`, error)
      throw error
    } finally {
      this.isSyncing = false
      this.shouldCancelAfterNextBatch = false

      // Final progress update
      if (onProgress) {
        onProgress(this.getStatus())
      }
    }
  }

  /**
   * Upserts email addresses to the database
   * @param addresses Array of email addresses to upsert
   * @param sentAt Timestamp when the email was sent, used to update lastSeenAt if newer
   * @returns A promise that resolves when all addresses have been upserted
   */
  private async upsertEmailAddresses(addresses: ImapEmailAddress[], sentAt: number): Promise<void> {
    if (addresses.length === 0) return

    const now = Date.now()

    // Prepare the values for batch insertion
    const addressValues = addresses.map((addr) => ({
      address: addr.address.toLowerCase(), // Lowercase the address
      name: addr.name,
      firstSeenAt: now,
      lastSeenAt: sentAt,
    }))

    // Batch upsert all addresses
    await this.db
      .insert(emailAddressesTable)
      .values(addressValues)
      .onConflictDoUpdate({
        target: emailAddressesTable.address,
        set: {
          // Update name only if the message is newer than the last seen timestamp
          name: sql`CASE WHEN ${emailAddressesTable.lastSeenAt} < ${sentAt} THEN excluded.name ELSE ${emailAddressesTable.name} END`,
          // Always update lastSeenAt if it's newer
          lastSeenAt: sql`CASE WHEN ${emailAddressesTable.lastSeenAt} < ${sentAt} THEN ${sentAt} ELSE ${emailAddressesTable.lastSeenAt} END`,
        },
      })
  }

  /**
   * Associates email messages with recipient addresses
   * @param messageId The ID of the email message
   * @param addresses Array of recipient email addresses
   * @returns A promise that resolves when all associations have been created
   */
  private async storeMessageToAddresses(messageId: string, addresses: ImapEmailAddress[]): Promise<void> {
    if (addresses.length === 0) return

    // Prepare values for batch insertion
    const toAddressValues = addresses.map((addr) => ({
      emailMessageId: messageId,
      emailAddressId: addr.address.toLowerCase(), // Lowercase the address
      type: 'to' as const, // All addresses are "to" for now
    }))

    // Batch insert all message-to-address relationships
    await this.db.insert(emailMessagesToAddressesTable).values(toAddressValues).onConflictDoNothing()
  }

  /**
   * Store messages in the database
   * @param messages Array of messages to store
   * @returns A promise that resolves with the number of messages stored
   */
  private async storeMessages(messages: ImapEmailMessage[]): Promise<number> {
    if (messages.length === 0) return 0

    // First, extract and upsert all email addresses (both from and to)
    for (const message of messages) {
      // Collect all addresses to upsert
      const allAddresses = [message.fromAddress, ...message.toAddresses]
      await this.upsertEmailAddresses(allAddresses, message.sentAt)
    }

    // Prepare messages for insertion
    const messagesWithReferences = messages.map((message) => ({
      id: uuidv7(),
      imapId: message.imapId,
      htmlBody: message.htmlBody,
      textBody: message.textBody,
      subject: message.subject,
      sentAt: message.sentAt,
      parts: {} as ParsedEmail,
      fromAddress: message.fromAddress.address.toLowerCase(), // Set the fromAddress to the lowercase email
      emailThreadId: null,
    }))

    // Batch insert all messages
    await this.db.insert(emailMessagesTable).values(messagesWithReferences).onConflictDoNothing()

    // Store the to addresses for each message
    for (let i = 0; i < messages.length; i++) {
      await this.storeMessageToAddresses(messagesWithReferences[i].id, messages[i].toAddresses)
    }

    return messages.length
  }
}
