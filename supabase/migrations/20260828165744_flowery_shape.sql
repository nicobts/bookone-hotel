CREATE TYPE "public"."notification_channel" AS ENUM('email', 'sms', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('queued', 'sent', 'failed', 'suppressed');--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"reservation_id" uuid,
	"channel" "notification_channel" NOT NULL,
	"template" text NOT NULL,
	"locale" text NOT NULL,
	"recipient" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "notification_status" DEFAULT 'queued' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"provider" text,
	"provider_message_id" text,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_reservation_template_channel" UNIQUE("reservation_id","template","channel")
);
--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "reference" text;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "hold_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "rate_snapshot_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_property_status_idx" ON "notifications" USING btree ("property_id","status");--> statement-breakpoint
CREATE INDEX "notifications_reservation_idx" ON "notifications" USING btree ("reservation_id");--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_property_reference" UNIQUE("property_id","reference");--> statement-breakpoint
--> statement-breakpoint
-- Hand-added, ahead of the constraint below.
--
-- Holds that predate this migration have no expiry, and the constraint would
-- reject the whole migration on any database that holds one. Thirty minutes
-- from creation is the honest reconstruction of what the expiry would have
-- been (E1.3), and every such hold is long past it — so they become expirable
-- immediately, which is the correct outcome for a hold nobody completed.
UPDATE "reservations"
   SET "hold_expires_at" = "created_at" + interval '30 minutes'
 WHERE "status" = 'hold' AND "hold_expires_at" IS NULL;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_hold_has_expiry" CHECK ("reservations"."status" <> 'hold' or "reservations"."hold_expires_at" is not null);