import { randomUUID } from 'node:crypto'

import type { Kysely } from 'kysely'
import { sql } from 'kysely'

import type { IngestionJob } from '@sitesensory/contracts'
import type { DB } from '@sitesensory/database'

const ACTIVE_STATES = [
    'queued',
    'resolving',
    'capturing',
    'comparing',
    'embedding',
    'awaiting_analysis',
    'analyzing',
    'quality_check',
    'review_required',
] as const

export type ClaimedJob = IngestionJob & {
    leaseToken: string
}

export interface IngestionStore {
    /**
     * 原子建立或重用相同請求與網址的工作。
     *
     * @param inputUrl 呼叫端保留的原始網址。
     * @param normalizedUrl 安全檢查後的正規網址。
     * @param idempotencyKey 呼叫端產生的冪等識別碼。
     * @returns 新建或已存在的工作。
     */
    createOrReuse(inputUrl: string, normalizedUrl: string, idempotencyKey: string): Promise<IngestionJob>

    /**
     * 取得工作目前狀態。
     *
     * @param id 工作識別碼。
     * @returns 工作不存在時回傳 null。
     */
    get(id: string): Promise<IngestionJob | null>
}

export interface JobQueue {
    /**
     * 以 PostgreSQL row lock 原子領取一筆可執行工作。
     *
     * @param workerId worker 識別碼。
     * @param leaseSeconds lease 有效秒數。
     * @returns 已領取的工作；沒有工作時回傳 null。
     */
    claim(workerId: string, leaseSeconds: number): Promise<ClaimedJob | null>

    /**
     * 記錄失敗並依可重試狀態重新排程。
     *
     * @param jobId 工作識別碼。
     * @param leaseToken 領取工作時取得的 lease token。
     * @param errorCode 穩定錯誤碼。
     * @param summary 不包含秘密的錯誤摘要。
     * @param retryable 是否允許重試。
     * @returns lease 仍有效且更新成功時為 true。
     */
    fail(
        jobId: string,
        leaseToken: string,
        errorCode: string,
        summary: string,
        retryable: boolean,
    ): Promise<boolean>

    /**
     * 延長目前 worker 的 lease。
     *
     * @param jobId 工作識別碼。
     * @param leaseToken 領取工作時取得的 lease token。
     * @param leaseSeconds 新的 lease 有效秒數。
     * @returns lease 仍有效且更新成功時為 true。
     */
    renew(jobId: string, leaseToken: string, leaseSeconds: number): Promise<boolean>
}

export class IngestionConflictError extends Error
{
    /**
     * 建立冪等識別碼與網址不一致的衝突錯誤。
     */
    constructor()
    {
        super('相同的 idempotency key 已用於另一個網址。')
        this.name = 'IngestionConflictError'
    }
}

/**
 * 建立 PostgreSQL 收錄工作與佇列存取介面。
 *
 * @param database SiteSensory 資料庫連線。
 * @returns 收錄工作與原子 queue 操作。
 */
export function createIngestionStore(database: Kysely<DB>): IngestionStore & JobQueue
{
    return {
        async claim(workerId, leaseSeconds)
        {
            assertLeaseSeconds(leaseSeconds)

            return database.transaction().execute(async transaction => {
                const job = await transaction
                    .selectFrom('ingestion_jobs')
                    .selectAll()
                    .where(expression => expression.or([
                        expression.and([
                            expression('state', '=', 'queued'),
                            expression('available_at', '<=', sql<Date>`now()`),
                        ]),
                        expression.and([
                            expression('state', '=', 'resolving'),
                            expression('lease_expires_at', '<', sql<Date>`now()`),
                        ]),
                    ]))
                    .orderBy('created_at')
                    .forUpdate()
                    .skipLocked()
                    .executeTakeFirst()

                if (!job) return null

                const leaseToken = randomUUID()
                const retryCount = job.state === 'queued' ? job.retry_count : job.retry_count + 1

                if (job.state === 'resolving') {
                    await transaction
                        .updateTable('job_attempts')
                        .set({
                            completed_at: sql<Date>`now()`,
                            error_code: 'LEASE_EXPIRED',
                            error_summary: 'worker lease expired before completion',
                            status: 'failed',
                        })
                        .where('job_id', '=', job.id)
                        .where('status', '=', 'running')
                        .execute()
                }

                const updated = await transaction
                    .updateTable('ingestion_jobs')
                    .set({
                        current_stage: 'resolving',
                        lease_expires_at: sql<Date>`now() + (${leaseSeconds} * interval '1 second')`,
                        lease_owner: workerId,
                        lease_token: leaseToken,
                        retry_count: retryCount,
                        started_at: job.started_at ?? sql<Date>`now()`,
                        state: 'resolving',
                        updated_at: sql<Date>`now()`,
                    })
                    .where('id', '=', job.id)
                    .returningAll()
                    .executeTakeFirstOrThrow()

                await transaction
                    .insertInto('job_attempts')
                    .values({
                        attempt_number: retryCount + 1,
                        job_id: job.id,
                        stage: 'resolving',
                        started_at: sql<Date>`now()`,
                        status: 'running',
                    })
                    .execute()

                return {
                    ...toIngestionJob(updated),
                    leaseToken,
                }
            })
        },
        async createOrReuse(inputUrl, normalizedUrl, idempotencyKey)
        {
            return database.transaction().execute(async transaction => {
                await sql`SELECT pg_advisory_xact_lock(hashtextextended(${idempotencyKey}, 0))`.execute(transaction)
                await sql`SELECT pg_advisory_xact_lock(hashtextextended(${normalizedUrl}, 1))`.execute(transaction)

                const byKey = await transaction
                    .selectFrom('ingestion_jobs')
                    .selectAll()
                    .where('idempotency_key', '=', idempotencyKey)
                    .executeTakeFirst()

                if (byKey) {
                    if (byKey.normalized_url !== normalizedUrl) throw new IngestionConflictError()

                    return toIngestionJob(byKey)
                }

                const active = await transaction
                    .selectFrom('ingestion_jobs')
                    .selectAll()
                    .where('normalized_url', '=', normalizedUrl)
                    .where('state', 'in', ACTIVE_STATES)
                    .orderBy('created_at', 'desc')
                    .executeTakeFirst()

                if (active) return toIngestionJob(active)

                const created = await transaction
                    .insertInto('ingestion_jobs')
                    .values({
                        idempotency_key: idempotencyKey,
                        input_url: inputUrl,
                        normalized_url: normalizedUrl,
                    })
                    .returningAll()
                    .executeTakeFirstOrThrow()

                return toIngestionJob(created)
            })
        },
        async fail(jobId, leaseToken, errorCode, summary, retryable)
        {
            return database.transaction().execute(async transaction => {
                const job = await transaction
                    .selectFrom('ingestion_jobs')
                    .selectAll()
                    .where('id', '=', jobId)
                    .where('lease_token', '=', leaseToken)
                    .where('lease_expires_at', '>', sql<Date>`now()`)
                    .forUpdate()
                    .executeTakeFirst()

                if (!job) return false

                const retryCount = job.retry_count + 1
                const canRetry = retryable && retryCount < 3

                await transaction
                    .updateTable('ingestion_jobs')
                    .set({
                        available_at: canRetry
                            ? sql<Date>`now() + (${retryCount * 30} * interval '1 second')`
                            : sql<Date>`now()`,
                        last_error_code: errorCode,
                        last_error_summary: summary,
                        lease_expires_at: null,
                        lease_owner: null,
                        lease_token: null,
                        retry_count: retryCount,
                        state: canRetry ? 'queued' : 'failed',
                        updated_at: sql<Date>`now()`,
                    })
                    .where('id', '=', jobId)
                    .executeTakeFirstOrThrow()

                await transaction
                    .updateTable('job_attempts')
                    .set({
                        completed_at: sql<Date>`now()`,
                        error_code: errorCode,
                        error_summary: summary,
                        status: 'failed',
                    })
                    .where('job_id', '=', jobId)
                    .where('status', '=', 'running')
                    .execute()

                return true
            })
        },
        async get(id)
        {
            const row = await database
                .selectFrom('ingestion_jobs')
                .selectAll()
                .where('id', '=', id)
                .executeTakeFirst()

            return row ? toIngestionJob(row) : null
        },
        async renew(jobId, leaseToken, leaseSeconds)
        {
            assertLeaseSeconds(leaseSeconds)

            const result = await database
                .updateTable('ingestion_jobs')
                .set({
                    lease_expires_at: sql<Date>`now() + (${leaseSeconds} * interval '1 second')`,
                    updated_at: sql<Date>`now()`,
                })
                .where('id', '=', jobId)
                .where('lease_token', '=', leaseToken)
                .where('lease_expires_at', '>', sql<Date>`now()`)
                .executeTakeFirst()

            return result.numUpdatedRows > 0n
        },
    }
}

type IngestionRow = {
    created_at: Date
    current_stage: string | null
    id: string
    input_url: string
    last_error_code: string | null
    normalized_url: string | null
    retry_count: number
    state: string
}

/**
 * 將資料庫工作轉成不包含 lease 秘密的 API 格式。
 *
 * @param row 資料庫工作。
 * @returns 可供內部 API 回傳的工作狀態。
 */
function toIngestionJob(row: IngestionRow): IngestionJob
{
    return {
        createdAt: row.created_at.toISOString(),
        currentStage: row.current_stage,
        id: row.id,
        inputUrl: row.input_url,
        lastErrorCode: row.last_error_code,
        normalizedUrl: row.normalized_url,
        retryCount: row.retry_count,
        state: row.state as IngestionJob['state'],
    }
}

/**
 * 限制 lease 時間，避免錯誤設定造成工作長期鎖定。
 *
 * @param seconds lease 有效秒數。
 * @returns 驗證通過時不回傳內容。
 */
function assertLeaseSeconds(seconds: number): void
{
    if (!Number.isInteger(seconds) || seconds < 5 || seconds > 300) {
        throw new Error('leaseSeconds 必須是 5 到 300 的整數')
    }
}
