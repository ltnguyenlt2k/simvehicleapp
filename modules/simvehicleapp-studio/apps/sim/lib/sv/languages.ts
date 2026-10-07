/** Languages a vehicle-app project can be generated in (ADR-0020; Python: ADR-0040; Rust, experimental: ADR-0041). */
export const SV_LANGUAGES = [
  { label: 'C++', value: 'cpp' },
  { label: 'Python', value: 'python' },
  { label: 'Rust (experimental)', value: 'rust' },
] as const

export type SvLanguage = (typeof SV_LANGUAGES)[number]['value']

/**
 * Languages this stack can build: a backend (`codegen-<lang>`) and a toolchain (`toolchain-<lang>`) both
 * up in the system status. C++ is always offered, so creation still works while the status loads.
 */
export function installedLanguages(services: { service: string; status: string }[] | undefined) {
  const up = new Set((services ?? []).filter((s) => s.status === 'ok').map((s) => s.service))
  return SV_LANGUAGES.filter(
    (l) => l.value === 'cpp' || (up.has(`codegen-${l.value}`) && up.has(`toolchain-${l.value}`))
  )
}
