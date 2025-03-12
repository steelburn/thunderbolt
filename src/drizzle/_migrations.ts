/**
 * This file is auto-generated. Do not edit directly.
 * Generated on: 2025-03-12T03:26:42.026Z
 */

export interface Migration {
  hash: string;
  name: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    "hash": "0000_fancy_network",
    "name": "0000_fancy_network.sql",
    "sql": `CREATE TABLE \`chat_messages\` (
\t\`id\` text PRIMARY KEY NOT NULL,
\t\`parts\` text NOT NULL,
\t\`role\` text NOT NULL,
\t\`content\` text NOT NULL,
\t\`chat_thread_id\` text NOT NULL,
\t\`model\` text NOT NULL,
\t\`provider\` text NOT NULL,
\tFOREIGN KEY (\`chat_thread_id\`) REFERENCES \`chat_threads\`(\`id\`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX \`chat_messages_id_unique\` ON \`chat_messages\` (\`id\`);--> statement-breakpoint
CREATE TABLE \`chat_threads\` (
\t\`id\` text PRIMARY KEY NOT NULL,
\t\`title\` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX \`chat_threads_id_unique\` ON \`chat_threads\` (\`id\`);--> statement-breakpoint
CREATE TABLE \`settings\` (
\t\`key\` text PRIMARY KEY NOT NULL,
\t\`value\` text,
\t\`updated_at\` text DEFAULT (CURRENT_DATE)
);`
  }
];
