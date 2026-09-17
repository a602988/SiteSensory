import type { Migration, MigrationProvider } from 'kysely/migration'

import {
    down,
    up,
} from './001-initial.js'

const migrations: Record<string, Migration> = {
    '001-initial': {
        down,
        up,
    },
}

export const migrationProvider: MigrationProvider = {
    /**
     * 回傳已依檔名排序的 migration 集合。
     *
     * @returns Kysely 可執行的 migration。
     */
    async getMigrations(): Promise<Record<string, Migration>>
    {
        return migrations
    },
}
