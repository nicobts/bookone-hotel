CREATE TABLE "entitlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"feature" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entitlements_dates_ordered" CHECK ("entitlements"."ended_at" is null or "entitlements"."ended_at" > "entitlements"."granted_at"),
	CONSTRAINT "entitlements_feature_not_empty" CHECK (length(btrim("entitlements"."feature")) > 0)
);
--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entitlements_property_idx" ON "entitlements" USING btree ("property_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entitlements_property_feature_live" ON "entitlements" USING btree ("property_id","feature") WHERE "entitlements"."ended_at" is null;