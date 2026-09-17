import secureSession from '@fastify/secure-session'
import type { Session } from '@fastify/secure-session'
import swagger from '@fastify/swagger'
import Fastify, {
    type FastifyInstance,
} from 'fastify'
import { z } from 'zod'

import type { LocalAuthStore } from './auth-store.js'
import { verifyPassword } from './password.js'

const credentialsSchema = z.object({
    password: z.string().min(1).max(1024),
})

export type AppOptions = {
    authStore: LocalAuthStore
    localAdminName: string
    localPasswordHash: string
    logger?: boolean
    sessionKey: Buffer
}

/**
 * 建立可注入測試相依性的 localhost API。
 *
 * @param options 本機帳號、session 金鑰與 log 設定。
 * @returns 已註冊基礎路由與錯誤契約的 Fastify 應用程式。
 */
export async function buildApp(options: AppOptions): Promise<FastifyInstance>
{
    const app = Fastify({
        logger: options.logger ?? false,
    })

    await app.register(swagger, {
        openapi: {
            info: {
                title: 'SiteSensory localhost API',
                version: '1.0.0',
            },
        },
    })
    await app.register(secureSession, {
        cookie: {
            httpOnly: true,
            path: '/',
            sameSite: 'strict',
            secure: false,
        },
        key: options.sessionKey,
    })

    app.setErrorHandler((error, request, reply) => {
        const appError = (error instanceof Error
            ? error as Error & { statusCode?: number }
            : new Error('未知的 API 錯誤')) as Error & { statusCode?: number }
        const statusCode = appError.statusCode && appError.statusCode >= 400
            ? appError.statusCode
            : 500
        const isServerError = statusCode >= 500

        reply.status(statusCode).send({
            code: isServerError ? 'INTERNAL_ERROR' : 'REQUEST_ERROR',
            details: null,
            message: isServerError ? '伺服器處理失敗，請稍後再試。' : appError.message,
            request_id: request.id,
        })
    })

    app.get('/api/v1/health', async () => ({ status: 'ok' }))

    app.get('/api/v1/session', async (request, reply) => {
        const session = request.session as Session<LocalSessionData>
        const user = session.get('user')

        if (!user) {
            return reply.status(401).send({
                code: 'AUTH_REQUIRED',
                details: null,
                message: '請先登入。',
                request_id: request.id,
            })
        }

        return { user }
    })

    app.post('/api/v1/session', async (request, reply) => {
        const session = request.session as Session<LocalSessionData>
        const credentials = credentialsSchema.safeParse(request.body)

        if (!credentials.success) {
            return reply.status(400).send({
                code: 'INVALID_CREDENTIALS_FORMAT',
                details: credentials.error.flatten(),
                message: '請輸入密碼。',
                request_id: request.id,
            })
        }

        const isValid = await verifyPassword(
            credentials.data.password,
            options.localPasswordHash,
        )

        if (!isValid) {
            return reply.status(401).send({
                code: 'INVALID_CREDENTIALS',
                details: null,
                message: '密碼不正確。',
                request_id: request.id,
            })
        }

        const user = await options.authStore.getOrCreate(options.localAdminName)
        const sessionUser = {
            displayName: user.displayName,
            id: user.id,
        }

        session.set('user', sessionUser)

        return reply.send({ user: sessionUser })
    })

    app.delete('/api/v1/session', async (request, reply) => {
        request.session.delete()

        return reply.status(204).send()
    })

    return app
}

type LocalSessionData = {
    user: {
        displayName: string
        id: string
    }
}
