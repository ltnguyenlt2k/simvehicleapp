CREATE TABLE "sv_projects" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"slug" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sv_projects_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "sv_projects" ADD CONSTRAINT "sv_projects_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sv_projects" ADD CONSTRAINT "sv_projects_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sv_projects_workspace_idx" ON "sv_projects" USING btree ("workspace_id");