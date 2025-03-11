ALTER TABLE `chat_messages` ADD `content` text NOT NULL;--> statement-breakpoint
ALTER TABLE `chat_messages` DROP COLUMN `created_at`;