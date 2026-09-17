import {
    Migrator,
    type MigrationResult,
} from 'kysely/migration'

import type { MigrationDatabase } from './connection.js'
import { migrationProvider } from './migrations/provider.js'

/**
 * 將資料庫更新到 repository 目前定義的最新版本。
 *
 * @param database Kysely 資料庫連線。
 * @returns 本次實際執行的 migration 結果。
 */
export async function migrateToLatest(database: MigrationDatabase): Promise<readonly MigrationResult[]>
{
    const migrator = new Migrator({
        db: database,
        provider: migrationProvider,
    })
    const { error, results = [] } = await migrator.migrateToLatest()

    if (error) throw error

    return results
}

/**
 * 回滾最近一筆已套用的 migration。
 *
 * @param database Kysely 資料庫連線。
 * @returns 本次實際執行的 migration 結果。
 */
export async function rollbackOne(database: MigrationDatabase): Promise<readonly MigrationResult[]>
{
    const migrator = new Migrator({
        db: database,
        provider: migrationProvider,
    })
    const { error, results = [] } = await migrator.migrateDown()

    if (error) throw error

    return results
}
