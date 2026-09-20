ALTER TABLE "dataset" ADD COLUMN "sync_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "dataset" ADD COLUMN "sync_mapping" jsonb;--> statement-breakpoint
ALTER TABLE "dataset" ADD COLUMN "sync_state" jsonb;