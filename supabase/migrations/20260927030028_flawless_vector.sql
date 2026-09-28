CREATE TYPE "public"."complaint_category" AS ENUM('room', 'noise', 'cleanliness', 'staff', 'billing', 'safety', 'other');--> statement-breakpoint
CREATE TYPE "public"."complaint_status" AS ENUM('open', 'acknowledged', 'resolved');--> statement-breakpoint
CREATE TABLE "complaints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"thread_id" uuid,
	"category" "complaint_category" NOT NULL,
	"summary" text NOT NULL,
	"status" "complaint_status" DEFAULT 'open' NOT NULL,
	"sla_minutes" integer NOT NULL,
	"sla_due_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"owner_alerted_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "complaints_summary_not_empty" CHECK (length(btrim("complaints"."summary")) > 0),
	CONSTRAINT "complaints_sla_positive" CHECK ("complaints"."sla_minutes" > 0),
	CONSTRAINT "complaints_resolved_has_time" CHECK ("complaints"."status" <> 'resolved' or ("complaints"."resolved_at" is not null and "complaints"."resolved_by" is not null))
);
--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_thread_id_message_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."message_threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "complaints_property_status_idx" ON "complaints" USING btree ("property_id","status");--> statement-breakpoint
CREATE INDEX "complaints_reservation_idx" ON "complaints" USING btree ("reservation_id");