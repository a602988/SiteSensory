import type { Kysely } from 'kysely'

import type { DB } from '@sitesensory/database'

export type LocalUser = {
    displayName: string
    id: string
}

export interface LocalAuthStore {
    /**
     * 取得本機管理者；第一次登入時在同一個 transaction 建立帳號與身分。
     *
     * @param displayName 本機管理者顯示名稱。
     * @returns 本機管理者資料。
     */
    getOrCreate(displayName: string): Promise<LocalUser>
}

/**
 * 建立以 PostgreSQL 保存本機帳號的存取介面。
 *
 * @param database SiteSensory 資料庫連線。
 * @returns 本機帳號存取介面。
 */
export function createLocalAuthStore(database: Kysely<DB>): LocalAuthStore
{
    return {
        async getOrCreate(displayName: string): Promise<LocalUser>
        {
            return database.transaction().execute(async transaction => {
                const existing = await transaction
                    .selectFrom('auth_identities')
                    .innerJoin('users', 'users.id', 'auth_identities.user_id')
                    .select([
                        'users.display_name as displayName',
                        'users.id',
                    ])
                    .where('auth_identities.provider', '=', 'local')
                    .where('auth_identities.provider_subject', '=', 'admin')
                    .executeTakeFirst()

                if (existing) return existing

                const user = await transaction
                    .insertInto('users')
                    .values({ display_name: displayName })
                    .returning([
                        'display_name as displayName',
                        'id',
                    ])
                    .executeTakeFirstOrThrow()

                await transaction
                    .insertInto('auth_identities')
                    .values({
                        provider: 'local',
                        provider_subject: 'admin',
                        user_id: user.id,
                    })
                    .execute()

                return user
            })
        },
    }
}
