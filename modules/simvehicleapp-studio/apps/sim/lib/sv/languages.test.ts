/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { installedLanguages, wasmAvailable } from '@/lib/sv/languages'

describe('installedLanguages (ADR-0040)', () => {
  it('offers C++ always and Python only when its backend and toolchain are up', () => {
    expect(installedLanguages(undefined).map((l) => l.value)).toEqual(['cpp'])
    const cppOnly = [
      { service: 'codegen-cpp', status: 'ok' },
      { service: 'toolchain-cpp', status: 'ok' },
    ]
    expect(installedLanguages(cppOnly).map((l) => l.value)).toEqual(['cpp'])
    const both = [
      ...cppOnly,
      { service: 'codegen-python', status: 'ok' },
      { service: 'toolchain-python', status: 'ok' },
    ]
    expect(installedLanguages(both).map((l) => l.value)).toEqual(['cpp', 'python'])
    const pyDown = [
      ...cppOnly,
      { service: 'codegen-python', status: 'ok' },
      { service: 'toolchain-python', status: 'down' },
    ]
    expect(installedLanguages(pyDown).map((l) => l.value)).toEqual(['cpp'])
    const rust = [
      ...cppOnly,
      { service: 'codegen-rust', status: 'ok' },
      { service: 'toolchain-rust', status: 'ok' },
    ]
    expect(installedLanguages(rust).map((l) => l.label)).toEqual(['C++', 'Rust (experimental)'])
  })
})

describe('wasmAvailable (ADR-0061)', () => {
  it('needs the language wasm backend and toolchain up; never for Python', () => {
    const up = [
      { service: 'codegen-cpp-wasm', status: 'ok' },
      { service: 'toolchain-cpp-wasm', status: 'ok' },
      { service: 'codegen-rust-wasm', status: 'ok' },
      { service: 'toolchain-rust-wasm', status: 'down' },
    ]
    expect(wasmAvailable(up, 'cpp')).toBe(true)
    expect(wasmAvailable(up, 'rust')).toBe(false)
    expect(wasmAvailable(up, 'python')).toBe(false)
    expect(wasmAvailable(undefined, 'cpp')).toBe(false)
  })
})
