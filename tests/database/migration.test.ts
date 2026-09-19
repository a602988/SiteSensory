import { sql } from 'kysely'
import {
    afterAll,
    beforeAll,
    describe,
    expect,
    it,
} from 'vitest'

import {
    createDatabase,
    createMigrationDatabase,
    migrateToLatest,
    rollbackOne,
    type MigrationDatabase,
} from '../../packages/database/src/index.js'
import { createPrivateStore } from '../../apps/api/src/private-store.js'
import {
    createIngestionStore,
    IngestionConflictError,
} from '../../apps/api/src/ingestion-store.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const integration = databaseUrl ? describe : describe.skip
let database: MigrationDatabase

integration('database migration', () => {
    beforeAll(() => {
        database = createMigrationDatabase(databaseUrl as string)
    })

    afterAll(async () => {
        await database.destroy()
    })

    it('applies seeds, protects created_at, and rolls back', async () => {
        const migrationResults = await migrateToLatest(database)

        expect(migrationResults).toHaveLength(1)

        const extension = await sql<{ extversion: string }>`
            SELECT extversion FROM pg_extension WHERE extname = 'vector'
        `.execute(database)
        const applicationTables = await sql<{ table_name: string }>`
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_type = 'BASE TABLE'
              AND table_name NOT LIKE 'kysely_%'
            ORDER BY table_name
        `.execute(database)
        const tablesWithoutCreatedAt = await sql<{ table_name: string }>`
            SELECT tables.table_name
            FROM information_schema.tables AS tables
            WHERE tables.table_schema = 'public'
              AND tables.table_type = 'BASE TABLE'
              AND tables.table_name NOT LIKE 'kysely_%'
              AND NOT EXISTS (
                  SELECT 1
                  FROM information_schema.columns AS columns
                  WHERE columns.table_schema = tables.table_schema
                    AND columns.table_name = tables.table_name
                    AND columns.column_name = 'created_at'
              )
        `.execute(database)
        const pageTypes = await sql<{ count: string }>`
            SELECT count(*)::text AS count FROM page_types
        `.execute(database)

        expect(extension.rows[0]?.extversion).toBe('0.8.6')
        expect(applicationTables.rows).toHaveLength(25)
        expect(tablesWithoutCreatedAt.rows).toEqual([])
        expect(pageTypes.rows[0]?.count).toBe('13')

        const privateDatabase = createDatabase(databaseUrl as string)
        const privateStore = createPrivateStore(privateDatabase)
        const ingestionStore = createIngestionStore(privateDatabase)
        const users = await sql<{ id: string }>`
            INSERT INTO users (display_name)
            VALUES ('User A'), ('User B')
            RETURNING id
        `.execute(database)
        const userAId = users.rows[0]?.id as string
        const userBId = users.rows[1]?.id as string
        const pageVersion = await sql<{ id: string }>`
            WITH inserted_site AS (
                INSERT INTO sites (registrable_domain, name)
                VALUES ('example.com', 'Example')
                RETURNING id
            ), inserted_page AS (
                INSERT INTO pages (site_id, canonical_url, normalized_url_hash)
                SELECT id, 'https://example.com/', 'migration-test-page'
                FROM inserted_site
                RETURNING id
            )
            INSERT INTO page_versions (
                page_id,
                version_number,
                final_url,
                content_fingerprint,
                capture_profile_key,
                captured_at
            )
            SELECT id, 1, 'https://example.com/', 'migration-test-version', 'desktop-1920', now()
            FROM inserted_page
            RETURNING id
        `.execute(database)
        const pageVersionId = pageVersion.rows[0]?.id as string
        const tag = await privateStore.createTag(userAId, { name: '留白版面' })
        const savedView = await privateStore.createSavedView(userAId, {
            height: 0.4,
            pageVersionId,
            reason: '內容層級清楚',
            tagIds: [tag.id],
            width: 0.5,
            x: 0.1,
            y: 0.2,
        })

        expect(savedView?.tagIds).toEqual([tag.id])
        expect((await privateStore.listSavedViews(userBId, 1)).items).toEqual([])
        expect(await privateStore.updateSavedView(userBId, savedView?.id as string, {
            reason: '不應成功',
        })).toBeNull()
        expect(await privateStore.deleteSavedView(userBId, savedView?.id as string)).toBe(false)

        const [firstJob, repeatedUrlJob] = await Promise.all([
            ingestionStore.createOrReuse(
                'https://example.com/?utm_source=test',
                'https://example.com/',
                'migration-ingestion-a',
            ),
            ingestionStore.createOrReuse(
                'https://example.com/',
                'https://example.com/',
                'migration-ingestion-b',
            ),
        ])

        expect(repeatedUrlJob.id).toBe(firstJob.id)
        await expect(ingestionStore.createOrReuse(
            'https://example.org/',
            'https://example.org/',
            'migration-ingestion-a',
        )).rejects.toBeInstanceOf(IngestionConflictError)

        const claims = await Promise.all([
            ingestionStore.claim('worker-a', 30),
            ingestionStore.claim('worker-b', 30),
        ])
        const claimed = claims.find(job => job !== null)

        expect(claims.filter(job => job !== null)).toHaveLength(1)
        expect(claimed?.state).toBe('resolving')
        expect(await ingestionStore.renew(firstJob.id, 'invalid-token', 30)).toBe(false)
        await sql`
            UPDATE ingestion_jobs
            SET lease_expires_at = now() - interval '1 second'
            WHERE id = ${firstJob.id}
        `.execute(database)
        const reclaimed = await ingestionStore.claim('worker-c', 30)

        expect(reclaimed?.retryCount).toBe(1)
        expect(reclaimed?.leaseToken).not.toBe(claimed?.leaseToken)
        expect(await ingestionStore.fail(
            firstJob.id,
            reclaimed?.leaseToken as string,
            'CAPTURE_FAILED',
            'test failure',
            true,
        )).toBe(true)
        expect(await ingestionStore.get(firstJob.id)).toMatchObject({
            retryCount: 2,
            state: 'queued',
        })

        await privateDatabase.destroy()

        const user = await sql<{ id: string }>`
            INSERT INTO users (display_name) VALUES ('Migration test') RETURNING id
        `.execute(database)
        const userId = user.rows[0]?.id

        await expect(sql`
            UPDATE users SET created_at = created_at - interval '1 day' WHERE id = ${userId}
        `.execute(database)).rejects.toThrow('created_at is immutable')

        const rollbackResults = await rollbackOne(database)
        const usersTable = await sql<{ relation: string | null }>`
            SELECT to_regclass('public.users')::text AS relation
        `.execute(database)

        expect(rollbackResults).toHaveLength(1)
        expect(usersTable.rows[0]?.relation).toBeNull()
    })
})
