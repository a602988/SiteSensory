import { timingSafeEqual } from 'node:crypto'

import type { Session } from '@fastify/secure-session'
import type {
    FastifyInstance,
    FastifyReply,
    FastifyRequest,
} from 'fastify'

import {
    analysisResultSchema,
    apiErrorSchema,
    capturedPageInputSchema,
    ingestionInputSchema,
    ingestionJobSchema,
    manualPageUploadQuerySchema,
    pageDetailSchema,
    pageIdParamsSchema,
    pageListSchema,
    pageSearchQuerySchema,
    resourceIdParamsSchema,
    savedViewInputSchema,
    savedViewListQuerySchema,
    savedViewListSchema,
    savedViewSchema,
    savedViewUpdateSchema,
    similarPageListSchema,
    similarSearchInputSchema,
    userTagInputSchema,
    userTagListSchema,
    userTagSchema,
} from '@sitesensory/contracts'
import {
    createSavedViewPreview,
    createThumbnail,
    inspectImage,
    type ObjectStorage,
} from '@sitesensory/image'
import {
    normalizeUrl,
    UrlSafetyError,
} from '@sitesensory/ingestion'

import {
    IngestionConflictError,
    type IngestionStore,
} from './ingestion-store.js'
import type { PageStore } from './page-store.js'
import type { PrivateStore } from './private-store.js'
import { toJsonSchema } from './schema.js'

export type LocalSessionData = {
    user: {
        displayName: string
        id: string
    }
}

export type RouteOptions = {
    ingestionStore: IngestionStore
    internalApiKey: string
    pageStore: PageStore
    privateStore: PrivateStore
    storage: ObjectStorage
    urlValidator: (url: string) => Promise<void>
}

/**
 * 註冊第一版公開、私人與內部 API 邊界。
 *
 * @param app Fastify 應用程式。
 * @param options 私人資料存取介面與內部 API 金鑰。
 * @returns 所有路由註冊完成時結束。
 */
export async function registerRoutes(
    app: FastifyInstance,
    options: RouteOptions,
): Promise<void>
{
    const previewCache = new Map<string, Promise<Buffer>>()

    app.get('/api/v1/pages', {
        schema: {
            querystring: toJsonSchema(pageSearchQuerySchema),
            response: { 200: toJsonSchema(pageListSchema) },
        },
    }, async request => {
        const query = pageSearchQuerySchema.parse(request.query)

        return options.pageStore.listPages(query)
    })

    app.get('/api/v1/pages/:pageId', {
        schema: {
            params: toJsonSchema(pageIdParamsSchema),
            response: {
                200: toJsonSchema(pageDetailSchema),
                404: toJsonSchema(apiErrorSchema),
            },
        },
    }, async (request, reply) => {
        const params = pageIdParamsSchema.parse(request.params)
        const page = await options.pageStore.getPage(params.pageId)

        if (!page) return notFound(reply, request.id)

        return page
    })

    app.post('/api/v1/similar-searches', {
        schema: {
            body: toJsonSchema(similarSearchInputSchema),
            response: {
                200: toJsonSchema(similarPageListSchema),
                400: toJsonSchema(apiErrorSchema),
            },
        },
    }, async request => {
        const input = similarSearchInputSchema.parse(request.body)

        return { items: await options.pageStore.listSimilar(input) }
    })

    app.get('/api/v1/saved-views', {
        preHandler: requireSession,
        schema: {
            querystring: toJsonSchema(savedViewListQuerySchema),
            response: { 200: toJsonSchema(savedViewListSchema), 401: toJsonSchema(apiErrorSchema) },
        },
    }, async request => {
        const query = savedViewListQuerySchema.parse(request.query)
        const user = getSessionUser(request)

        return options.privateStore.listSavedViews(user.id, query.page)
    })

    app.get('/api/v1/saved-views/:id/preview', {
        preHandler: requireSession,
        schema: {
            params: toJsonSchema(resourceIdParamsSchema),
            response: { 401: toJsonSchema(apiErrorSchema), 404: toJsonSchema(apiErrorSchema) },
        },
    }, async (request, reply) => {
        const params = resourceIdParamsSchema.parse(request.params)
        const user = getSessionUser(request)
        const source = await options.privateStore.getSavedViewPreviewSource(user.id, params.id)

        if (!source) return notFound(reply, request.id)

        const content = await options.storage.get(source.objectKey)
        const preview = await getCachedPreview(
            previewCache,
            `saved:${params.id}`,
            () => createSavedViewPreview(content, source),
        )

        return reply
            .header('cache-control', 'private, max-age=31536000, immutable')
            .header('content-type', 'image/webp')
            .send(preview)
    })

    app.post('/api/v1/saved-views', {
        preHandler: requireSession,
        schema: {
            body: toJsonSchema(savedViewInputSchema),
            response: {
                201: toJsonSchema(savedViewSchema),
                400: toJsonSchema(apiErrorSchema),
                401: toJsonSchema(apiErrorSchema),
                403: toJsonSchema(apiErrorSchema),
            },
        },
    }, async (request, reply) => {
        const input = savedViewInputSchema.parse(request.body)
        const user = getSessionUser(request)
        const savedView = await options.privateStore.createSavedView(user.id, input)

        if (!savedView) return forbidden(reply, request.id)

        return reply.status(201).send(savedView)
    })

    app.patch('/api/v1/saved-views/:id', {
        preHandler: requireSession,
        schema: {
            body: toJsonSchema(savedViewUpdateSchema),
            params: toJsonSchema(resourceIdParamsSchema),
            response: {
                200: toJsonSchema(savedViewSchema),
                400: toJsonSchema(apiErrorSchema),
                401: toJsonSchema(apiErrorSchema),
                404: toJsonSchema(apiErrorSchema),
            },
        },
    }, async (request, reply) => {
        const input = savedViewUpdateSchema.parse(request.body)
        const params = resourceIdParamsSchema.parse(request.params)
        const user = getSessionUser(request)
        const savedView = await options.privateStore.updateSavedView(user.id, params.id, input)

        if (!savedView) return notFound(reply, request.id)

        return savedView
    })

    app.delete('/api/v1/saved-views/:id', {
        preHandler: requireSession,
        schema: {
            params: toJsonSchema(resourceIdParamsSchema),
        },
    }, async (request, reply) => {
        const params = resourceIdParamsSchema.parse(request.params)
        const user = getSessionUser(request)
        const deleted = await options.privateStore.deleteSavedView(user.id, params.id)

        if (!deleted) return notFound(reply, request.id)

        return reply.status(204).send()
    })

    app.get('/api/v1/tags', {
        preHandler: requireSession,
        schema: {
            response: { 200: toJsonSchema(userTagListSchema), 401: toJsonSchema(apiErrorSchema) },
        },
    }, async request => {
        const user = getSessionUser(request)

        return { items: await options.privateStore.listTags(user.id) }
    })

    app.post('/api/v1/tags', {
        preHandler: requireSession,
        schema: {
            body: toJsonSchema(userTagInputSchema),
            response: {
                201: toJsonSchema(userTagSchema),
                400: toJsonSchema(apiErrorSchema),
                401: toJsonSchema(apiErrorSchema),
            },
        },
    }, async (request, reply) => {
        const input = userTagInputSchema.parse(request.body)
        const user = getSessionUser(request)
        const tag = await options.privateStore.createTag(user.id, input)

        return reply.status(201).send(tag)
    })

    app.patch('/api/v1/tags/:id', {
        preHandler: requireSession,
        schema: {
            body: toJsonSchema(userTagInputSchema),
            params: toJsonSchema(resourceIdParamsSchema),
            response: {
                200: toJsonSchema(userTagSchema),
                400: toJsonSchema(apiErrorSchema),
                401: toJsonSchema(apiErrorSchema),
                404: toJsonSchema(apiErrorSchema),
            },
        },
    }, async (request, reply) => {
        const input = userTagInputSchema.parse(request.body)
        const params = resourceIdParamsSchema.parse(request.params)
        const user = getSessionUser(request)
        const tag = await options.privateStore.updateTag(user.id, params.id, input)

        if (!tag) return notFound(reply, request.id)

        return tag
    })

    app.delete('/api/v1/tags/:id', {
        preHandler: requireSession,
        schema: {
            params: toJsonSchema(resourceIdParamsSchema),
        },
    }, async (request, reply) => {
        const params = resourceIdParamsSchema.parse(request.params)
        const user = getSessionUser(request)
        const deleted = await options.privateStore.deleteTag(user.id, params.id)

        if (!deleted) return notFound(reply, request.id)

        return reply.status(204).send()
    })

    app.post('/api/v1/uploads', {
        preHandler: requireSession,
        schema: {
            querystring: toJsonSchema(manualPageUploadQuerySchema),
            response: {
                201: toJsonSchema(pageDetailSchema),
                400: toJsonSchema(apiErrorSchema),
                401: toJsonSchema(apiErrorSchema),
            },
        },
    }, async (request, reply) => {
        const query = manualPageUploadQuerySchema.parse(request.query)
        const content = request.body

        if (!Buffer.isBuffer(content) || content.length === 0) {
            return reply.status(400).send({
                code: 'INVALID_SCREENSHOT',
                details: null,
                message: '請選擇 PNG 網頁截圖。',
                request_id: request.id,
            })
        }

        const normalizedUrl = normalizeUrl(query.sourceUrl)

        try {
            await options.urlValidator(normalizedUrl)
        }
        catch (error) {
            if (error instanceof UrlSafetyError) {
                return reply.status(400).send({
                    code: error.code,
                    details: null,
                    message: error.message,
                    request_id: request.id,
                })
            }

            throw error
        }

        let size

        try {
            size = await inspectImage(content)
        }
        catch {
            return reply.status(400).send({
                code: 'INVALID_SCREENSHOT',
                details: null,
                message: '只接受有效的 PNG 網頁截圖。',
                request_id: request.id,
            })
        }

        if (size.width !== 1920) {
            return reply.status(400).send({
                code: 'INVALID_SCREENSHOT_WIDTH',
                details: { actualWidth: size.width, expectedWidth: 1920 },
                message: '桌面截圖寬度必須為 1920px。',
                request_id: request.id,
            })
        }

        const user = getSessionUser(request)
        const asset = await options.storage.put(content, 'png')
        const page = await options.pageStore.createCapturedPage({
            contentFingerprint: asset.sha256,
            finalUrl: normalizedUrl,
            fullPageAsset: { ...asset, ...size },
            language: null,
            pageType: 'home',
            sourceName: `manual-upload/${user.id}`,
            sourceUrl: normalizedUrl,
            summary: null,
            title: query.title,
            viewportAsset: { ...asset, ...size },
        })

        return reply.status(201).send(page)
    })

    app.post('/internal/v1/ingestion-jobs', {
        preHandler: request => requireInternalKey(request, options.internalApiKey),
        schema: {
            body: toJsonSchema(ingestionInputSchema),
            response: {
                200: toJsonSchema(ingestionJobSchema),
                400: toJsonSchema(apiErrorSchema),
                401: toJsonSchema(apiErrorSchema),
                409: toJsonSchema(apiErrorSchema),
            },
        },
    }, async (request, reply) => {
        const input = ingestionInputSchema.parse(request.body)
        const normalizedUrl = normalizeUrl(input.url)

        try {
            await options.urlValidator(normalizedUrl)
            const job = await options.ingestionStore.createOrReuse(
                input.url,
                normalizedUrl,
                input.idempotencyKey,
            )

            return reply.status(200).send(job)
        }
        catch (error) {
            if (error instanceof UrlSafetyError) {
                return reply.status(400).send({
                    code: error.code,
                    details: null,
                    message: error.message,
                    request_id: request.id,
                })
            }

            if (error instanceof IngestionConflictError) {
                return reply.status(409).send({
                    code: 'IDEMPOTENCY_CONFLICT',
                    details: null,
                    message: error.message,
                    request_id: request.id,
                })
            }

            throw error
        }
    })

    app.get('/internal/v1/ingestion-jobs/:id', {
        preHandler: request => requireInternalKey(request, options.internalApiKey),
        schema: {
            params: toJsonSchema(resourceIdParamsSchema),
            response: {
                200: toJsonSchema(ingestionJobSchema),
                400: toJsonSchema(apiErrorSchema),
                401: toJsonSchema(apiErrorSchema),
                404: toJsonSchema(apiErrorSchema),
            },
        },
    }, async (request, reply) => {
        const params = resourceIdParamsSchema.parse(request.params)
        const job = await options.ingestionStore.get(params.id)

        if (!job) return notFound(reply, request.id)

        return job
    })

    app.post('/internal/v1/captured-pages', {
        preHandler: request => requireInternalKey(request, options.internalApiKey),
        schema: {
            body: toJsonSchema(capturedPageInputSchema),
            response: {
                201: toJsonSchema(pageDetailSchema),
                400: toJsonSchema(apiErrorSchema),
                401: toJsonSchema(apiErrorSchema),
            },
        },
    }, async (request, reply) => {
        const input = capturedPageInputSchema.parse(request.body)
        const page = await options.pageStore.createCapturedPage(input)

        return reply.status(201).send(page)
    })

    app.post('/internal/v1/pages/:pageId/analysis', {
        preHandler: request => requireInternalKey(request, options.internalApiKey),
        schema: {
            body: toJsonSchema(analysisResultSchema),
            params: toJsonSchema(pageIdParamsSchema),
            response: {
                200: toJsonSchema(pageDetailSchema),
                400: toJsonSchema(apiErrorSchema),
                401: toJsonSchema(apiErrorSchema),
                404: toJsonSchema(apiErrorSchema),
            },
        },
    }, async (request, reply) => {
        const params = pageIdParamsSchema.parse(request.params)
        const analysis = analysisResultSchema.parse(request.body)
        const page = await options.pageStore.applyAnalysis(params.pageId, analysis)

        if (!page) return notFound(reply, request.id)

        return page
    })

    app.get('/assets/*', async (request, reply) => {
        const params = request.params as { '*': string }
        const objectKey = params['*']
        const content = await options.storage.get(objectKey)

        return reply.header('content-type', 'image/png').send(content)
    })

    app.get('/thumbnails/*', async (request, reply) => {
        const params = request.params as { '*': string }
        const objectKey = params['*']
        const content = await options.storage.get(objectKey)
        const thumbnail = await getCachedPreview(
            previewCache,
            `page:${objectKey}`,
            () => createThumbnail(content),
        )

        return reply
            .header('cache-control', 'public, max-age=31536000, immutable')
            .header('content-type', 'image/webp')
            .send(thumbnail)
    })
}

/**
 * 共用程序內的預覽結果，避免同一張原圖在每次列表查詢時重複轉檔。
 *
 * @param cache 以來源識別碼保存的預覽工作。
 * @param key 原圖或收藏視角的穩定識別碼。
 * @param create 尚未快取時執行的圖片轉換。
 * @returns 已存在或新產生的 WebP 圖片。
 */
async function getCachedPreview(
    cache: Map<string, Promise<Buffer>>,
    key: string,
    create: () => Promise<Buffer>,
): Promise<Buffer>
{
    const existing = cache.get(key)

    if (existing) return existing

    const preview = create().catch(error => {
        cache.delete(key)
        throw error
    })

    cache.set(key, preview)

    if (cache.size > 200) {
        const oldest = cache.keys().next().value

        if (oldest) cache.delete(oldest)
    }

    return preview
}

/**
 * 在私人端點執行前確認 session 內存在使用者。
 *
 * @param request Fastify request。
 * @param reply Fastify reply。
 * @returns 未登入時直接送出 401；已登入時不回傳內容。
 */
async function requireSession(
    request: FastifyRequest,
    reply: FastifyReply,
): Promise<FastifyReply | void>
{
    const session = request.session as Session<LocalSessionData>

    if (session.get('user')) return

    return reply.status(401).send({
        code: 'AUTH_REQUIRED',
        details: null,
        message: '請先登入。',
        request_id: request.id,
    })
}

/**
 * 讀取已由 preHandler 驗證的 session 使用者。
 *
 * @param request Fastify request。
 * @returns session 使用者。
 */
function getSessionUser(request: FastifyRequest): LocalSessionData['user']
{
    const session = request.session as Session<LocalSessionData>
    const user = session.get('user')

    if (!user) throw new Error('私人路由缺少已驗證的 session')

    return user
}

/**
 * 以固定時間比較內部 API 金鑰。
 *
 * @param request Fastify request。
 * @param internalApiKey 伺服器端保存的內部 API 金鑰。
 * @returns 金鑰有效時不回傳內容。
 */
async function requireInternalKey(
    request: FastifyRequest,
    internalApiKey: string,
): Promise<void>
{
    const candidate = request.headers['x-sitesensory-key']

    if (typeof candidate === 'string' && secretsMatch(candidate, internalApiKey)) return

    const error = new Error('內部 API 金鑰無效。') as Error & { statusCode: number }
    error.statusCode = 401
    throw error
}

/**
 * 避免秘密比較時間隨第一個不同字元的位置改變。
 *
 * @param candidate 呼叫端提供的值。
 * @param expected 伺服器端保存的值。
 * @returns 兩個值是否完全相同。
 */
function secretsMatch(candidate: string, expected: string): boolean
{
    const candidateBytes = Buffer.from(candidate)
    const expectedBytes = Buffer.from(expected)

    if (candidateBytes.length !== expectedBytes.length) return false

    return timingSafeEqual(candidateBytes, expectedBytes)
}

/**
 * 以不存在回應隱藏私人資料的實際擁有者。
 *
 * @param reply Fastify reply。
 * @param requestId Fastify request ID。
 * @returns 已送出的 Fastify reply。
 */
function notFound(reply: FastifyReply, requestId: string): FastifyReply
{
    return reply.status(404).send({
        code: 'NOT_FOUND',
        details: null,
        message: '找不到指定資料。',
        request_id: requestId,
    })
}

/**
 * 回傳私人標籤不屬於目前使用者的錯誤。
 *
 * @param reply Fastify reply。
 * @param requestId Fastify request ID。
 * @returns 已送出的 Fastify reply。
 */
function forbidden(reply: FastifyReply, requestId: string): FastifyReply
{
    return reply.status(403).send({
        code: 'PRIVATE_TAG_FORBIDDEN',
        details: null,
        message: '收藏包含無法使用的私人標籤。',
        request_id: requestId,
    })
}
