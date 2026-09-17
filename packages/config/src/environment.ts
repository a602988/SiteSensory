import { z } from 'zod'

const localHostSchema = z.union([
    z.literal('127.0.0.1'),
    z.literal('localhost'),
    z.literal('::1'),
])

const environmentSchema = z.object({
    API_HOST: localHostSchema.default('127.0.0.1'),
    API_PORT: z.coerce.number().int().min(1024).max(65535).default(4100),
    ASSET_ROOT: z.string().trim().min(1).default('./var/assets'),
    DATABASE_URL: z.string().trim().startsWith('postgresql://'),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    WEB_HOST: localHostSchema.default('127.0.0.1'),
    WEB_PORT: z.coerce.number().int().min(1024).max(65535).default(3000),
})

export type AppEnvironment = z.infer<typeof environmentSchema>

/**
 * 驗證應用程式需要的環境設定，避免服務意外監聽區域網路介面。
 *
 * @param source 原始環境變數。
 * @returns 已驗證並套用預設值的設定。
 */
export function loadEnvironment(source: NodeJS.ProcessEnv): AppEnvironment
{
    return environmentSchema.parse(source)
}
