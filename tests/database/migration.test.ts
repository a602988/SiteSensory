import { sql } from 'kysely'
import {
    afterAll,
    beforeAll,
    describe,
    expect,
    it,
} from 'vitest'

import {
    createMigrationDatabase,
    migrateToLatest,
    rollbackOne,
    type MigrationDatabase,
} from '../../packages/database/src/index.js'

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
