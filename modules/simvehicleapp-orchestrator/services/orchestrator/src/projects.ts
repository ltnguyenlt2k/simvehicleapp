import type { Clients } from "./clients.ts";
import { DuplicateSlug, type Project, type Repo } from "./repo.ts";

/**
 * Project creation (M07-T13): the row (status `creating`), then in the background the workspace
 * builds the project folder and the toolchain initialises it offline (`velocitas init`); the project
 * is `ready` for SynCode after that, or `failed` with the reason.
 */

export interface CreateProject {
  slug: string;
  name: string;
  language: Project["language"];
  vssRelease: string;
  appName?: string;
  settings?: Partial<Project["settings"]>;
}

export const appNameOf = (name: string) => {
  const s = name.split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w[0]!.toUpperCase() + w.slice(1)).join("");
  const n = /^[A-Za-z]/.test(s) ? s : `App${s}`;
  return n.length ? n : "App";
};

export async function createProject(repo: Repo, clients: Clients, req: CreateProject, background: (p: Promise<void>) => void): Promise<Project> {
  const project = await repo.createProject({
    id: crypto.randomUUID(),
    slug: req.slug,
    name: req.name,
    appName: req.appName ?? appNameOf(req.name),
    language: req.language,
    vssRelease: req.vssRelease,
    settings: { mqttTopicPrefix: req.settings?.mqttTopicPrefix ?? `simvehicleapp/${req.slug}`, traceLevel: req.settings?.traceLevel ?? "node" },
    status: "creating",
  });
  background(
    (async () => {
      try {
        const ws = await clients.createProject({ slug: project.slug, language: project.language, appName: project.appName, vssRelease: project.vssRelease });
        if (!ws.ok && ws.status !== 409) throw new Error(ws.diagnostics[0]?.message ?? ws.message ?? `workspace ⇒ ${ws.status}`);
        const init = await clients.job(project.language, "init", project.slug, () => {});
        if (init.state !== "succeeded") throw new Error(init.diagnostics[0]?.message ?? "velocitas init failed");
        await repo.updateProject(project.id, { status: "ready", statusMessage: undefined });
      } catch (e) {
        await repo.updateProject(project.id, { status: "failed", statusMessage: (e as Error).message });
      }
    })(),
  );
  return project;
}

export { DuplicateSlug };
