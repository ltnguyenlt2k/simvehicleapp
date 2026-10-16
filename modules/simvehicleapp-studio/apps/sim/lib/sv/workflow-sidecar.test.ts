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
    mockRequest.mockResolvedValueOnce({ vssRelease: 'v4.2' }).mockResolvedValueOnce({ scenario })
    expect(await fetchSvSidecar('wf1')).toEqual({ vssRelease: 'v4.2', scenario })
    mockRequest
      .mockResolvedValueOnce({ vssRelease: null })
      .mockResolvedValueOnce({ scenario: null })
    expect(await fetchSvSidecar('wf2')).toEqual({})
  })

  it('a failed read does not stop the download', async () => {
    mockRequest.mockRejectedValueOnce(new Error('503')).mockResolvedValueOnce({ scenario })
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
