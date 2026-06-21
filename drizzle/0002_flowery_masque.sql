CREATE TYPE "public"."incident_status" AS ENUM('active', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."outreach_stage" AS ENUM('none', 'initial_sent', 'resolution_sent');--> statement-breakpoint
ALTER TABLE "outreach" ADD COLUMN "incident_status" "incident_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "outreach" ADD COLUMN "outreach_status" "outreach_stage" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "outreach" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outreach" ADD COLUMN "resolution_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outreach" DROP COLUMN "status";--> statement-breakpoint
DROP TYPE "public"."outreach_status";