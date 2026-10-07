import { internalHeaders } from "@simvehicleapp/service-kit";
import type { Bundle, InitSources } from "./init.ts";

/** Toolchains, backends and the catalog over the compose networks (ADR-0007). */
export function httpSources(opts: { toolchains: Record<string, string>; backends: Record<string, string>; catalog: string; secret: string }): InitSources {
  const get = async (url: string) => {
    const res = await fetch(url, { headers: internalHeaders(undefined, opts.secret) });
    if (!res.ok) throw new Error(`GET ${url} ⇒ ${res.status}`);
    return res;
  };
  const base = (map: Record<string, string>, lang: string, what: string) => {
    const b = map[lang];
    if (!b) throw new Error(`no ${what} for ${lang}`);
    return b;
  };
  return {
    template: async (lang) => (await get(`${base(opts.toolchains, lang, "toolchain")}/templates?lang=${lang}`)).body!,
    overlay: async (lang) => (await (await get(`${base(opts.backends, lang, "backend")}/template-overlay/files`)).json()) as Bundle,
    runtime: async (lang) => (await (await get(`${base(opts.backends, lang, "backend")}/runtime/files`)).json()) as Bundle,
    vss: async (release) => (await get(`${opts.catalog}/vss?release=${encodeURIComponent(release)}`)).text(),
  };
}

/** `cpp=http://host:port,python=…` */
export function parseMap(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of text.split(",").map((x) => x.trim()).filter(Boolean)) {
    const [k, v] = item.split("=", 2);
    if (k && v) out[k.trim()] = v.trim();
  }
  return out;
}
