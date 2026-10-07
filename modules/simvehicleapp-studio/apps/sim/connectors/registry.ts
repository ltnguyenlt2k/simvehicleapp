import type { ConnectorMeta, ConnectorMetaRegistry } from '@/connectors/types'

/**
 * Client-safe registry of connector metadata. Imports each connector's `meta.ts`
 * (never the runtime module), so it carries no server-only code and can be used
 * from client components — the metadata counterpart to the full
 * `CONNECTOR_REGISTRY` in `@/connectors/registry.server`, mirroring the
 * `BLOCK_META_REGISTRY` split in `@/blocks/registry`.
 */
export const CONNECTOR_META_REGISTRY: ConnectorMetaRegistry = {
}

/**
 * Look up a single connector's metadata by ID. Returns `undefined` for unknown IDs.
 */
export function getConnectorMeta(connectorId: string): ConnectorMeta | undefined {
  return CONNECTOR_META_REGISTRY[connectorId]
}

/**
 * Return all connector metadata as an ID-keyed record.
 */
export function getAllConnectorMeta(): ConnectorMetaRegistry {
  return CONNECTOR_META_REGISTRY
}
