CREATE TYPE "public"."submission_status" AS ENUM('staged', 'submitted', 'acknowledged', 'failed');--> statement-breakpoint
CREATE TABLE "alloggiati_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"status" "submission_status" DEFAULT 'staged' NOT NULL,
	"guest_count" smallint NOT NULL,
	"payload" text NOT NULL,
	"payload_checksum" text NOT NULL,
	"receipt" jsonb,
	"last_error" text,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"channel" text NOT NULL,
	"submitted_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alloggiati_submissions_reservation_channel" UNIQUE("reservation_id","channel"),
	CONSTRAINT "alloggiati_submissions_guest_count" CHECK ("alloggiati_submissions"."guest_count" > 0),
	CONSTRAINT "alloggiati_submissions_ack_has_receipt" CHECK ("alloggiati_submissions"."status" <> 'acknowledged' or "alloggiati_submissions"."receipt" is not null)
);
--> statement-breakpoint
ALTER TABLE "alloggiati_submissions" ADD CONSTRAINT "alloggiati_submissions_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alloggiati_submissions" ADD CONSTRAINT "alloggiati_submissions_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alloggiati_submissions_property_status_idx" ON "alloggiati_submissions" USING btree ("property_id","status");--> statement-breakpoint
CREATE INDEX "alloggiati_submissions_reservation_idx" ON "alloggiati_submissions" USING btree ("reservation_id");