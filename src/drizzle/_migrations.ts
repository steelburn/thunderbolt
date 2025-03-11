/**
 * This file is auto-generated. Do not edit directly.
 * Generated on: 2025-03-11T22:31:28.154Z
 */

export interface Migration {
  hash: string;
  name: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    "hash": "0000_messy_the_hunter",
    "name": "0000_messy_the_hunter.sql",
    "sql": `CREATE TABLE \`setting\` (
\t\`id\` integer PRIMARY KEY NOT NULL,
\t\`value\` text,
\t\`updated_at\` text DEFAULT 'CURRENT_TIMESTAMP'
);
--> statement-breakpoint
CREATE UNIQUE INDEX \`setting_id_unique\` ON \`setting\` (\`id\`);`
  },
  {
    "hash": "0001_lonely_fallen_one",
    "name": "0001_lonely_fallen_one.sql",
    "sql": `ALTER TABLE \`setting\` ADD \`embedding\` text;`
  },
  {
    "hash": "0002_majestic_nicolaos",
    "name": "0002_majestic_nicolaos.sql",
    "sql": `CREATE TABLE \`settings\` (
\t\`key\` text PRIMARY KEY NOT NULL,
\t\`value\` text,
\t\`updated_at\` text DEFAULT (CURRENT_DATE)
);
--> statement-breakpoint
DROP TABLE \`setting\`;`
  },
  {
    "hash": "0003_cynical_warpath",
    "name": "0003_cynical_warpath.sql",
    "sql": `CREATE TABLE \`chat_messages\` (
\t\`id\` text PRIMARY KEY NOT NULL,
\t\`created_at\` text NOT NULL,
\t\`parts\` text NOT NULL,
\t\`role\` text NOT NULL,
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
CREATE UNIQUE INDEX \`chat_threads_id_unique\` ON \`chat_threads\` (\`id\`);`
  },
  {
    "hash": "0004_melodic_vertigo",
    "name": "0004_melodic_vertigo.sql",
    "sql": `ALTER TABLE \`chat_messages\` ADD \`content\` text NOT NULL;--> statement-breakpoint
ALTER TABLE \`chat_messages\` DROP COLUMN \`created_at\`;`
  }
];
