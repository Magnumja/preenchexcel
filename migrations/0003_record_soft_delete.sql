ALTER TABLE "record" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "revision" ADD COLUMN "action" text DEFAULT 'edit' NOT NULL;--> statement-breakpoint
CREATE INDEX "record_dataset_active" ON "record" USING btree ("dataset_id","deleted_at");