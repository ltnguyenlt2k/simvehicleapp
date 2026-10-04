CREATE TABLE "sv_workflow_settings" (
	"workflow_id" text PRIMARY KEY NOT NULL,
	"vss_release" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sv_workflow_settings" ADD CONSTRAINT "sv_workflow_settings_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;