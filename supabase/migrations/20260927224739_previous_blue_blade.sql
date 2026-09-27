CREATE TYPE "public"."obligation_state" AS ENUM('pending', 'queued', 'submitted', 'acknowledged', 'failed', 'manual');--> statement-breakpoint
CREATE TYPE "public"."obligation_type" AS ENUM('guest_registration', 'istat_movement', 'tourist_tax_declaration');--> statement-breakpoint
CREATE TABLE "compliance_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"obligation_id" uuid NOT NULL,
	"source" text NOT NULL,
	"receipt" jsonb NOT NULL,
	"receipt_hash" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_by" uuid,
	"receipt_purged_at" timestamp with time zone,
	CONSTRAINT "compliance_evidence_source" CHECK ("compliance_evidence"."source" in ('channel', 'manual'))
);
--> statement-breakpoint
CREATE TABLE "compliance_obligations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"adapter_id" text NOT NULL,
	"authority" text NOT NULL,
	"type" "obligation_type" NOT NULL,
	"subject_key" text NOT NULL,
	"reservation_id" uuid,
	"period_date" date,
	"deadline" timestamp with time zone NOT NULL,
	"state" "obligation_state" DEFAULT 'pending' NOT NULL,
	"state_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "compliance_obligations_subject" UNIQUE("property_id","adapter_id","type","subject_key"),
	CONSTRAINT "compliance_obligations_attempts" CHECK ("compliance_obligations"."attempts" >= 0),
	CONSTRAINT "compliance_obligations_subject_shape" CHECK (("compliance_obligations"."reservation_id" is not null and "compliance_obligations"."subject_key" like 'reservation:%') or ("compliance_obligations"."period_date" is not null and "compliance_obligations"."subject_key" like 'day:%') or "compliance_obligations"."subject_key" like 'period:%')
);
--> statement-breakpoint
ALTER TABLE "compliance_evidence" ADD CONSTRAINT "compliance_evidence_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_evidence" ADD CONSTRAINT "compliance_evidence_obligation_id_compliance_obligations_id_fk" FOREIGN KEY ("obligation_id") REFERENCES "public"."compliance_obligations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_obligations" ADD CONSTRAINT "compliance_obligations_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_obligations" ADD CONSTRAINT "compliance_obligations_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "compliance_evidence_obligation_idx" ON "compliance_evidence" USING btree ("obligation_id");--> statement-breakpoint
CREATE INDEX "compliance_evidence_property_recorded_idx" ON "compliance_evidence" USING btree ("property_id","recorded_at");--> statement-breakpoint
CREATE INDEX "compliance_obligations_due_idx" ON "compliance_obligations" USING btree ("state","next_attempt_at");--> statement-breakpoint
CREATE INDEX "compliance_obligations_property_deadline_idx" ON "compliance_obligations" USING btree ("property_id","deadline");--> statement-breakpoint
CREATE INDEX "compliance_obligations_reservation_idx" ON "compliance_obligations" USING btree ("reservation_id");