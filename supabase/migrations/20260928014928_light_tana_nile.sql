ALTER TABLE "compliance_obligations" ADD COLUMN "alert_rung" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "compliance_obligations" ADD COLUMN "alerted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "compliance_obligations" ADD CONSTRAINT "compliance_obligations_alert_rung" CHECK ("compliance_obligations"."alert_rung" between 0 and 3);