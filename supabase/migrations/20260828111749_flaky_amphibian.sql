CREATE TYPE "public"."discrepancy_class" AS ENUM('rounding', 'tz', 'logic');--> statement-breakpoint
CREATE TYPE "public"."discrepancy_status" AS ENUM('open', 'explained', 'blocking');--> statement-breakpoint
CREATE TABLE "discrepancies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"entity_ref" text NOT NULL,
	"class" "discrepancy_class" NOT NULL,
	"ours" jsonb,
	"theirs" jsonb,
	"status" "discrepancy_status" DEFAULT 'open' NOT NULL,
	"explanation" text,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discrepancies_run_entity" UNIQUE("run_id","entity_ref")
);
--> statement-breakpoint
CREATE TABLE "reconciliation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	"parity_ratio" numeric(5, 4),
	"discrepancies_count" integer DEFAULT 0 NOT NULL,
	"compared_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "reconciliation_runs_parity_range" CHECK ("reconciliation_runs"."parity_ratio" is null or ("reconciliation_runs"."parity_ratio" >= 0 and "reconciliation_runs"."parity_ratio" <= 1))
);
--> statement-breakpoint
ALTER TABLE "discrepancies" ADD CONSTRAINT "discrepancies_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discrepancies" ADD CONSTRAINT "discrepancies_run_id_reconciliation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."reconciliation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_runs" ADD CONSTRAINT "reconciliation_runs_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discrepancies_property_status_idx" ON "discrepancies" USING btree ("property_id","status");--> statement-breakpoint
CREATE INDEX "discrepancies_run_idx" ON "discrepancies" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "reconciliation_runs_property_idx" ON "reconciliation_runs" USING btree ("property_id","ran_at");