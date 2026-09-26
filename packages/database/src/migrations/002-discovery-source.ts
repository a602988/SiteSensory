import { sql, type Kysely } from 'kysely'

/**
 * 把收錄來源網址放到 pages，不再塞進假的分析 JSON。
 * DBCut 文章網址與頁面最終網址不是同一件事。
 *
 * @param database Kysely migration 連線。
 * @returns 完成時不回傳內容。
 */
export async function up(database: Kysely<unknown>): Promise<void>
{
    await sql`
        ALTER TABLE pages
            ADD COLUMN discovery_source_url text
    `.execute(database)
}

/**
 * 移除收錄來源欄位。
 *
 * @param database Kysely migration 連線。
 * @returns 完成時不回傳內容。
 */
export async function down(database: Kysely<unknown>): Promise<void>
{
    await sql`
        ALTER TABLE pages
            DROP COLUMN IF EXISTS discovery_source_url
    `.execute(database)
}
