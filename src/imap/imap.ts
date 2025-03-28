import { camelCasedPropertiesDeep } from '@/lib/utils'
import { ImapEmailMessage } from '@/types'
import { invoke } from '@tauri-apps/api/core'
import { SnakeCasedPropertiesDeep } from 'type-fest'
export type ImapEmailAddress = {
  name: string
  address: string
}

/**
 * Interface for IMAP credentials
 */
export interface ImapCredentials {
  hostname: string
  port: number
  username: string
  password: string
}

/**
 * **ImapClient**
 *
 * The `ImapClient` class serves as the primary interface for
 * communicating with the rust side of the IMAP functionality.
 */
export default class ImapClient {
  /**
   * **initialize**
   *
   * Initializes the IMAP client with the provided credentials.
   *
   * @example
   * ```ts
   * await ImapClient.initialize({
   *   hostname: 'imap.example.com',
   *   port: 993,
   *   username: 'user@example.com',
   *   password: 'password'
   * });
   * ```
   */
  async initialize(credentials: ImapCredentials): Promise<void> {
    await invoke<void>('init_imap')
  }

  /**
   * **listMailboxes**
   *
   * Lists all available mailboxes from the IMAP server.
   *
   * @example
   * ```ts
   * const mailboxes = await ImapClient.listMailboxes();
   * ```
   */
  async listMailboxes(): Promise<Record<string, any>> {
    return await invoke<Record<string, any>>('list_mailboxes')
  }

  /**
   * **fetchInbox**
   *
   * Fetches messages from a mailbox.
   *
   * @param mailbox - The mailbox to fetch messages from (defaults to "INBOX")
   * @param startIndex - Optional starting index for fetching messages
   * @param count - Optional number of messages to fetch
   *
   * @example
   * ```ts
   * // Fetch the latest 10 messages from INBOX
   * const messages = await ImapClient.fetchInbox("INBOX", undefined, 10);
   *
   * // Fetch messages from a specific mailbox
   * const messages = await ImapClient.fetchInbox("Sent", undefined, 5);
   * ```
   */
  async fetchInbox(mailbox: string = 'INBOX', startIndex?: number, count?: number): Promise<any[]> {
    return await invoke<any[]>('fetch_inbox', { mailbox, startIndex, count })
  }
  /**
   * **fetchMessages**
   *
   * Fetches messages from a specific mailbox.
   *
   * @param mailbox - The mailbox to fetch messages from
   * @param startIndex - Optional starting index for fetching messages
   * @param count - Optional number of messages to fetch
   * @returns An object containing the messages, current index, and total message count
   *
   * @example
   * ```ts
   * const result = await ImapClient.fetchMessages("INBOX", 1, 10);
   * console.log(`Fetched ${result.messages.length} of ${result.total} messages`);
   * ```
   */
  async fetchMessages(
    mailbox: string,
    startIndex?: number,
    count?: number
  ): Promise<{
    index: number
    total: number
    messages: ImapEmailMessage[]
  }> {
    const result = await invoke<{
      index: number
      total: number
      messages: SnakeCasedPropertiesDeep<ImapEmailMessage>[]
    }>('fetch_messages', { mailbox, startIndex, count })

    const camelCasedResult = camelCasedPropertiesDeep(result)
    return camelCasedResult
  }
}
