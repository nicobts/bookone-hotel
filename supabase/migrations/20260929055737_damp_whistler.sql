CREATE TABLE "compliance_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"obligation_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	"path" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "compliance_attachments_obligation" UNIQUE("obligation_id"),
	CONSTRAINT "compliance_attachments_size" CHECK ("compliance_attachments"."size_bytes" > 0)
);
--> statement-breakpoint
ALTER TABLE "compliance_attachments" ADD CONSTRAINT "compliance_attachments_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_attachments" ADD CONSTRAINT "compliance_attachments_obligation_id_compliance_obligations_id_fk" FOREIGN KEY ("obligation_id") REFERENCES "public"."compliance_obligations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_attachments" ADD CONSTRAINT "compliance_attachments_evidence_id_compliance_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."compliance_evidence"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "compliance_attachments_property_idx" ON "compliance_attachments" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "compliance_attachments_purge_idx" ON "compliance_attachments" USING btree ("uploaded_at") WHERE "compliance_attachments"."deleted_at" is null;