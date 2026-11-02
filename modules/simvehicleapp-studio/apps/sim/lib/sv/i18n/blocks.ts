import { svClientLocale } from '@/lib/sv/i18n'
import { svPhraseVi } from '@/lib/sv/i18n/phrase'
import { SV_HANDLE_VI } from '@/lib/sv/i18n/phrases-vi'
import type { BlockConfig, SvHandle } from '@/blocks/types'

const vi = (text: string | undefined) => (text ? (svPhraseVi(text) ?? text) : text)

/**
 * Block texts in the page's language (ADR-0072): descriptions, field titles, placeholders, option labels and branch
 * labels. The block `name` stays English — it is the default name of new blocks, which users rename freely
 * (PO 2026-11-01). Browser-only and `vi`-only; the server and English keep the registry as it is.
 */
export function svLocalizeBlocks(registry: Record<string, BlockConfig>): void {
  if (svClientLocale() !== 'vi') return
  for (const block of Object.values(registry)) {
    if (!block.type.startsWith('sv_') && !['note', 'loop', 'parallel'].includes(block.type))
      continue
    block.description = vi(block.description) ?? block.description
    block.longDescription = vi(block.longDescription)
    for (const sub of block.subBlocks ?? []) {
      sub.title = vi(sub.title)
      sub.placeholder = vi(sub.placeholder)
      if (Array.isArray(sub.options)) {
        sub.options = sub.options.map((o) =>
          typeof o === 'object' && o && 'label' in o ? { ...o, label: vi(o.label) ?? o.label } : o
        )
      }
    }
    const handles = block.svHandles
    const label = (h: SvHandle) => ({
      ...h,
      label: SV_HANDLE_VI[h.label] ?? vi(h.label) ?? h.label,
    })
    if (Array.isArray(handles)) block.svHandles = handles.map(label)
    else if (typeof handles === 'function')
      block.svHandles = (values: Record<string, unknown>) => handles(values).map(label)
  }
}
