import type { ShareAuthType } from '@/lib/api/contracts/public-shares'
import type { PermissionGroupConfig } from '@/lib/permission-groups/types'
import type { ExecutionContext } from '@/executor/types'

/**
 * Allow-all access control (clean-room replacement of the removed Enterprise permission groups,
 * spec: docs/specs/M01-T02a-oss-clean-room-spec.md §3). Every check resolves; vehicle-specific
 * entitlements (SynCode, Run, Export) belong to the orchestrator EntitlementService (ADR-0031).
 */

/** Base class so callers can tell access-control denials apart from other errors. */
class AccessDeniedError extends Error {
  constructor(name: string, message: string) {
    super(message)
    this.name = name
  }
}

export class IntegrationNotAllowedError extends AccessDeniedError {
  constructor(message = 'This integration is not allowed') {
    super('IntegrationNotAllowedError', message)
  }
}

export class InvitationsNotAllowedError extends AccessDeniedError {
  constructor(message = 'Invitations are not allowed') {
    super('InvitationsNotAllowedError', message)
  }
}

export class McpToolsNotAllowedError extends AccessDeniedError {
  constructor(message = 'MCP tools are not allowed') {
    super('McpToolsNotAllowedError', message)
  }
}

export class ModelNotAllowedError extends AccessDeniedError {
  constructor(message = 'This model is not allowed') {
    super('ModelNotAllowedError', message)
  }
}

export class ProviderNotAllowedError extends AccessDeniedError {
  constructor(message = 'This model provider is not allowed') {
    super('ProviderNotAllowedError', message)
  }
}

export class PublicApiNotAllowedError extends AccessDeniedError {
  constructor(message = 'Public API access is not allowed') {
    super('PublicApiNotAllowedError', message)
  }
}

export class PublicFileSharingNotAllowedError extends AccessDeniedError {
  constructor(message = 'Public file sharing is not allowed') {
    super('PublicFileSharingNotAllowedError', message)
  }
}

export interface ResolvedWorkspaceGroup {
  permissionGroupId: string
  groupName: string
  config: PermissionGroupConfig
}

export interface AssertPermissionsOptions {
  userId: string
  workspaceId: string
  model?: string
  toolKind?: 'skill' | 'custom' | 'mcp'
  ctx?: ExecutionContext
}

/** No permission group applies; callers fall back to their environment allowlists. */
export async function getUserPermissionConfig(
  _userId: string | undefined,
  _workspaceId: string | undefined
): Promise<PermissionGroupConfig | null> {
  return null
}

/** No permission group applies to any workspace. */
export async function resolveWorkspaceGroup(
  _userId: string,
  _organizationId: string | null | undefined,
  _workspaceId: string | null | undefined
): Promise<ResolvedWorkspaceGroup | null> {
  return null
}

export async function assertPermissionsAllowed(_options: AssertPermissionsOptions): Promise<void> {}

export async function validateBlockType(
  _userId: string | undefined,
  _workspaceId: string | undefined,
  _blockType: string,
  _ctx?: ExecutionContext
): Promise<void> {}

export async function validateModelProvider(
  _userId: string | undefined,
  _workspaceId: string | undefined,
  _model: string,
  _ctx?: ExecutionContext
): Promise<void> {}

export async function validateMcpToolsAllowed(
  _userId: string | undefined,
  _workspaceId: string | undefined,
  _ctx?: ExecutionContext
): Promise<void> {}

export async function validateCustomToolsAllowed(
  _userId: string | undefined,
  _workspaceId: string | undefined,
  _ctx?: ExecutionContext
): Promise<void> {}

export async function validateSkillsAllowed(
  _userId: string | undefined,
  _workspaceId: string | undefined,
  _ctx?: ExecutionContext
): Promise<void> {}

export async function validateInvitationsAllowed(
  _userId: string | undefined,
  _scope: string | { organizationId: string } | undefined
): Promise<void> {}

export async function validatePublicApiAllowed(
  _userId: string | undefined,
  _workspaceId: string | undefined
): Promise<void> {}

export async function validatePublicFileSharing(
  _userId: string | undefined,
  _workspaceId: string | undefined,
  _authType: ShareAuthType
): Promise<void> {}
