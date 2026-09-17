import { z } from 'zod'

import { loadEnvironment } from '@sitesensory/config'
import { createDatabase } from '@sitesensory/database'

import { buildApp } from './app.js'
import { createLocalAuthStore } from './auth-store.js'

const apiEnvironmentSchema = z.object({
    LOCAL_ADMIN_NAME: z.string().trim().min(1).default('SiteSensory 管理者'),
    LOCAL_PASSWORD_HASH: z.string().startsWith('scrypt-v1$'),
    SESSION_KEY_HEX: z.string().regex(/^[a-f0-9]{64}$/),
})

/**
 * 啟動只監聽 loopback 的 API，並在關閉時釋放資料庫連線。
 *
 * @returns 伺服器停止時完成。
 */
async function main(): Promise<void>
{
    const environment = loadEnvironment(process.env)
    const apiEnvironment = apiEnvironmentSchema.parse(process.env)
    const database = createDatabase(environment.DATABASE_URL)
    const app = await buildApp({
        authStore: createLocalAuthStore(database),
        localAdminName: apiEnvironment.LOCAL_ADMIN_NAME,
        localPasswordHash: apiEnvironment.LOCAL_PASSWORD_HASH,
        logger: true,
        sessionKey: Buffer.from(apiEnvironment.SESSION_KEY_HEX, 'hex'),
    })

    const close = async (): Promise<void> => {
        await app.close()
        await database.destroy()
    }

    process.once('SIGINT', close)
    process.once('SIGTERM', close)

    await app.listen({
        host: environment.API_HOST,
        port: environment.API_PORT,
    })
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : '未知的 API 啟動錯誤'
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
})
