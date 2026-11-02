import { SV_PHRASES_VI } from '@/lib/sv/i18n/phrases-vi'

/** Template phrases (`Delete {0}`) compiled once: a regex per phrase with a group per placeholder. */
interface Template {
  re: RegExp
  vi: string
}

let templates: Template[] | null = null
const cache = new Map<string, string | null>()
const CACHE_LIMIT = 5000

function compile(): Template[] {
  const out: Template[] = []
  for (const [en, vi] of Object.entries(SV_PHRASES_VI)) {
    if (!/\{\d+\}/.test(en)) continue
    const source = en
      .split(/(\{\d+\})/)
      .map((part) =>
        /^\{\d+\}$/.test(part) ? '(.*?)' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      )
      .join('')
    const order = [...en.matchAll(/\{(\d+)\}/g)].map((m) => Number(m[1]))
    out.push({
      re: new RegExp(`^${source}$`, 's'),
      vi: vi.replace(/\{(\d+)\}/g, (_, n) => `{#${order.indexOf(Number(n))}}`),
    })
  }
  // Longer (more specific) templates first.
  return out.sort((a, b) => b.re.source.length - a.re.source.length)
}

/**
 * Vietnamese for an English UI phrase, or `null` when it is not a known phrase: exact match first, then templates
 * whose variable parts are kept (and translated when they are phrases themselves). Surrounding spaces are kept.
 */
export function svPhraseVi(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed || !/[A-Za-z]/.test(trimmed)) return null
  const cached = cache.get(trimmed)
  if (cached !== undefined) return cached === null ? null : text.replace(trimmed, cached)
  let result: string | null = SV_PHRASES_VI[trimmed] ?? null
  if (result === null) {
    templates ??= compile()
    for (const t of templates) {
      const m = t.re.exec(trimmed)
      if (!m) continue
      const parts = m.slice(1)
      result = t.vi.replace(/\{#(\d+)\}/g, (_, i) => {
        const part = parts[Number(i)] ?? ''
        return SV_PHRASES_VI[part] ?? part
      })
      break
    }
  }
  if (cache.size > CACHE_LIMIT) cache.clear()
  cache.set(trimmed, result)
  return result === null ? null : text.replace(trimmed, result)
}
