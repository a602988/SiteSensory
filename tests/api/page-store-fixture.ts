import type {
    AnalysisResult,
    CapturedPageInput,
    PageDetail,
    PageSummary,
} from '../../packages/contracts/src/index.js'

import type { PageStore } from '../../apps/api/src/page-store.js'

const PAGE_ID = '00000000-0000-4000-8000-000000000101'
const PAGE_VERSION_ID = '00000000-0000-4000-8000-000000000102'

/**
 * 建立 API 路由測試使用的記憶體頁面資料存取介面。
 *
 * @returns 可注入 buildApp 的 page store。
 */
export function createMemoryPageStore(): PageStore
{
    const pages = new Map<string, PageDetail>()

    return {
        async applyAnalysis(pageId: string, analysis: AnalysisResult): Promise<PageDetail | null>
        {
            const page = pages.get(pageId)

            if (!page) return null

            const tags = analysis.tags
                .filter(tag => tag.key === 'minimal')
                .map(tag => ({ group: tag.group, key: tag.key, name: '極簡' }))
            const updated = {
                ...page,
                language: analysis.languages.find(language => language.role === 'primary')?.code ?? null,
                pageType: analysis.pageType.key,
                summary: analysis.analysisSummary,
                tags,
            }

            pages.set(pageId, updated)

            return updated
        },
        async createCapturedPage(input: CapturedPageInput): Promise<PageSummary>
        {
            const now = new Date().toISOString()
            const detail: PageDetail = {
                createdAt: now,
                domain: new URL(input.finalUrl).hostname,
                fullPageAssetUrl: `/assets/${input.fullPageAsset.objectKey}`,
                height: input.fullPageAsset.height,
                id: PAGE_ID,
                language: input.language,
                pageType: 'home',
                pageVersionId: PAGE_VERSION_ID,
                publishedAt: now,
                sourceUrl: input.finalUrl,
                summary: input.summary,
                tags: [{ group: 'style', key: 'minimal', name: '極簡' }],
                thumbnailAssetUrl: `/thumbnails/${input.fullPageAsset.objectKey}`,
                title: input.title,
                viewportAssetUrl: `/assets/${input.viewportAsset.objectKey}`,
                width: input.fullPageAsset.width,
            }

            pages.set(detail.id, detail)

            return detail
        },
        async getPage(pageId)
        {
            return pages.get(pageId) ?? null
        },
        async listPages(search)
        {
            const items = [...pages.values()]
                .filter(page => !search.tag || page.tags.some(tag => tag.key === search.tag))

            return {
                hasMore: false,
                items,
                page: search.page,
                pageSize: 18,
                total: items.length,
            }
        },
        async listSimilar(input)
        {
            return [...pages.values()]
                .filter(page => page.pageVersionId !== input.pageVersionId)
                .map(page => ({
                    ...page,
                    reasons: ['同為首頁'],
                    score: 0.55,
                }))
        },
    }
}
