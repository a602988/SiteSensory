import type { Migration, MigrationProvider } from 'kysely/migration'

import {
    down,
    up,
} from './001-initial.js'
import {
    down as downDiscoverySource,
    up as upDiscoverySource,
} from './002-discovery-source.js'

const migrations: Record<string, Migration> = {
    '001-initial': {
        down,
        up,
    },
    '002-discovery-source': {
        down: downDiscoverySource,
        up: upDiscoverySource,
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
