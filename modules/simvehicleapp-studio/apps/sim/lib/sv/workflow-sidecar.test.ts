/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequest } = vi.hoisted(() => ({ mockRequest: vi.fn() }))
vi.mock('@/lib/api/client/request', () => ({ requestJson: mockRequest }))

import { fetchSvSidecar, readSvSidecar, restoreSvSidecar } from '@/lib/sv/workflow-sidecar'

const scenario = {
  scenarioVersion: '1.0.0',
  name: 'LKA',
  until: 2000,
  inputs: [{ t: 1000, path: 'Vehicle.Speed', value: 60 }],
}

beforeEach(() => vi.clearAllMocks())

describe('workflow vehicle data in downloads (ADR-0056)', () => {
  it('reads the release and scenario; an empty object for a default-release workflow', async () => {
    mockRequest
      .mockResolvedValueOnce({ vssRelease: 'v4.2' })
      .mockResolvedValueOnce({ scenario })
      .mockResolvedValueOnce({ cases: [] })
    expect(await fetchSvSidecar('wf1')).toEqual({ vssRelease: 'v4.2', scenario })
    mockRequest
      .mockResolvedValueOnce({ vssRelease: null })
      .mockResolvedValueOnce({ scenario: null })
      .mockResolvedValueOnce({ cases: [] })
    expect(await fetchSvSidecar('wf2')).toEqual({})
  })

  it('a failed read does not stop the download', async () => {
    mockRequest
      .mockRejectedValueOnce(new Error('503'))
      .mockResolvedValueOnce({ scenario })
      .mockRejectedValueOnce(new Error('503'))
    expect(await fetchSvSidecar('wf1')).toEqual({ scenario })
  })

  it('import: present key (even empty) vs file exported before M17; invalid parts dropped', () => {
    expect(readSvSidecar({ state: {} })).toBeUndefined()
    expect(readSvSidecar({ state: {}, simvehicleapp: {} })).toEqual({})
    expect(readSvSidecar({ simvehicleapp: { vssRelease: 'v4.2', scenario } })).toEqual({
      vssRelease: 'v4.2',
      scenario,
    })
    expect(readSvSidecar({ simvehicleapp: { vssRelease: 'nope', scenario: { name: 1 } } })).toEqual(
      {}
    )
  })

  it('restores both, and reports what could not be kept', async () => {
    mockRequest.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('400'))
    expect(await restoreSvSidecar('wf9', { vssRelease: 'v4.2', scenario })).toEqual(['scenario'])
    expect(mockRequest.mock.calls[0][1]).toEqual({
      params: { id: 'wf9' },
      body: { vssRelease: 'v4.2' },
    })
    expect(mockRequest.mock.calls[1][1]).toEqual({ params: { id: 'wf9' }, body: { scenario } })
    expect(await restoreSvSidecar('wf9', {})).toEqual([])
  })
})

describe('test cases in downloads (ADR-0058, M18-T02)', () => {
  it('downloads every case; an import creates them in order (the scenario only for older files)', async () => {
    const cases = [
      { id: 'tc_1', name: 'Above', scenario, position: 0 },
      { id: 'tc_2', name: 'Below', scenario: { ...scenario, name: 'Below' }, position: 1 },
    ]
    mockRequest
      .mockResolvedValueOnce({ vssRelease: null })
      .mockResolvedValueOnce({ scenario })
      .mockResolvedValueOnce({ cases })
    const sidecar = await fetchSvSidecar('wf1')
    expect(sidecar.testCases?.map((c) => c.name)).toEqual(['Above', 'Below'])
    const read = readSvSidecar({
      simvehicleapp: { ...sidecar, testCases: [...sidecar.testCases!, { name: '', scenario }] },
    })
    expect(read?.testCases?.map((c) => c.name)).toEqual(['Above', 'Below'])
    mockRequest.mockReset()
    mockRequest.mockResolvedValue({})
    expect(await restoreSvSidecar('wf9', read!)).toEqual([])
    const bodies = mockRequest.mock.calls.map((c) => c[1].body)
    expect(bodies).toEqual([
      { name: 'Above', scenario },
      { name: 'Below', scenario: { ...scenario, name: 'Below' } },
    ])
  })
})
