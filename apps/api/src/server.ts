import { z } from 'zod'
import { isAbsolute, resolve } from 'node:path'

import { loadEnvironment } from '@sitesensory/config'
import { createDatabase } from '@sitesensory/database'
import { createLocalObjectStorage } from '@sitesensory/image'
import { assertPublicUrl } from '@sitesensory/ingestion'

import { buildApp } from './app.js'
import { createLocalAuthStore } from './auth-store.js'
import { createIngestionStore } from './ingestion-store.js'
import { createPageStore } from './page-store.js'
import { hashPassword } from './password.js'
import { createPrivateStore } from './private-store.js'

const apiEnvironmentSchema = z.object({
    INTERNAL_API_KEY: z.string().min(32),
    LOCAL_ADMIN_NAME: z.string().trim().min(1).default('SiteSensory 管理者'),
    LOCAL_PASSWORD_HASH: z.string().startsWith('scrypt-v1$').optional(),
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
    const localPasswordHash = apiEnvironment.LOCAL_PASSWORD_HASH
        ?? await createDevelopmentPassword(environment.NODE_ENV)
    const database = createDatabase(environment.DATABASE_URL)
    const storage = createLocalObjectStorage(resolveAssetRoot(environment.ASSET_ROOT))
    const app = await buildApp({
        authStore: createLocalAuthStore(database),
        ingestionStore: createIngestionStore(database),
        internalApiKey: apiEnvironment.INTERNAL_API_KEY,
        localAdminName: apiEnvironment.LOCAL_ADMIN_NAME,
        localPasswordHash,
        logger: true,
        pageStore: createPageStore(database),
        privateStore: createPrivateStore(database),
        sessionKey: Buffer.from(apiEnvironment.SESSION_KEY_HEX, 'hex'),
        storage,
        urlValidator: assertPublicUrl,
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

/**
 * 相對資產路徑以 repository 根目錄為基準，避免 package script 的工作目錄改變讀取位置。
 *
 * @param root 環境設定提供的資產目錄。
 * @returns 可直接交給本機物件儲存使用的絕對路徑。
 */
function resolveAssetRoot(root: string): string
{
    if (isAbsolute(root)) return root

    return resolve(import.meta.dirname, '../../..', root)
}

/**
 * 開發環境使用已確認的本機密碼；正式環境必須改由環境設定提供雜湊。
 *
 * @param environment 目前執行環境。
 * @returns 可交給登入驗證的 scrypt 密碼雜湊。
 */
async function createDevelopmentPassword(environment: 'development' | 'test' | 'production'): Promise<string>
{
    if (environment === 'production') {
        throw new Error('production 必須設定 LOCAL_PASSWORD_HASH')
    }

    return hashPassword('24241872')
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : '未知的 API 啟動錯誤'
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
})
