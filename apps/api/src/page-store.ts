import { createHash } from 'node:crypto'

import type { Kysely, Transaction } from 'kysely'
import { sql } from 'kysely'

import type {
    AnalysisResult,
    CapturedPageInput,
    PageDetail,
    PageList,
    PageSummary,
    SearchTag,
    SimilarPage,
    SimilarSearchInput,
} from '@sitesensory/contracts'
import type { DB } from '@sitesensory/database'
import { normalizeUrl } from '@sitesensory/ingestion'

type PageSearch = {
    domain?: string | undefined
    language?: string | undefined
    page: number
    pageType?: string | undefined
    query?: string | undefined
    tag?: string | undefined
}

export interface PageStore {
    /**
     * 保存經契約驗證的 Codex 分析並更新目前頁面的公共分類。
     *
     * @param pageId 要套用分析的頁面識別碼。
     * @param analysis Codex 產生的結構化分析結果。
     * @returns 更新後的頁面；找不到頁面時回傳 null。
     */
    applyAnalysis(pageId: string, analysis: AnalysisResult): Promise<PageDetail | null>

    /**
     * 將已擷取的公開網站資料寫入正式頁面資料表。
     *
     * @param input 由內部擷取流程送入的頁面證據。
     * @returns 可供前端顯示的頁面摘要。
     */
    createCapturedPage(input: CapturedPageInput): Promise<PageSummary>

    /**
     * 讀取單一已發布頁面。
     *
     * @param pageId 頁面識別碼。
     * @returns 找不到時回傳 null。
     */
    getPage(pageId: string): Promise<PageDetail | null>

    /**
     * 依目前已存在的公共分類與分析摘要找出相近頁面。
     *
     * @param input 作為搜尋基準的頁面版本與正規化選取範圍。
     * @returns 已排除目前頁面的相似設計清單。
     */
    listSimilar(input: SimilarSearchInput): Promise<SimilarPage[]>

    /**
     * 搜尋已發布頁面。
     *
     * @param search 搜尋字、語言與頁面類型條件。
     * @returns 最新版本的頁面摘要。
     */
    listPages(search: PageSearch): Promise<PageList>
}

const PAGE_SIZE = 18

/**
 * 建立公開頁面讀寫資料存取介面。
 *
 * @param database SiteSensory 資料庫連線。
 * @returns 頁面資料存取介面。
 */
export function createPageStore(database: Kysely<DB>): PageStore
{
    return {
        async applyAnalysis(pageId, analysis)
        {
            const applied = await database.transaction().execute(async transaction => {
                const page = await transaction
                    .selectFrom('pages')
                    .select(['current_version_id as pageVersionId', 'id'])
                    .where('id', '=', pageId)
                    .where('current_version_id', 'is not', null)
                    .executeTakeFirst()

                if (!page?.pageVersionId) return false

                const existing = await transaction
                    .selectFrom('analysis_runs')
                    .innerJoin('analysis_results', 'analysis_results.analysis_run_id', 'analysis_runs.id')
                    .select('analysis_runs.id')
                    .where('analysis_runs.page_version_id', '=', page.pageVersionId)
                    .where('analysis_runs.runner', '=', 'codex-cli')
                    .where('analysis_runs.status', '=', 'succeeded')
                    .where(sql<boolean>`analysis_results.result = ${JSON.stringify(analysis)}::jsonb`)
                    .executeTakeFirst()

                if (existing) return true

                const pageTypeId = await getPageTypeId(transaction, analysis.pageType.key)

                await transaction
                    .updateTable('pages')
                    .set({
                        page_type_id: pageTypeId,
                        updated_at: sql<Date>`now()`,
                    })
                    .where('id', '=', page.id)
                    .executeTakeFirstOrThrow()

                const run = await transaction
                    .insertInto('analysis_runs')
                    .values({
                        completed_at: sql<Date>`now()`,
                        model_name: 'codex',
                        model_version: 'desktop-agent',
                        page_version_id: page.pageVersionId,
                        prompt_version: 'sitesensory-analysis-v1',
                        runner: 'codex-cli',
                        schema_version: analysis.schemaVersion,
                        started_at: sql<Date>`now()`,
                        status: 'succeeded',
                    })
                    .returning('id')
                    .executeTakeFirstOrThrow()

                await transaction
                    .insertInto('analysis_results')
                    .values({
                        analysis_run_id: run.id,
                        result: analysis,
                        summary: analysis.analysisSummary,
                    })
                    .execute()

                await replaceAnalysisLanguages(transaction, page.pageVersionId, analysis)
                await replaceAnalysisTags(transaction, page.pageVersionId, run.id, analysis)

                return true
            })

            return applied ? getPageDetail(database, pageId) : null
        },
        async createCapturedPage(input)
        {
            return database.transaction().execute(async transaction => {
                const normalizedUrl = normalizeUrl(input.finalUrl)
                const domain = new URL(normalizedUrl).hostname
                const pageTypeId = await getPageTypeId(transaction, input.pageType ?? 'home')
                const page = await upsertPage(transaction, input, normalizedUrl, domain, pageTypeId)
                const viewportAssetId = await insertAsset(transaction, input.viewportAsset, 'viewport')
                const fullPageAssetId = await insertAsset(transaction, input.fullPageAsset, 'full_page')
                const version = await insertVersion(transaction, input, page.id, viewportAssetId, fullPageAssetId)

                await transaction
                    .updateTable('pages')
                    .set({
                        current_version_id: version.id,
                        last_checked_at: sql<Date>`now()`,
                        status: 'published',
                        updated_at: sql<Date>`now()`,
                    })
                    .where('id', '=', page.id)
                    .executeTakeFirstOrThrow()

                await transaction
                    .insertInto('page_languages')
                    .values({
                        confidence: 0.7,
                        language_code: input.language ?? 'und',
                        page_version_id: version.id,
                        role: 'primary',
                        source: 'system',
                    })
                    .onConflict(conflict => conflict.columns(['page_version_id', 'language_code']).doNothing())
                    .execute()

                const run = await transaction
                    .insertInto('analysis_runs')
                    .values({
                        completed_at: sql<Date>`now()`,
                        model_name: 'manual-dbcut-import',
                        model_version: 'dev',
                        page_version_id: version.id,
                        prompt_version: 'dev-import-v1',
                        runner: 'internal-api',
                        schema_version: 'analysis-v1',
                        started_at: sql<Date>`now()`,
                        status: 'succeeded',
                    })
                    .returning('id')
                    .executeTakeFirstOrThrow()

                await transaction
                    .insertInto('analysis_results')
                    .values({
                        analysis_run_id: run.id,
                        result: {
                            language: input.language,
                            source: input.sourceUrl,
                        },
                        summary: input.summary ?? '',
                    })
                    .execute()

                const row = await selectPage(transaction)
                    .where('pages.id', '=', page.id)
                    .executeTakeFirstOrThrow()

                return toPageSummary(row)
            })
        },
        async getPage(pageId)
        {
            return getPageDetail(database, pageId)
        },
        async listPages(search)
        {
            let query = selectPage(database)
                .orderBy('page_versions.created_at', 'desc')
                .limit(PAGE_SIZE)
                .offset((search.page - 1) * PAGE_SIZE)
            let countQuery = selectPage(database)
                .clearSelect()
                .select(sql<number>`count(*)::integer`.as('total'))

            if (search.language) {
                query = query.where('page_languages.language_code', '=', search.language)
                countQuery = countQuery.where('page_languages.language_code', '=', search.language)
            }

            if (search.domain) {
                query = query.where('sites.registrable_domain', '=', search.domain)
                countQuery = countQuery.where('sites.registrable_domain', '=', search.domain)
            }

            if (search.pageType) {
                query = query.where('page_types.key', '=', search.pageType)
                countQuery = countQuery.where('page_types.key', '=', search.pageType)
            }

            if (search.tag) {
                const tag = search.tag

                query = query.where(({ exists, selectFrom }) => exists(
                    selectFrom('page_taxonomy_terms')
                        .innerJoin('taxonomy_terms', 'taxonomy_terms.id', 'page_taxonomy_terms.term_id')
                        .select('page_taxonomy_terms.id')
                        .whereRef('page_taxonomy_terms.page_version_id', '=', 'page_versions.id')
                        .where('taxonomy_terms.key', '=', tag),
                ))
                countQuery = countQuery.where(({ exists, selectFrom }) => exists(
                    selectFrom('page_taxonomy_terms')
                        .innerJoin('taxonomy_terms', 'taxonomy_terms.id', 'page_taxonomy_terms.term_id')
                        .select('page_taxonomy_terms.id')
                        .whereRef('page_taxonomy_terms.page_version_id', '=', 'page_versions.id')
                        .where('taxonomy_terms.key', '=', tag),
                ))
            }

            if (search.query) {
                const keyword = `%${search.query}%`
                query = query.where(expression => expression.or([
                    expression('page_versions.title', 'ilike', keyword),
                    expression('sites.name', 'ilike', keyword),
                    expression('analysis_results.summary', 'ilike', keyword),
                    expression('pages.canonical_url', 'ilike', keyword),
                ]))
                countQuery = countQuery.where(expression => expression.or([
                    expression('page_versions.title', 'ilike', keyword),
                    expression('sites.name', 'ilike', keyword),
                    expression('analysis_results.summary', 'ilike', keyword),
                    expression('pages.canonical_url', 'ilike', keyword),
                ]))
            }

            const [rows, count] = await Promise.all([
                query.execute(),
                countQuery.executeTakeFirstOrThrow(),
            ])
            const total = count.total

            return {
                hasMore: search.page * PAGE_SIZE < total,
                items: rows.map(toPageSummary),
                page: search.page,
                pageSize: PAGE_SIZE,
                total,
            }
        },
        async listSimilar(input)
        {
            const rows = await selectPage(database)
                .orderBy('page_versions.created_at', 'desc')
                .limit(80)
                .execute()
            const source = rows.find(row => row.pageVersionId === input.pageVersionId)

            if (!source) return []

            return rows
                .filter(row => row.pageVersionId !== input.pageVersionId)
                .map(row => toSimilarPage(source, row, input))
                .sort((left, right) => right.score - left.score)
                .slice(0, 18)
        },
    }
}

/**
 * 從目前已發布版本組合頁面詳情與可搜尋標籤。
 *
 * @param database SiteSensory 資料庫連線。
 * @param pageId 頁面識別碼。
 * @returns 頁面不存在時回傳 null。
 */
async function getPageDetail(database: Kysely<DB>, pageId: string): Promise<PageDetail | null>
{
    const row = await selectPage(database)
        .where('pages.id', '=', pageId)
        .executeTakeFirst()

    if (!row) return null

    const tags = await listPageTags(database, row.pageVersionId)

    return toPageDetail(row, tags)
}

/**
 * 讓最新 Codex 分析成為頁面版本的語言依據，避免舊系統判斷留下多個主要語言。
 *
 * @param transaction 套用分析的資料庫交易。
 * @param pageVersionId 頁面版本識別碼。
 * @param analysis 經契約驗證的分析結果。
 * @returns 完成時不回傳內容。
 */
async function replaceAnalysisLanguages(
    transaction: Transaction<DB>,
    pageVersionId: string,
    analysis: AnalysisResult,
): Promise<void>
{
    await transaction
        .deleteFrom('page_languages')
        .where('page_version_id', '=', pageVersionId)
        .where('source', 'in', ['ai', 'system'])
        .execute()

    await transaction
        .insertInto('page_languages')
        .values(analysis.languages.map(language => ({
            confidence: language.confidence,
            language_code: language.code,
            page_version_id: pageVersionId,
            role: language.role,
            source: 'ai',
        })))
        .execute()
}

/**
 * 替換舊 AI 標籤；受控分類直接套用，未知分類保留到待審區。
 *
 * @param transaction 套用分析的資料庫交易。
 * @param pageVersionId 頁面版本識別碼。
 * @param analysisRunId 本次分析紀錄識別碼。
 * @param analysis 經契約驗證的分析結果。
 * @returns 完成時不回傳內容。
 */
async function replaceAnalysisTags(
    transaction: Transaction<DB>,
    pageVersionId: string,
    analysisRunId: string,
    analysis: AnalysisResult,
): Promise<void>
{
    await transaction
        .deleteFrom('page_taxonomy_terms')
        .where('page_version_id', '=', pageVersionId)
        .where('source', '=', 'ai')
        .execute()

    for (const tag of analysis.tags) {
        const term = await transaction
            .selectFrom('taxonomy_terms')
            .select('id')
            .where('group_key', '=', tag.group)
            .where('key', '=', tag.key)
            .where('status', '=', 'active')
            .executeTakeFirst()

        if (term) {
            await transaction
                .insertInto('page_taxonomy_terms')
                .values({
                    confidence: tag.confidence,
                    page_version_id: pageVersionId,
                    source: 'ai',
                    term_id: term.id,
                })
                .onConflict(conflict => conflict.columns(['page_version_id', 'term_id']).doUpdateSet({
                    confidence: tag.confidence,
                    source: 'ai',
                    updated_at: sql<Date>`now()`,
                }))
                .execute()
        }
        else {
            await insertPendingTag(transaction, analysisRunId, tag.group, tag.key)
        }
    }

    for (const tag of analysis.pendingTags) {
        await insertPendingTag(transaction, analysisRunId, tag.group, tag.suggestedName)
    }
}

/**
 * 保存尚未列入公共分類的候選詞，不直接污染搜尋標籤。
 *
 * @param transaction 套用分析的資料庫交易。
 * @param analysisRunId 本次分析紀錄識別碼。
 * @param group 候選詞分類群組。
 * @param suggestedName 候選詞顯示名稱。
 * @returns 完成時不回傳內容。
 */
async function insertPendingTag(
    transaction: Transaction<DB>,
    analysisRunId: string,
    group: AnalysisResult['pendingTags'][number]['group'],
    suggestedName: string,
): Promise<void>
{
    await transaction
        .insertInto('pending_taxonomy_terms')
        .values({
            analysis_run_id: analysisRunId,
            group_key: group,
            suggested_name: suggestedName,
        })
        .execute()
}

function selectPage(database: Kysely<DB> | Transaction<DB>)
{
    const latestAnalysis = database
        .selectFrom('analysis_runs')
        .select(['analysis_runs.id', 'analysis_runs.page_version_id'])
        .where('analysis_runs.status', '=', 'succeeded')
        .distinctOn('analysis_runs.page_version_id')
        .orderBy('analysis_runs.page_version_id')
        .orderBy('analysis_runs.created_at', 'desc')
        .as('latest_analysis')

    return database
        .selectFrom('pages')
        .innerJoin('sites', 'sites.id', 'pages.site_id')
        .innerJoin('page_versions', 'page_versions.id', 'pages.current_version_id')
        .innerJoin('assets as viewport_assets', 'viewport_assets.id', 'page_versions.viewport_asset_id')
        .innerJoin('assets as full_page_assets', 'full_page_assets.id', 'page_versions.full_page_asset_id')
        .leftJoin('page_types', 'page_types.id', 'pages.page_type_id')
        .leftJoin('page_languages', join => join
            .onRef('page_languages.page_version_id', '=', 'page_versions.id')
            .on('page_languages.role', '=', 'primary'))
        .leftJoin(latestAnalysis, 'latest_analysis.page_version_id', 'page_versions.id')
        .leftJoin('analysis_results', 'analysis_results.analysis_run_id', 'latest_analysis.id')
        .select([
            'full_page_assets.height as fullPageHeight',
            'full_page_assets.object_key as fullPageObjectKey',
            'full_page_assets.width as fullPageWidth',
            'page_languages.language_code as language',
            'page_types.key as pageType',
            'page_versions.created_at as versionCreatedAt',
            'page_versions.final_url as sourceUrl',
            'page_versions.id as pageVersionId',
            'page_versions.published_at as publishedAt',
            'page_versions.title',
            'pages.created_at as createdAt',
            'pages.id',
            'sites.registrable_domain as domain',
            'analysis_results.summary',
            'viewport_assets.object_key as viewportObjectKey',
        ])
        .where('pages.status', '=', 'published')
        .where('page_versions.status', '=', 'published')
}

async function getPageTypeId(transaction: Transaction<DB>, key: string): Promise<string>
{
    const row = await transaction
        .selectFrom('page_types')
        .select('id')
        .where('key', '=', key)
        .executeTakeFirstOrThrow()

    return row.id
}

async function upsertPage(
    transaction: Transaction<DB>,
    input: CapturedPageInput,
    normalizedUrl: string,
    domain: string,
    pageTypeId: string,
): Promise<{ id: string }>
{
    const normalizedHash = createHash('sha256').update(normalizedUrl).digest('hex')
    const site = await transaction
        .insertInto('sites')
        .values({
            name: input.sourceName,
            registrable_domain: domain,
        })
        .onConflict(conflict => conflict.column('registrable_domain').doUpdateSet({
            name: sql<string>`excluded.name`,
            updated_at: sql<Date>`now()`,
        }))
        .returning('id')
        .executeTakeFirstOrThrow()
    const page = await transaction
        .insertInto('pages')
        .values({
            canonical_url: normalizedUrl,
            normalized_url_hash: normalizedHash,
            page_type_id: pageTypeId,
            site_id: site.id,
            status: 'draft',
        })
        .onConflict(conflict => conflict.column('normalized_url_hash').doUpdateSet({
            canonical_url: sql<string>`excluded.canonical_url`,
            page_type_id: pageTypeId,
            site_id: site.id,
            updated_at: sql<Date>`now()`,
        }))
        .returning('id')
        .executeTakeFirstOrThrow()

    await transaction
        .insertInto('page_urls')
        .values({
            kind: 'canonical',
            normalized_url: normalizedUrl,
            page_id: page.id,
        })
        .onConflict(conflict => conflict.column('normalized_url').doNothing())
        .execute()

    return page
}

async function insertAsset(
    transaction: Transaction<DB>,
    asset: CapturedPageInput['viewportAsset'],
    kind: 'full_page' | 'viewport',
): Promise<string>
{
    const row = await transaction
        .insertInto('assets')
        .values({
            byte_size: asset.byteSize,
            height: asset.height,
            kind,
            mime_type: 'image/png',
            object_key: asset.objectKey,
            sha256: asset.sha256,
            width: asset.width,
        })
        .onConflict(conflict => conflict.column('object_key').doUpdateSet({
            byte_size: asset.byteSize,
            height: asset.height,
            sha256: asset.sha256,
            width: asset.width,
        }))
        .returning('id')
        .executeTakeFirstOrThrow()

    return row.id
}

async function insertVersion(
    transaction: Transaction<DB>,
    input: CapturedPageInput,
    pageId: string,
    viewportAssetId: string,
    fullPageAssetId: string,
): Promise<{ id: string }>
{
    const current = await transaction
        .selectFrom('page_versions')
        .select(({ fn }) => fn.max<number>('version_number').as('versionNumber'))
        .where('page_id', '=', pageId)
        .executeTakeFirst()
    const versionNumber = (current?.versionNumber ?? 0) + 1
    const row = await transaction
        .insertInto('page_versions')
        .values({
            capture_profile_key: 'desktop-1920',
            captured_at: sql<Date>`now()`,
            content_fingerprint: input.contentFingerprint,
            final_url: normalizeUrl(input.finalUrl),
            full_page_asset_id: fullPageAssetId,
            page_id: pageId,
            published_at: sql<Date>`now()`,
            status: 'published',
            title: input.title,
            version_number: versionNumber,
            viewport_asset_id: viewportAssetId,
        })
        .onConflict(conflict => conflict.columns(['page_id', 'content_fingerprint']).doUpdateSet({
            captured_at: sql<Date>`now()`,
            full_page_asset_id: fullPageAssetId,
            published_at: sql<Date>`now()`,
            status: 'published',
            title: input.title,
            updated_at: sql<Date>`now()`,
            viewport_asset_id: viewportAssetId,
        }))
        .returning('id')
        .executeTakeFirstOrThrow()

    return row
}

type PageRow = {
    createdAt: Date
    domain: string
    fullPageHeight: number | null
    fullPageObjectKey: string
    fullPageWidth: number | null
    id: string
    language: string | null
    pageType: string | null
    pageVersionId: string
    publishedAt: Date | null
    sourceUrl: string
    summary: string | null
    title: string | null
    viewportObjectKey: string
}

function toPageSummary(row: PageRow): PageSummary
{
    return {
        createdAt: row.createdAt.toISOString(),
        domain: row.domain,
        fullPageAssetUrl: `/assets/${row.fullPageObjectKey}`,
        id: row.id,
        language: row.language === 'und' ? null : row.language,
        pageType: row.pageType,
        pageVersionId: row.pageVersionId,
        publishedAt: row.publishedAt?.toISOString() ?? null,
        sourceUrl: row.sourceUrl,
        summary: row.summary || null,
        thumbnailAssetUrl: `/thumbnails/${row.fullPageObjectKey}`,
        title: row.title || row.domain,
        viewportAssetUrl: `/assets/${row.viewportObjectKey}`,
    }
}

function toPageDetail(row: PageRow, tags: SearchTag[]): PageDetail
{
    return {
        ...toPageSummary(row),
        height: row.fullPageHeight,
        tags,
        width: row.fullPageWidth,
    }
}

/**
 * 讀取 AI 或人工套用於指定頁面版本的公開搜尋標籤。
 *
 * @param database SiteSensory 資料庫連線或交易。
 * @param pageVersionId 頁面版本識別碼。
 * @returns 依分類與顯示順序排列的搜尋標籤。
 */
async function listPageTags(
    database: Kysely<DB> | Transaction<DB>,
    pageVersionId: string,
): Promise<SearchTag[]>
{
    const rows = await database
        .selectFrom('page_taxonomy_terms')
        .innerJoin('taxonomy_terms', 'taxonomy_terms.id', 'page_taxonomy_terms.term_id')
        .select([
            'taxonomy_terms.group_key as group',
            'taxonomy_terms.key',
            'taxonomy_terms.name',
        ])
        .where('page_taxonomy_terms.page_version_id', '=', pageVersionId)
        .where('taxonomy_terms.status', '=', 'active')
        .orderBy('taxonomy_terms.group_key')
        .orderBy('taxonomy_terms.display_order')
        .execute()

    return rows as SearchTag[]
}

/**
 * 第一版先以可追溯的公共分類與文字分析排序；圖片向量完成後可替換評分來源而不改 API。
 *
 * @param source 作為搜尋基準的頁面。
 * @param candidate 等待評分的候選頁面。
 * @returns 含分數與可讀原因的候選頁面。
 */
function toSimilarPage(
    source: PageRow,
    candidate: PageRow,
    region: SimilarSearchInput,
): SimilarPage
{
    const reasons: string[] = []
    let score = 0.05

    if (source.pageType && source.pageType === candidate.pageType) {
        score += 0.5
        reasons.push(`同為${pageTypeLabel(source.pageType)}`)
    }

    if (source.language && source.language === candidate.language) {
        score += 0.25
        reasons.push('相同語言')
    }

    if (hasSharedKeyword(source, candidate)) {
        score += 0.2
        reasons.push('分析摘要有共同特徵')
    }

    const regionSimilarity = compareRegionAspect(source, candidate, region)

    if (regionSimilarity >= 0.65) {
        score += regionSimilarity * 0.15
        reasons.push('版面比例接近選取區域')
    }

    return {
        ...toPageSummary(candidate),
        reasons: reasons.length > 0 ? reasons : ['其他已收錄設計'],
        score: Math.min(score, 1),
    }
}

/**
 * 在尚未有區域向量時，以選取區域和候選頁面的版面比例補充排序訊號。
 *
 * @param source 選取區域所在頁面。
 * @param candidate 等待比較的頁面。
 * @param region 正規化選取範圍。
 * @returns 0 到 1 的比例相似度。
 */
function compareRegionAspect(
    source: PageRow,
    candidate: PageRow,
    region: SimilarSearchInput,
): number
{
    if (!source.fullPageWidth || !source.fullPageHeight || !candidate.fullPageWidth || !candidate.fullPageHeight) return 0

    const regionAspect = (source.fullPageWidth * region.width) / (source.fullPageHeight * region.height)
    const candidateAspect = candidate.fullPageWidth / candidate.fullPageHeight
    const difference = Math.abs(Math.log(regionAspect / candidateAspect))

    return Math.max(0, 1 - difference / 2)
}

/**
 * @param source 作為搜尋基準的頁面。
 * @param candidate 等待比較的候選頁面。
 * @returns 兩筆頁面文字是否有可辨識的共同詞。
 */
function hasSharedKeyword(source: PageRow, candidate: PageRow): boolean
{
    const sourceWords = new Set(tokenize(`${source.title ?? ''} ${source.summary ?? ''}`))

    return tokenize(`${candidate.title ?? ''} ${candidate.summary ?? ''}`)
        .some(word => sourceWords.has(word))
}

/**
 * @param value 等待拆詞的標題或摘要。
 * @returns 過濾常見短字後的比較詞。
 */
function tokenize(value: string): string[]
{
    return value
        .toLocaleLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter(word => word.length >= 3)
}

/**
 * @param pageType 公共頁面類型 key。
 * @returns 適合顯示在相似原因中的名稱。
 */
function pageTypeLabel(pageType: string): string
{
    const labels: Record<string, string> = {
        about: '關於我們頁',
        home: '首頁',
        news_detail: '最新消息內頁',
        news_list: '最新消息列表',
    }

    return labels[pageType] ?? '頁面類型'
}
