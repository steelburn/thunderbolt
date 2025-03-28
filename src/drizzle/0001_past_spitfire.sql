CREATE TABLE `email_messages_to_addresses` (
	`id` text PRIMARY KEY NOT NULL,
	`email_message_id` text NOT NULL,
	`email_address_id` text NOT NULL,
	`type` text NOT NULL,
	FOREIGN KEY (`email_message_id`) REFERENCES `email_messages`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`email_address_id`) REFERENCES `email_addresses`(`address`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_messages_to_addresses_id_unique` ON `email_messages_to_addresses` (`id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_email_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`imap_id` text NOT NULL,
	`html_body` text NOT NULL,
	`text_body` text NOT NULL,
	`parts` text NOT NULL,
	`subject` text,
	`sent_at` integer NOT NULL,
	`from_address` text,
	`email_thread_id` text,
	FOREIGN KEY (`from_address`) REFERENCES `email_addresses`(`address`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`email_thread_id`) REFERENCES `email_threads`(`id`) ON UPDATE cascade ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_email_messages`("id", "imap_id", "html_body", "text_body", "parts", "subject", "sent_at", "from_address", "email_thread_id") SELECT "id", "imap_id", "html_body", "text_body", "parts", "subject", "sent_at", "from_address", "email_thread_id" FROM `email_messages`;--> statement-breakpoint
DROP TABLE `email_messages`;--> statement-breakpoint
ALTER TABLE `__new_email_messages` RENAME TO `email_messages`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `email_messages_id_unique` ON `email_messages` (`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `email_messages_imap_id_unique` ON `email_messages` (`imap_id`);--> statement-breakpoint
DROP INDEX `embeddings_emailMessageId_unique`;--> statement-breakpoint
DROP INDEX `embeddings_emailThreadId_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `embeddings_email_message_id_unique` ON `embeddings` (`email_message_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `embeddings_email_thread_id_unique` ON `embeddings` (`email_thread_id`);