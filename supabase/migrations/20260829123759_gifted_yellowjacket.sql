CREATE TYPE "public"."privacy_request_kind" AS ENUM('export', 'erasure');--> statement-breakpoint
CREATE TYPE "public"."privacy_request_status" AS ENUM('open', 'completed', 'refused');--> statement-breakpoint
CREATE TABLE "privacy_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"guest_id" uuid NOT NULL,
	"kind" "privacy_request_kind" NOT NULL,
	"status" "privacy_request_status" DEFAULT 'open' NOT NULL,
	"requested_by" uuid,
	"due_by" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"outcome" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privacy_requests_resolved_has_time" CHECK ("privacy_requests"."status" = 'open' or "privacy_requests"."completed_at" is not null),
	CONSTRAINT "privacy_requests_due_after_created" CHECK ("privacy_requests"."due_by" > "privacy_requests"."created_at")
);
--> statement-breakpoint
ALTER TABLE "alloggiati_submissions" ADD COLUMN "payload_purged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "privacy_requests_property_status_idx" ON "privacy_requests" USING btree ("property_id","status");--> statement-breakpoint
CREATE INDEX "privacy_requests_guest_idx" ON "privacy_requests" USING btree ("guest_id");--> statement-breakpoint
ALTER TABLE "alloggiati_submissions" ADD CONSTRAINT "alloggiati_submissions_purged_has_no_payload" CHECK ("alloggiati_submissions"."payload_purged_at" is null or length("alloggiati_submissions"."payload") = 0);