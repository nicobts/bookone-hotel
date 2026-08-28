CREATE TYPE "public"."fee_kind" AS ENUM('direct_booking', 'ai_attributed');--> statement-breakpoint
CREATE TYPE "public"."payment_kind" AS ENUM('deposit', 'balance', 'refund');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('requires_payment', 'requires_action', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "fee_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"kind" "fee_kind" NOT NULL,
	"basis_cents" integer NOT NULL,
	"rate_bps" integer NOT NULL,
	"fee_cents" integer NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_events_reservation_kind" UNIQUE("reservation_id","kind"),
	CONSTRAINT "fee_events_rate_sane" CHECK ("fee_events"."rate_bps" >= 0 and "fee_events"."rate_bps" <= 10000)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"kind" "payment_kind" NOT NULL,
	"status" "payment_status" DEFAULT 'requires_payment' NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"provider" text NOT NULL,
	"simulated" boolean DEFAULT false NOT NULL,
	"failure_reason" text,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_refund_is_negative" CHECK ("payments"."kind" <> 'refund' or "payments"."amount_cents" <= 0),
	CONSTRAINT "payments_charge_is_positive" CHECK ("payments"."kind" = 'refund' or "payments"."amount_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "fee_events" ADD CONSTRAINT "fee_events_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_events" ADD CONSTRAINT "fee_events_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fee_events_property_created_idx" ON "fee_events" USING btree ("property_id","created_at");--> statement-breakpoint
CREATE INDEX "payments_property_status_idx" ON "payments" USING btree ("property_id","status");--> statement-breakpoint
CREATE INDEX "payments_reservation_idx" ON "payments" USING btree ("reservation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_reservation_charge" ON "payments" USING btree ("reservation_id","kind","provider") WHERE "payments"."kind" <> 'refund';