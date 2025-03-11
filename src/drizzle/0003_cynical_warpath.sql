CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`parts` text NOT NULL,
	`role` text NOT NULL,
	`chat_thread_id` text NOT NULL,
	`model` text NOT NULL,
	`provider` text NOT NULL,
	FOREIGN KEY (`chat_thread_id`) REFERENCES `chat_threads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_messages_id_unique` ON `chat_messages` (`id`);--> statement-breakpoint
CREATE TABLE `chat_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_threads_id_unique` ON `chat_threads` (`id`);