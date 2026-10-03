/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it } from 'vitest'
import { useUserPermissionConfig } from '@/lib/sv/oss/access-control/hooks'
import {
  assertPermissionsAllowed,
  getUserPermissionConfig,
  IntegrationNotAllowedError,
  InvitationsNotAllowedError,
  McpToolsNotAllowedError,
  ModelNotAllowedError,
  ProviderNotAllowedError,
  PublicApiNotAllowedError,
  PublicFileSharingNotAllowedError,
  resolveWorkspaceGroup,
  validateBlockType,
  validateCustomToolsAllowed,
  validateInvitationsAllowed,
  validateMcpToolsAllowed,
  validateModelProvider,
  validatePublicApiAllowed,
  validatePublicFileSharing,
  validateSkillsAllowed,
} from '@/lib/sv/oss/access-control/permission-check'
import {
  BrandingProvider,
  generateBrandedMetadata,
  generateThemeCSS,
  getBrandConfig,
  getOrgWhitelabelSettings,
  useBrandConfig,
} from '@/lib/sv/oss/brand'
import { SSO_TRUSTED_PROVIDERS } from '@/lib/sv/oss/sso/constants'

const BRAND_ENV = [
  'NEXT_PUBLIC_BRAND_NAME',
  'NEXT_PUBLIC_SUPPORT_EMAIL',
  'NEXT_PUBLIC_BRAND_LOGO_URL',
  'NEXT_PUBLIC_BRAND_PRIMARY_COLOR',
  'NEXT_PUBLIC_BRAND_PRIMARY_HOVER_COLOR',
] as const

afterEach(() => {
  for (const key of BRAND_ENV) delete process.env[key]
})

describe('brand (spec §2)', () => {
  it('defaults to SimVehicleApp and is deterministic', () => {
    const brand = getBrandConfig()
    expect(brand).toMatchObject({
      name: 'SimVehicleApp',
      supportEmail: 'support@simvehicleapp.local',
      isWhitelabeled: true,
      theme: { primaryColor: '#0FC0FF', primaryHoverColor: '#0AA3DB' },
    })
    expect(brand.logoUrl).toBeUndefined()
    expect(getBrandConfig()).toEqual(brand)
    expect(useBrandConfig()).toEqual(brand)
  })

  it('honours NEXT_PUBLIC_BRAND_* overrides', () => {
    process.env.NEXT_PUBLIC_BRAND_NAME = 'Fleet Studio'
    process.env.NEXT_PUBLIC_SUPPORT_EMAIL = 'help@example.com'
    process.env.NEXT_PUBLIC_BRAND_PRIMARY_COLOR = '#112233'
    const brand = getBrandConfig()
    expect(brand.name).toBe('Fleet Studio')
    expect(brand.supportEmail).toBe('help@example.com')
    expect(brand.theme).toMatchObject({ primaryColor: '#112233', primaryHoverColor: undefined })
  })

  it('metadata uses the brand title template and no sim.ai URLs', () => {
    const metadata = generateBrandedMetadata()
    expect(metadata.title).toEqual({ default: 'SimVehicleApp', template: '%s | SimVehicleApp' })
    expect(metadata.applicationName).toBe('SimVehicleApp')
    expect(JSON.stringify(metadata)).not.toContain('sim.ai')
  })

  it('theme CSS overrides the accent variables that exist in globals.css', () => {
    expect(generateThemeCSS()).toBe(
      ':root,.dark{--brand-accent:#0FC0FF;--brand-accent-hover:#0AA3DB}'
    )
  })

  it('has no organization branding and a pass-through provider', async () => {
    await expect(getOrgWhitelabelSettings('org-1')).resolves.toBeNull()
    const child = 'content'
    expect(BrandingProvider({ initialOrgSettings: null, children: child }).props.children).toBe(
      child
    )
  })
})

describe('access control is allow-all (spec §3-4)', () => {
  it('every check resolves, with or without ids', async () => {
    const checks = [
      assertPermissionsAllowed({ userId: 'u', workspaceId: 'w', model: 'gpt-4o', toolKind: 'mcp' }),
      validateBlockType('u', 'w', 'agent'),
      validateBlockType(undefined, undefined, 'agent'),
      validateModelProvider('u', 'w', 'gpt-4o'),
      validateMcpToolsAllowed('u', 'w'),
      validateCustomToolsAllowed(undefined, undefined),
      validateSkillsAllowed('u', 'w'),
      validateInvitationsAllowed('u', { organizationId: 'o' }),
      validateInvitationsAllowed('u', 'w'),
      validatePublicApiAllowed(undefined, undefined),
      validatePublicFileSharing('u', 'w', 'public'),
    ]
    await expect(Promise.all(checks)).resolves.toEqual(checks.map(() => undefined))
  })

  it('no permission group applies', async () => {
    await expect(getUserPermissionConfig('u', 'w')).resolves.toBeNull()
    await expect(resolveWorkspaceGroup('u', 'o', 'w')).resolves.toBeNull()
    expect(useUserPermissionConfig('w')).toEqual({
      data: {
        permissionGroupId: null,
        groupName: null,
        config: null,
        entitled: true,
        organizationId: null,
        isOrgAdmin: false,
      },
      isLoading: false,
    })
  })

  it.each([
    IntegrationNotAllowedError,
    InvitationsNotAllowedError,
    McpToolsNotAllowedError,
    ModelNotAllowedError,
    ProviderNotAllowedError,
    PublicApiNotAllowedError,
    PublicFileSharingNotAllowedError,
  ])('%o is a named Error with a default message', (ErrorClass) => {
    const err = new ErrorClass()
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(ErrorClass)
    expect(err.name).toBe(ErrorClass.name)
    expect(err.message.length).toBeGreaterThan(0)
    expect(new ErrorClass('custom').message).toBe('custom')
  })
})

describe('SSO (spec §5)', () => {
  it('trusts no SSO provider by default', () => {
    expect(SSO_TRUSTED_PROVIDERS).toEqual([])
  })
})
