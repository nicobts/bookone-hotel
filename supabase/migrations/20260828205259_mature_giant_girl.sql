CREATE TYPE "public"."alloggiati_state" AS ENUM('pending', 'staged', 'submitted', 'acknowledged', 'failed');--> statement-breakpoint
CREATE TYPE "public"."arrival_state" AS ENUM('pending', 'expected', 'confirmed');--> statement-breakpoint
CREATE TYPE "public"."departure_state" AS ENUM('pending', 'settled', 'closed');--> statement-breakpoint
CREATE TYPE "public"."documents_state" AS ENUM('pending', 'captured', 'validated', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."precheckin_state" AS ENUM('pending', 'invited', 'submitted');--> statement-breakpoint
CREATE TABLE "journey_states" (
	"reservation_id" uuid PRIMARY KEY NOT NULL,
	"property_id" uuid NOT NULL,
	"precheckin_state" "precheckin_state" DEFAULT 'pending' NOT NULL,
	"documents_state" "documents_state" DEFAULT 'pending' NOT NULL,
	"alloggiati_state" "alloggiati_state" DEFAULT 'pending' NOT NULL,
	"arrival_state" "arrival_state" DEFAULT 'pending' NOT NULL,
	"departure_state" "departure_state" DEFAULT 'pending' NOT NULL,
	"expected_arrival_time" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journey_states_arrival_time_format" CHECK ("journey_states"."expected_arrival_time" is null or "journey_states"."expected_arrival_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);
--> statement-breakpoint
CREATE TABLE "registration_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"guest_index" smallint NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"document_path" text,
	"validated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registration_records_reservation_index" UNIQUE("reservation_id","guest_index"),
	CONSTRAINT "registration_records_index_non_negative" CHECK ("registration_records"."guest_index" >= 0),
	CONSTRAINT "registration_records_deleted_has_no_path" CHECK ("registration_records"."deleted_at" is null or "registration_records"."document_path" is null)
);
--> statement-breakpoint
ALTER TABLE "journey_states" ADD CONSTRAINT "journey_states_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_states" ADD CONSTRAINT "journey_states_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_records" ADD CONSTRAINT "registration_records_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_records" ADD CONSTRAINT "registration_records_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "journey_states_property_idx" ON "journey_states" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "journey_states_property_arrival_idx" ON "journey_states" USING btree ("property_id","arrival_state");--> statement-breakpoint
CREATE INDEX "registration_records_property_idx" ON "registration_records" USING btree ("property_id");