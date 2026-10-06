CREATE TABLE "sv_workflow_scenarios" (
	"workflow_id" text PRIMARY KEY NOT NULL,
	"scenario" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sv_workflow_scenarios" ADD CONSTRAINT "sv_workflow_scenarios_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;