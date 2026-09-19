import secureSession from '@fastify/secure-session'
import type { Session } from '@fastify/secure-session'
import swagger from '@fastify/swagger'
import Fastify, {
    type FastifyInstance,
} from 'fastify'
import { z } from 'zod'

import { apiErrorSchema } from '@sitesensory/contracts'
import type { ObjectStorage } from '@sitesensory/image'

import type { LocalAuthStore } from './auth-store.js'
import type { IngestionStore } from './ingestion-store.js'
import { verifyPassword } from './password.js'
import type { PageStore } from './page-store.js'
import type { PrivateStore } from './private-store.js'
import {
    type LocalSessionData,
    registerRoutes,
} from './routes.js'
import { toJsonSchema } from './schema.js'

const credentialsSchema = z.object({
    password: z.string().min(1).max(1024),
})
const sessionSchema = z.object({
    user: z.object({
        displayName: z.string(),
        id: z.uuid(),
    }),
})
const healthSchema = z.object({ status: z.literal('ok') })

export type AppOptions = {
    authStore: LocalAuthStore
    ingestionStore: IngestionStore
    internalApiKey: string
    localAdminName: string
    localPasswordHash: string
    logger?: boolean
    pageStore: PageStore
    privateStore: PrivateStore
    sessionKey: Buffer
    storage: ObjectStorage
    urlValidator: (url: string) => Promise<void>
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
        bodyLimit: 50 * 1024 * 1024,
        logger: options.logger ?? false,
    })

    app.addContentTypeParser('image/png', { parseAs: 'buffer' }, (_request, body, done) => {
        done(null, body)
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
        if (error instanceof z.ZodError) {
            return reply.status(400).send({
                code: 'VALIDATION_ERROR',
                details: error.flatten(),
                message: '輸入內容格式不正確。',
                request_id: request.id,
            })
        }

        const appError = (error instanceof Error
            ? error as Error & { statusCode?: number }
            : new Error('未知的 API 錯誤')) as Error & { statusCode?: number }
        const statusCode = appError.statusCode && appError.statusCode >= 400
            ? appError.statusCode
            : 500
        const isServerError = statusCode >= 500

        return reply.status(statusCode).send({
            code: isServerError ? 'INTERNAL_ERROR' : 'REQUEST_ERROR',
            details: null,
            message: isServerError ? '伺服器處理失敗，請稍後再試。' : appError.message,
            request_id: request.id,
        })
    })

    app.get('/api/v1/health', {
        schema: {
            response: { 200: toJsonSchema(healthSchema) },
        },
    }, async () => ({ status: 'ok' }))

    app.get('/api/v1/session', {
        schema: {
            response: {
                200: toJsonSchema(sessionSchema),
                401: toJsonSchema(apiErrorSchema),
            },
        },
    }, async (request, reply) => {
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

    app.post('/api/v1/session', {
        schema: {
            body: toJsonSchema(credentialsSchema),
            response: {
                200: toJsonSchema(sessionSchema),
                400: toJsonSchema(apiErrorSchema),
                401: toJsonSchema(apiErrorSchema),
            },
        },
    }, async (request, reply) => {
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

    await registerRoutes(app, {
        ingestionStore: options.ingestionStore,
        internalApiKey: options.internalApiKey,
        pageStore: options.pageStore,
        privateStore: options.privateStore,
        storage: options.storage,
        urlValidator: options.urlValidator,
    })

    return app
}
