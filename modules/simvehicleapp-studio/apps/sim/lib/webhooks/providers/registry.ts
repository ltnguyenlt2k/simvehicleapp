import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { circlebackHandler } from '@/lib/webhooks/providers/circleback'
import { genericHandler } from '@/lib/webhooks/providers/generic'
import { imapHandler } from '@/lib/webhooks/providers/imap'
import { rssHandler } from '@/lib/webhooks/providers/rss'
import { tableProviderHandler } from '@/lib/webhooks/providers/table'
import type { WebhookProviderHandler } from '@/lib/webhooks/providers/types'
import { verifyTokenAuth } from '@/lib/webhooks/providers/utils'

const logger = createLogger('WebhookProviderRegistry')

const PROVIDER_HANDLERS: Record<string, WebhookProviderHandler> = {
  circleback: circlebackHandler,
  generic: genericHandler,
  imap: imapHandler,
  rss: rssHandler,
  table: tableProviderHandler,
}

/**
 * Default handler for unknown/future providers.
 * Uses timing-safe comparison for bearer token validation.
 */
const defaultHandler: WebhookProviderHandler = {
  verifyAuth({ request, requestId, providerConfig }) {
    const token = providerConfig.token
    if (typeof token === 'string') {
      if (!verifyTokenAuth(request, token)) {
        logger.warn(`[${requestId}] Unauthorized webhook access attempt - invalid token`)
        return new NextResponse('Unauthorized', { status: 401 })
      }
    }
    return null
  },
}

/** Look up the provider handler, falling back to the default bearer token handler. */
export function getProviderHandler(provider: string): WebhookProviderHandler {
  return PROVIDER_HANDLERS[provider] ?? defaultHandler
}
