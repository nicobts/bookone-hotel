CREATE TYPE "public"."agent_outcome" AS ENUM('accepted', 'edited', 'rejected', 'auto');--> statement-breakpoint
CREATE TYPE "public"."agent_tier" AS ENUM('T1', 'T2', 'T3');--> statement-breakpoint
CREATE TYPE "public"."event_origin" AS ENUM('platform', 'sync', 'reconciliation');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'staff');--> statement-breakpoint
CREATE TYPE "public"."reservation_origin" AS ENUM('platform', 'sync');--> statement-breakpoint
CREATE TYPE "public"."reservation_status" AS ENUM('hold', 'confirmed', 'cancelled', 'no_show');--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent" text NOT NULL,
	"property_id" uuid NOT NULL,
	"trigger_event_id" bigint,
	"input_ref" text,
	"tool_calls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"output" jsonb,
	"confidence" numeric(4, 3),
	"tier_applied" "agent_tier" NOT NULL,
	"outcome" "agent_outcome",
	"reviewed_by" uuid,
	"cost_cents" integer,
	"latency_ms" integer,
	"model" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domain_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"property_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"event_type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"origin" "event_origin" NOT NULL,
	"actor" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_refs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"system" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"last_synced_at" timestamp with time zone,
	CONSTRAINT "external_refs_system_entity" UNIQUE("system","entity_type","external_id")
);
--> statement-breakpoint
CREATE TABLE "guests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"name" text,
	"email" text,
	"phone" text,
	"locale" text,
	"marketing_consent" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"full_name" text,
	"locale" text DEFAULT 'en' NOT NULL,
	"theme" text DEFAULT 'system' NOT NULL,
	"default_property_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"locale_default" text DEFAULT 'en' NOT NULL,
	"languages" jsonb DEFAULT '["en"]'::jsonb NOT NULL,
	"timezone" text DEFAULT 'Europe/Rome' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"authority_map" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "properties_slug_unique" UNIQUE("slug"),
	CONSTRAINT "properties_slug_reserved" CHECK ("properties"."slug" not in (
        'book', 'stay', 'console', 'login', 'logout', 'signup', 'auth',
        'api', 'admin', 'settings', 'forgot-password', 'update-password',
        'no-property', 'imprint', 'privacy', 'terms',
        'it', 'de', 'en', 'sl'
      )),
	CONSTRAINT "properties_slug_format" CHECK ("properties"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "property_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" DEFAULT 'staff' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "property_members_property_user" UNIQUE("property_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "rate_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"room_type_id" uuid NOT NULL,
	"date_from" date NOT NULL,
	"date_to" date NOT NULL,
	"price_cents" integer NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_snapshots_date_order" CHECK ("rate_snapshots"."date_to" >= "rate_snapshots"."date_from"),
	CONSTRAINT "rate_snapshots_price_non_negative" CHECK ("rate_snapshots"."price_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"guest_id" uuid,
	"room_type_id" uuid,
	"status" "reservation_status" DEFAULT 'hold' NOT NULL,
	"arrival_date" date NOT NULL,
	"departure_date" date NOT NULL,
	"pax" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"total_cents" integer,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"origin" "reservation_origin" DEFAULT 'platform' NOT NULL,
	"engine_session_id" text,
	"concierge_session_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservations_date_order" CHECK ("reservations"."departure_date" > "reservations"."arrival_date")
);
--> statement-breakpoint
CREATE TABLE "room_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name_i18n" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"capacity" smallint DEFAULT 2 NOT NULL,
	CONSTRAINT "room_types_property_code" UNIQUE("property_id","code")
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_trigger_event_id_domain_events_id_fk" FOREIGN KEY ("trigger_event_id") REFERENCES "public"."domain_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_refs" ADD CONSTRAINT "external_refs_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guests" ADD CONSTRAINT "guests_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_default_property_id_properties_id_fk" FOREIGN KEY ("default_property_id") REFERENCES "public"."properties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_members" ADD CONSTRAINT "property_members_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_members" ADD CONSTRAINT "property_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_snapshots" ADD CONSTRAINT "rate_snapshots_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_snapshots" ADD CONSTRAINT "rate_snapshots_room_type_id_room_types_id_fk" FOREIGN KEY ("room_type_id") REFERENCES "public"."room_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_room_type_id_room_types_id_fk" FOREIGN KEY ("room_type_id") REFERENCES "public"."room_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_types" ADD CONSTRAINT "room_types_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_runs_property_at_idx" ON "agent_runs" USING btree ("property_id","at");--> statement-breakpoint
CREATE INDEX "agent_runs_agent_idx" ON "agent_runs" USING btree ("agent");--> statement-breakpoint
CREATE INDEX "domain_events_property_at_idx" ON "domain_events" USING btree ("property_id","at");--> statement-breakpoint
CREATE INDEX "domain_events_entity_idx" ON "domain_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "domain_events_type_idx" ON "domain_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "external_refs_entity_idx" ON "external_refs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "external_refs_property_idx" ON "external_refs" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "guests_property_idx" ON "guests" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "property_members_user_idx" ON "property_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "rate_snapshots_lookup_idx" ON "rate_snapshots" USING btree ("property_id","room_type_id","date_from");--> statement-breakpoint
CREATE INDEX "reservations_property_arrival_idx" ON "reservations" USING btree ("property_id","arrival_date");--> statement-breakpoint
CREATE INDEX "reservations_property_status_idx" ON "reservations" USING btree ("property_id","status");