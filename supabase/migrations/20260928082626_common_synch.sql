CREATE TABLE "property_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"role" text NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"informed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "property_contacts_property_role_phone" UNIQUE("property_id","role","phone"),
	CONSTRAINT "property_contacts_role" CHECK ("property_contacts"."role" in ('owner', 'staff')),
	CONSTRAINT "property_contacts_phone_e164" CHECK ("property_contacts"."phone" ~ '^\+[1-9][0-9]{6,14}$'),
	CONSTRAINT "property_contacts_name" CHECK (length(btrim("property_contacts"."name")) between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "alert" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "property_contacts" ADD CONSTRAINT "property_contacts_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;