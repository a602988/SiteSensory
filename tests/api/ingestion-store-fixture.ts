import { randomUUID } from 'node:crypto'

import type { IngestionJob } from '../../packages/contracts/src/api.js'
import type { IngestionStore } from '../../apps/api/src/ingestion-store.js'

/**
 * 建立供 API 契約測試使用的記憶體收錄工作儲存介面。
 *
 * @returns 支援冪等識別碼與工作查詢的測試實作。
 */
export function createMemoryIngestionStore(): IngestionStore
{
    const jobs = new Map<string, IngestionJob>()
    const keys = new Map<string, string>()

    return {
        async createOrReuse(inputUrl, normalizedUrl, idempotencyKey)
        {
            const existingId = keys.get(idempotencyKey)

            if (existingId) return jobs.get(existingId) as IngestionJob

            const job: IngestionJob = {
                createdAt: new Date().toISOString(),
                currentStage: null,
                id: randomUUID(),
                inputUrl,
                lastErrorCode: null,
                normalizedUrl,
                retryCount: 0,
                state: 'queued',
            }
            jobs.set(job.id, job)
            keys.set(idempotencyKey, job.id)

            return job
        },
        async get(id)
        {
            return jobs.get(id) ?? null
        },
    }
}
