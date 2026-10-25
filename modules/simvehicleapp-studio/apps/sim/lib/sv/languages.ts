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
/** What an app runs on (ADR-0061): a native Velocitas app, or a WebAssembly guest of sv-wasm-host. */
export const SV_RUNTIMES = [
  { label: 'Velocitas (native app)', value: 'velocitas' },
  { label: 'WebAssembly (sv-wasm-host)', value: 'wasm' },
] as const

export type SvRuntime = (typeof SV_RUNTIMES)[number]['value']

/**
 * Whether `language` can be built for WebAssembly here: its wasm backend and toolchain (`codegen-<lang>-wasm`,
 * `toolchain-<lang>-wasm` in the system status) are both up. Python has no WebAssembly target.
 */
export function wasmAvailable(
  services: { service: string; status: string }[] | undefined,
  language: string
) {
  if (language !== 'cpp' && language !== 'rust') return false
  const up = new Set((services ?? []).filter((s) => s.status === 'ok').map((s) => s.service))
  return up.has(`codegen-${language}-wasm`) && up.has(`toolchain-${language}-wasm`)
}

export function installedLanguages(services: { service: string; status: string }[] | undefined) {
  const up = new Set((services ?? []).filter((s) => s.status === 'ok').map((s) => s.service))
  return SV_LANGUAGES.filter(
    (l) => l.value === 'cpp' || (up.has(`codegen-${l.value}`) && up.has(`toolchain-${l.value}`))
  )
}
