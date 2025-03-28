PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_email_messages_to_addresses` (
	`email_message_id` text NOT NULL,
	`email_address_id` text NOT NULL,
	`type` text NOT NULL,
	PRIMARY KEY(`email_message_id`, `email_address_id`),
	FOREIGN KEY (`email_message_id`) REFERENCES `email_messages`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`email_address_id`) REFERENCES `email_addresses`(`address`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_email_messages_to_addresses`("email_message_id", "email_address_id", "type") SELECT "email_message_id", "email_address_id", "type" FROM `email_messages_to_addresses`;--> statement-breakpoint
DROP TABLE `email_messages_to_addresses`;--> statement-breakpoint
ALTER TABLE `__new_email_messages_to_addresses` RENAME TO `email_messages_to_addresses`;--> statement-breakpoint
PRAGMA foreign_keys=ON;