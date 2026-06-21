CREATE TYPE "public"."account_tier" AS ENUM('enterprise', 'mid', 'smb');--> statement-breakpoint
CREATE TYPE "public"."event_source" AS ENUM('sentry', 'datadog', 'cloudwatch', 'custom');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('error', 'latency');--> statement-breakpoint
CREATE TYPE "public"."outreach_status" AS ENUM('pending', 'approved', 'sent');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"tier" "account_tier" NOT NULL,
	"arr" numeric(12, 2) NOT NULL,
	"csm_owner" text NOT NULL,
	"renewal_date" timestamp with time zone NOT NULL,
	"region" text NOT NULL,
	"external_ref" text,
	CONSTRAINT "accounts_external_ref_unique" UNIQUE("external_ref")
);
--> statement-breakpoint
CREATE TABLE "outreach" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"draft_body" text NOT NULL,
	"status" "outreach_status" DEFAULT 'pending' NOT NULL,
	"approved_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telemetry_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"source" "event_source",
	"external_event_id" text,
	"endpoint" text NOT NULL,
	"event_type" "event_type" NOT NULL,
	"severity" integer NOT NULL,
	"status_code" integer,
	"error_signature" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telemetry_events_external_event_id_unique" UNIQUE("external_event_id")
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outreach" ADD CONSTRAINT "outreach_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry_events" ADD CONSTRAINT "telemetry_events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_events_account_time" ON "telemetry_events" USING btree ("account_id","occurred_at");