CREATE TABLE "chat_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"content" text NOT NULL,
	"role" text NOT NULL,
	"parts" text,
	"chat_thread_id" text NOT NULL,
	"model_id" text,
	"parent_id" text,
	"cache" text,
	"metadata" text
);
--> statement-breakpoint
CREATE TABLE "chat_threads" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text,
	"is_encrypted" integer DEFAULT 0 NOT NULL,
	"triggered_by" text,
	"was_triggered_by_automation" integer DEFAULT 0 NOT NULL,
	"context_size" integer
);
--> statement-breakpoint
CREATE TABLE "mcp_servers" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'http' NOT NULL,
	"url" text,
	"command" text,
	"args" text,
	"enabled" integer DEFAULT 1 NOT NULL,
	"created_at" integer,
	"updated_at" integer
);
--> statement-breakpoint
CREATE TABLE "models" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"name" text NOT NULL,
	"model" text NOT NULL,
	"url" text,
	"api_key" text,
	"is_system" integer DEFAULT 0,
	"enabled" integer DEFAULT 1 NOT NULL,
	"tool_usage" integer DEFAULT 1 NOT NULL,
	"is_confidential" integer DEFAULT 0 NOT NULL,
	"start_with_reasoning" integer DEFAULT 0 NOT NULL,
	"context_window" integer,
	"deleted_at" integer,
	"default_hash" text,
	"vendor" text,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "prompts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text,
	"prompt" text NOT NULL,
	"model_id" text NOT NULL,
	"deleted_at" integer,
	"default_hash" text
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"value" text,
	"updated_at" integer,
	"default_hash" text
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"item" text NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"is_complete" integer DEFAULT 0 NOT NULL,
	"default_hash" text
);
--> statement-breakpoint
CREATE TABLE "triggers" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"trigger_type" text NOT NULL,
	"trigger_time" text,
	"prompt_id" text NOT NULL,
	"is_enabled" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
DROP TABLE "sync_data" CASCADE;