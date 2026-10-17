import { svWorkflowSettings } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import { copyTestCases } from '@/lib/sv/server/test-cases'

/**
 * Copies the vehicle data of a workflow — pinned VSS release and test cases (ADR-0058) — to its duplicate, in the duplication's
 * transaction (ADR-0056, M17-T03). Without it a v4.2 workflow duplicated onto the default release and lost its test.
 */
export async function copySvWorkflowData(tx: DbOrTx, fromId: string, toId: string): Promise<void> {
  const [settings] = await tx
    .select({ vssRelease: svWorkflowSettings.vssRelease })
    .from(svWorkflowSettings)
    .where(eq(svWorkflowSettings.workflowId, fromId))
    .limit(1)
  if (settings) {
    await tx
      .insert(svWorkflowSettings)
      .values({ workflowId: toId, vssRelease: settings.vssRelease })
  }
  await copyTestCases(tx, fromId, toId)
}
