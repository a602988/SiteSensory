import {
    afterAll,
    beforeAll,
    describe,
    expect,
    it,
} from 'vitest'
import sharp from 'sharp'

import {
    buildApp,
    type AppOptions,
} from '../../apps/api/src/app.js'
import { hashPassword } from '../../apps/api/src/password.js'
import { createMemoryPrivateStore } from './private-store-fixture.js'
import { createMemoryIngestionStore } from './ingestion-store-fixture.js'
import { createMemoryPageStore } from './page-store-fixture.js'

const PASSWORD = 'a-secure-local-password'
const PAGE_VERSION_ID = '00000000-0000-4000-8000-000000000003'
const USER_A_ID = '00000000-0000-4000-8000-000000000001'
const USER_B_ID = '00000000-0000-4000-8000-000000000002'

let appA: Awaited<ReturnType<typeof buildApp>>
let appB: Awaited<ReturnType<typeof buildApp>>
let cookieA: { name: string, value: string }
let cookieB: { name: string, value: string }

describe('API route boundaries', () => {
    beforeAll(async () => {
        const passwordHash = await hashPassword(PASSWORD)
        const privateStore = createMemoryPrivateStore()

        appA = await buildApp(createOptions(USER_A_ID, passwordHash, privateStore))
        appB = await buildApp(createOptions(USER_B_ID, passwordHash, privateStore))
        cookieA = await login(appA)
        cookieB = await login(appB)
    })

    afterAll(async () => {
        await Promise.all([appA.close(), appB.close()])
    })

    it('publishes the endpoint skeleton through OpenAPI', async () => {
        await appA.ready()
        const document = appA.swagger()
        const paths = Object.keys(document.paths ?? {})

        expect(paths).toContain('/api/v1/pages')
        expect(paths).toContain('/api/v1/saved-views')
        expect(paths).toContain('/api/v1/tags')
        expect(paths).toContain('/api/v1/uploads')
        expect(paths).toContain('/internal/v1/ingestion-jobs')
        expect(paths).toContain('/internal/v1/pages/{pageId}/analysis')
        expect(paths).not.toContain('/api/v1/ingestion-jobs')
    })

    it('rejects private routes without a session', async () => {
        const response = await appA.inject({
            method: 'GET',
            url: '/api/v1/saved-views',
        })

        expect(response.statusCode).toBe(401)
        expect(response.json().code).toBe('AUTH_REQUIRED')
    })

    it('keeps tags and saved views isolated by session user', async () => {
        const tagResponse = await appA.inject({
            cookies: { [cookieA.name]: cookieA.value },
            method: 'POST',
            payload: { name: '留白版面' },
            url: '/api/v1/tags',
        })
        const tagId = tagResponse.json().id as string
        const savedResponse = await appA.inject({
            cookies: { [cookieA.name]: cookieA.value },
            method: 'POST',
            payload: {
                height: 0.4,
                pageVersionId: PAGE_VERSION_ID,
                reason: '內容層級清楚',
                tagIds: [tagId],
                width: 0.5,
                x: 0.1,
                y: 0.2,
            },
            url: '/api/v1/saved-views',
        })

        expect(tagResponse.statusCode).toBe(201)
        expect(savedResponse.statusCode).toBe(201)

        const otherTags = await appB.inject({
            cookies: { [cookieB.name]: cookieB.value },
            method: 'GET',
            url: '/api/v1/tags',
        })
        const otherSavedViews = await appB.inject({
            cookies: { [cookieB.name]: cookieB.value },
            method: 'GET',
            url: '/api/v1/saved-views',
        })
        const crossUserUpdate = await appB.inject({
            cookies: { [cookieB.name]: cookieB.value },
            method: 'PATCH',
            payload: { reason: '不應成功' },
            url: `/api/v1/saved-views/${savedResponse.json().id as string}`,
        })

        expect(otherTags.json().items).toEqual([])
        expect(otherSavedViews.json().items).toEqual([])
        expect(crossUserUpdate.statusCode).toBe(404)
    })

    it('requires the internal key before validating ingestion input', async () => {
        const denied = await appA.inject({
            method: 'POST',
            payload: {
                idempotencyKey: 'example-request',
                url: 'https://example.com',
            },
            url: '/internal/v1/ingestion-jobs',
        })
        const acceptedBoundary = await appA.inject({
            headers: {
                'x-sitesensory-key': 'test-internal-api-key-with-32-characters',
            },
            method: 'POST',
            payload: {
                idempotencyKey: 'example-request',
                url: 'https://example.com',
            },
            url: '/internal/v1/ingestion-jobs',
        })

        expect(denied.statusCode).toBe(401)
        expect(acceptedBoundary.statusCode).toBe(200)
        expect(acceptedBoundary.json().state).toBe('queued')
    })

    it('applies Zod refinements at the API boundary', async () => {
        const invalidRegion = await appA.inject({
            method: 'POST',
            payload: {
                height: 0.4,
                pageVersionId: PAGE_VERSION_ID,
                width: 0.5,
                x: 0.8,
                y: 0.2,
            },
            url: '/api/v1/similar-searches',
        })
        const invalidProtocol = await appA.inject({
            headers: {
                'x-sitesensory-key': 'test-internal-api-key-with-32-characters',
            },
            method: 'POST',
            payload: {
                idempotencyKey: 'example-request',
                url: 'ftp://example.com',
            },
            url: '/internal/v1/ingestion-jobs',
        })

        expect(invalidRegion.statusCode).toBe(400)
        expect(invalidRegion.json().code).toBe('VALIDATION_ERROR')
        expect(invalidProtocol.statusCode).toBe(400)
        expect(invalidProtocol.json().code).toBe('VALIDATION_ERROR')
    })

    it('returns a working similar design response', async () => {
        const response = await appA.inject({
            method: 'POST',
            payload: {
                height: 1,
                pageVersionId: PAGE_VERSION_ID,
                width: 1,
                x: 0,
                y: 0,
            },
            url: '/api/v1/similar-searches',
        })

        expect(response.statusCode).toBe(200)
        expect(response.json()).toEqual({ items: [] })
    })

    it('accepts a session-owned 1920px PNG screenshot upload', async () => {
        const screenshot = await sharp({
            create: {
                background: '#ffffff',
                channels: 3,
                height: 100,
                width: 1920,
            },
        }).png().toBuffer()
        const denied = await appA.inject({
            headers: { 'content-type': 'image/png' },
            method: 'POST',
            payload: screenshot,
            url: '/api/v1/uploads?title=Example&sourceUrl=https%3A%2F%2Fexample.com',
        })
        const accepted = await appA.inject({
            cookies: { [cookieA.name]: cookieA.value },
            headers: { 'content-type': 'image/png' },
            method: 'POST',
            payload: screenshot,
            url: '/api/v1/uploads?title=Example&sourceUrl=https%3A%2F%2Fexample.com',
        })

        expect(denied.statusCode).toBe(401)
        expect(accepted.statusCode).toBe(201)
        expect(accepted.json().title).toBe('Example')
        expect(accepted.json().width).toBe(1920)
        expect(accepted.json().publishedAt).toBeNull()

        const pageId = accepted.json().id as string
        const detail = await appA.inject({ method: 'GET', url: `/api/v1/pages/${pageId}` })
        const listed = await appA.inject({ method: 'GET', url: '/api/v1/pages' })

        expect(detail.statusCode).toBe(404)
        expect(listed.json().items).toHaveLength(0)
    })

    it('protects and validates Codex analysis before updating public classification', async () => {
        const screenshot = await sharp({
            create: {
                background: '#ffffff',
                channels: 3,
                height: 100,
                width: 1920,
            },
        }).png().toBuffer()
        const uploaded = await appA.inject({
            cookies: { [cookieA.name]: cookieA.value },
            headers: { 'content-type': 'image/png' },
            method: 'POST',
            payload: screenshot,
            url: '/api/v1/uploads?title=Analyzed&sourceUrl=https%3A%2F%2Fanalysis.example.com',
        })
        const pageId = uploaded.json().id as string
        const analysis = {
            aestheticScores: {
                color: 4,
                completion: 4,
                consistency: 4,
                hierarchy: 5,
                rationale: '標題與內容層級清楚。',
                typography: 4,
            },
            analysisSummary: '以大量留白和清楚層級呈現企業資訊。',
            languages: [{
                code: 'zh-TW',
                confidence: 0.98,
                evidence: '主要內容使用繁體中文。',
                role: 'primary',
            }],
            motionLevel: 'light',
            pageType: {
                confidence: 0.95,
                evidence: '頁面集中介紹組織與品牌。',
                key: 'about',
            },
            pendingTags: [],
            schemaVersion: '1.0.0',
            secondaryPageTypes: [],
            suggestedRegions: [],
            tags: [{
                confidence: 0.92,
                evidence: '版面使用少量元素與大面積留白。',
                group: 'style',
                key: 'minimal',
            }],
        }
        const denied = await appA.inject({
            method: 'POST',
            payload: analysis,
            url: `/internal/v1/pages/${pageId}/analysis`,
        })
        const accepted = await appA.inject({
            headers: {
                'x-sitesensory-key': 'test-internal-api-key-with-32-characters',
            },
            method: 'POST',
            payload: analysis,
            url: `/internal/v1/pages/${pageId}/analysis`,
        })
        const repeated = await appA.inject({
            headers: {
                'x-sitesensory-key': 'test-internal-api-key-with-32-characters',
            },
            method: 'POST',
            payload: analysis,
            url: `/internal/v1/pages/${pageId}/analysis`,
        })
        const missing = await appA.inject({
            headers: {
                'x-sitesensory-key': 'test-internal-api-key-with-32-characters',
            },
            method: 'POST',
            payload: analysis,
            url: '/internal/v1/pages/00000000-0000-4000-8000-000000000999/analysis',
        })
        const invalid = await appA.inject({
            headers: {
                'x-sitesensory-key': 'test-internal-api-key-with-32-characters',
            },
            method: 'POST',
            payload: { ...analysis, schemaVersion: '2.0.0' },
            url: `/internal/v1/pages/${pageId}/analysis`,
        })

        expect(denied.statusCode).toBe(401)
        expect(accepted.statusCode).toBe(200)
        expect(repeated.statusCode).toBe(200)
        expect(missing.statusCode).toBe(404)
        expect(invalid.statusCode).toBe(400)
        expect(accepted.json()).toMatchObject({
            language: 'zh-TW',
            pageType: 'about',
            summary: analysis.analysisSummary,
            tags: [{ group: 'style', key: 'minimal', name: '極簡' }],
        })

        const detail = await appA.inject({ method: 'GET', url: `/api/v1/pages/${pageId}` })
        const taggedPages = await appA.inject({ method: 'GET', url: '/api/v1/pages?tag=minimal' })

        expect(detail.statusCode).toBe(200)
        expect(detail.json().tags).toEqual([{ group: 'style', key: 'minimal', name: '極簡' }])
        expect(taggedPages.json().items).toHaveLength(1)
    })
})

/**
 * 建立指定使用者的測試應用程式設定。
 *
 * @param userId 測試 session 使用者識別碼。
 * @param localPasswordHash 測試密碼雜湊。
 * @param privateStore 兩名使用者共用的私人資料存取介面。
 * @returns 可交給 buildApp 的設定。
 */
function createOptions(
    userId: string,
    localPasswordHash: string,
    privateStore: AppOptions['privateStore'],
): AppOptions
{
    return {
        authStore: {
            async getOrCreate(displayName)
            {
                return { displayName, id: userId }
            },
        },
        ingestionStore: createMemoryIngestionStore(),
        internalApiKey: 'test-internal-api-key-with-32-characters',
        localAdminName: '本機管理者',
        localPasswordHash,
        pageStore: createMemoryPageStore(),
        privateStore,
        sessionKey: Buffer.alloc(32, 1),
        storage: {
            async get()
            {
                return Buffer.from('')
            },
            async put()
            {
                return {
                    byteSize: 0,
                    objectKey: 'test.png',
                    sha256: '0'.repeat(64),
                }
            },
        },
        urlValidator: async () => undefined,
    }
}

/**
 * 登入測試應用程式並取得 session cookie。
 *
 * @param app Fastify 測試應用程式。
 * @returns session cookie 名稱與內容。
 */
async function login(app: Awaited<ReturnType<typeof buildApp>>): Promise<{
    name: string
    value: string
}>
{
    const response = await app.inject({
        method: 'POST',
        payload: { password: PASSWORD },
        url: '/api/v1/session',
    })
    const cookie = response.cookies[0]

    if (!cookie) throw new Error('登入測試未取得 session cookie')

    return {
        name: cookie.name,
        value: cookie.value,
    }
}
