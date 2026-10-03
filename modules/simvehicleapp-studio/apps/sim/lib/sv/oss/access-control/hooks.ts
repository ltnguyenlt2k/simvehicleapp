import type { PermissionGroupConfig } from '@/lib/permission-groups/types'

/** Same shape as the `GET /api/permission-groups/user` response. */
export interface UserPermissionConfig {
  permissionGroupId: string | null
  groupName: string | null
  config: PermissionGroupConfig | null
  entitled: boolean
  organizationId: string | null
  isOrgAdmin: boolean
}

const NO_PERMISSION_GROUP: UserPermissionConfig = {
  permissionGroupId: null,
  groupName: null,
  config: null,
  entitled: true,
  organizationId: null,
  isOrgAdmin: false,
}

/**
 * Permission config of the current user for a workspace. Allow-all in v1: no request is made and no
 * group applies, so callers fall back to `DEFAULT_PERMISSION_GROUP_CONFIG`.
 */
export function useUserPermissionConfig(_workspaceId?: string): {
  data: UserPermissionConfig
  isLoading: false
} {
  return { data: NO_PERMISSION_GROUP, isLoading: false }
}
