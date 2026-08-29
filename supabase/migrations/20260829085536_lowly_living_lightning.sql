CREATE TYPE "public"."attribution_channel" AS ENUM('engine', 'concierge_chat', 'concierge_voice');--> statement-breakpoint
CREATE TYPE "public"."dispute_status" AS ENUM('open', 'credited');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('draft', 'issued');--> statement-breakpoint
CREATE TABLE "attribution_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"property_id" uuid NOT NULL,
	"session_id" text NOT NULL,
	"channel" "attribution_channel" NOT NULL,
	"reservation_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fee_disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"fee_event_id" uuid NOT NULL,
	"raised_by" uuid,
	"reason" text,
	"status" "dispute_status" DEFAULT 'open' NOT NULL,
	"credit_cents" integer DEFAULT 0 NOT NULL,
	"credited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_disputes_fee_event" UNIQUE("fee_event_id"),
	CONSTRAINT "fee_disputes_credit_non_negative" CHECK ("fee_disputes"."credit_cents" >= 0),
	CONSTRAINT "fee_disputes_credited_has_time" CHECK ("fee_disputes"."status" <> 'credited' or "fee_disputes"."credited_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "monthly_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"status" "report_status" DEFAULT 'draft' NOT NULL,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"issued_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monthly_reports_property_period" UNIQUE("property_id","period_start"),
	CONSTRAINT "monthly_reports_issued_has_time" CHECK ("monthly_reports"."status" <> 'issued' or "monthly_reports"."issued_at" is not null),
	CONSTRAINT "monthly_reports_period_is_first" CHECK (extract(day from "monthly_reports"."period_start") = 1)
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"plan" text NOT NULL,
	"base_cents" integer NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"rooms" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_base_non_negative" CHECK ("subscriptions"."base_cents" >= 0),
	CONSTRAINT "subscriptions_rooms_positive" CHECK ("subscriptions"."rooms" is null or "subscriptions"."rooms" > 0),
	CONSTRAINT "subscriptions_currency_iso" CHECK ("subscriptions"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "subscriptions_dates_ordered" CHECK ("subscriptions"."ended_at" is null or "subscriptions"."ended_at" > "subscriptions"."started_at")
);
--> statement-breakpoint
ALTER TABLE "attribution_events" ADD CONSTRAINT "attribution_events_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_events" ADD CONSTRAINT "attribution_events_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_disputes" ADD CONSTRAINT "fee_disputes_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_disputes" ADD CONSTRAINT "fee_disputes_fee_event_id_fee_events_id_fk" FOREIGN KEY ("fee_event_id") REFERENCES "public"."fee_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_disputes" ADD CONSTRAINT "fee_disputes_raised_by_users_id_fk" FOREIGN KEY ("raised_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_reports" ADD CONSTRAINT "monthly_reports_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attribution_events_property_time_idx" ON "attribution_events" USING btree ("property_id","occurred_at");--> statement-breakpoint
CREATE INDEX "attribution_events_reservation_idx" ON "attribution_events" USING btree ("reservation_id");--> statement-breakpoint
CREATE INDEX "fee_disputes_property_idx" ON "fee_disputes" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "subscriptions_property_idx" ON "subscriptions" USING btree ("property_id");