CREATE TABLE "sv_workflow_test_cases" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"name" text NOT NULL,
	"scenario" jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sv_workflow_test_cases" ADD CONSTRAINT "sv_workflow_test_cases_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sv_workflow_test_cases_workflow_idx" ON "sv_workflow_test_cases" USING btree ("workflow_id","position");--> statement-breakpoint
-- SV (ADR-0058 §1): the single scenario of each workflow becomes its test case "Default".
INSERT INTO "sv_workflow_test_cases" ("id", "workflow_id", "name", "scenario", "position", "updated_at")
SELECT 'tc_' || "workflow_id", "workflow_id", 'Default', "scenario", 0, "updated_at" FROM "sv_workflow_scenarios"
ON CONFLICT ("id") DO NOTHING;
