CREATE TABLE "sync_data" (
	"id" text NOT NULL,
	"user_id" text NOT NULL,
	"table_name" text NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "sync_data_id_table_name_user_id_pk" PRIMARY KEY("id","table_name","user_id")
);
