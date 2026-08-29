CREATE TYPE "public"."extra_source" AS ENUM('platform', 'pms');--> statement-breakpoint
CREATE TYPE "public"."message_author" AS ENUM('guest', 'agent', 'staff', 'system');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('open', 'done', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."thread_status" AS ENUM('open', 'awaiting_reply', 'escalated', 'answered', 'closed');--> statement-breakpoint
CREATE TABLE "invoice_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"bill_to" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"routed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_requests_reservation" UNIQUE("reservation_id"),
	CONSTRAINT "invoice_requests_bill_to_not_empty" CHECK (length(btrim("invoice_requests"."bill_to")) > 0)
);
--> statement-breakpoint
CREATE TABLE "kb_articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"question_variants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"published" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_articles_property_topic" UNIQUE("property_id","topic"),
	CONSTRAINT "kb_articles_version_positive" CHECK ("kb_articles"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "message_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"status" "thread_status" DEFAULT 'open' NOT NULL,
	"channel" "notification_channel" DEFAULT 'email' NOT NULL,
	"locale" text NOT NULL,
	"assigned_to" uuid,
	"escalation_reason" text,
	"last_guest_message_at" timestamp with time zone,
	"last_reply_at" timestamp with time zone,
	"escalated_at" timestamp with time zone,
	"sla_alerted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_threads_reservation" UNIQUE("reservation_id"),
	CONSTRAINT "message_threads_escalated_has_time" CHECK ("message_threads"."status" <> 'escalated' or "message_threads"."escalated_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"author" "message_author" NOT NULL,
	"author_user_id" uuid,
	"body" text NOT NULL,
	"agent_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_agent_run_only_for_agent" CHECK ("messages"."agent_run_id" is null or "messages"."author" = 'agent'),
	CONSTRAINT "messages_author_user_only_for_staff" CHECK ("messages"."author_user_id" is null or "messages"."author" = 'staff'),
	CONSTRAINT "messages_body_not_empty" CHECK (length(btrim("messages"."body")) > 0)
);
--> statement-breakpoint
CREATE TABLE "stay_extras" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"description" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"source" "extra_source" DEFAULT 'platform' NOT NULL,
	"payment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stay_extras_amount_non_negative" CHECK ("stay_extras"."amount_cents" >= 0),
	CONSTRAINT "stay_extras_currency_iso" CHECK ("stay_extras"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "stay_extras_only_platform_is_settled" CHECK ("stay_extras"."payment_id" is null or "stay_extras"."source" = 'platform')
);
--> statement-breakpoint
CREATE TABLE "stay_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"thread_id" uuid,
	"summary" text NOT NULL,
	"status" "task_status" DEFAULT 'open' NOT NULL,
	"created_by" text NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stay_tasks_summary_not_empty" CHECK (length(btrim("stay_tasks"."summary")) > 0),
	CONSTRAINT "stay_tasks_done_has_time" CHECK ("stay_tasks"."status" <> 'done' or "stay_tasks"."completed_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "invoice_requests" ADD CONSTRAINT "invoice_requests_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_requests" ADD CONSTRAINT "invoice_requests_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_articles" ADD CONSTRAINT "kb_articles_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_message_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."message_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stay_extras" ADD CONSTRAINT "stay_extras_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stay_extras" ADD CONSTRAINT "stay_extras_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stay_extras" ADD CONSTRAINT "stay_extras_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stay_tasks" ADD CONSTRAINT "stay_tasks_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stay_tasks" ADD CONSTRAINT "stay_tasks_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stay_tasks" ADD CONSTRAINT "stay_tasks_thread_id_message_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."message_threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_requests_property_idx" ON "invoice_requests" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "message_threads_property_status_idx" ON "message_threads" USING btree ("property_id","status");--> statement-breakpoint
CREATE INDEX "messages_thread_idx" ON "messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_property_idx" ON "messages" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "stay_extras_reservation_idx" ON "stay_extras" USING btree ("reservation_id");--> statement-breakpoint
CREATE INDEX "stay_extras_property_idx" ON "stay_extras" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "stay_tasks_property_status_idx" ON "stay_tasks" USING btree ("property_id","status");--> statement-breakpoint
CREATE INDEX "stay_tasks_reservation_idx" ON "stay_tasks" USING btree ("reservation_id");