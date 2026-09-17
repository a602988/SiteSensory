import { loadEnvironment } from '@sitesensory/config'

import { createMigrationDatabase } from './connection.js'
import {
    migrateToLatest,
    rollbackOne,
} from './migrate.js'

/**
 * 執行資料庫 migration CLI，並確保連線在成功或失敗後都會關閉。
 *
 * @returns 完成時不回傳內容。
 */
async function main(): Promise<void>
{
    const environment = loadEnvironment(process.env)
    const command = process.argv[2]
    const database = createMigrationDatabase(environment.DATABASE_URL)

    try {
        const results = command === 'migrate'
            ? await migrateToLatest(database)
            : command === 'rollback'
                ? await rollbackOne(database)
                : undefined

        if (!results) throw new Error('只接受 migrate 或 rollback')

        process.stdout.write(`${JSON.stringify(results)}\n`)
    }
    finally {
        await database.destroy()
    }
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : '未知的 migration 錯誤'
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
})
