import {
    Kysely,
    PostgresDialect,
} from 'kysely'
import { Pool } from 'pg'

import type { DB } from './types.js'

export type MigrationDatabase = Kysely<Record<string, never>>

/**
 * 建立共用的 PostgreSQL dialect，讓正式查詢與 migration 使用相同連線設定。
 *
 * @param connectionString PostgreSQL 連線字串。
 * @returns Kysely 資料庫連線。
 */
function createPostgresDatabase<Database>(connectionString: string): Kysely<Database>
{
    const pool = new Pool({
        connectionString,
        max: 5,
    })

    return new Kysely<Database>({
        dialect: new PostgresDialect({ pool }),
    })
}

/**
 * 建立供 migration 與資料庫工具使用的 PostgreSQL 連線。
 *
 * @param connectionString PostgreSQL 連線字串。
 * @returns Kysely 資料庫連線。
 */
export function createMigrationDatabase(connectionString: string): MigrationDatabase
{
    return createPostgresDatabase<Record<string, never>>(connectionString)
}

/**
 * 建立具備第一版 schema 型別的正式資料庫連線。
 *
 * @param connectionString PostgreSQL 連線字串。
 * @returns 可供 service layer 使用的 Kysely 資料庫連線。
 */
export function createDatabase(connectionString: string): Kysely<DB>
{
    return createPostgresDatabase<DB>(connectionString)
}
