import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import {
    isAbsolute,
    join,
} from 'node:path'

import { chromium, type Browser } from 'playwright'
import sharp from 'sharp'

import {
    capturePage,
    classifyPageType,
    type CapturedPage,
} from '@sitesensory/capture-worker'
import type { PageTypeKey } from '@sitesensory/contracts'
import { loadEnvironment } from '@sitesensory/config'
import { createLocalObjectStorage } from '@sitesensory/image'
import { normalizeUrl } from '@sitesensory/ingestion'

const DBCUT_URL = 'https://www.dbcut.com/'
const COUNT = 6
const PAGES_PER_SITE = Math.max(1, Number.parseInt(process.env.PAGES_PER_SITE ?? '6', 10))

type DbcutEntry = {
    name: string
    postUrl: string
    websiteId: string
}

type ImportResult = DbcutEntry & {
    capturedUrl: string
    externalUrl: string
    pageType: PageTypeKey
    pageId?: string
    status: 'imported' | 'skipped'
    reason?: string
}

/**
 * 從 DBCut 最新清單擷取網站並透過 localhost API 寫入正式資料。
 *
 * @returns 完成時輸出 JSON 摘要。
 */
async function main(): Promise<void>
{
    const environment = loadEnvironment(process.env)
    const internalApiKey = process.env.INTERNAL_API_KEY

    if (!internalApiKey) throw new Error('缺少 INTERNAL_API_KEY')

    const apiBase = `http://${environment.API_HOST}:${environment.API_PORT}`
    const entries = await fetchDbcutEntries()
    const workspaceRoot = process.env.INIT_CWD ?? process.cwd()
    const assetRoot = isAbsolute(environment.ASSET_ROOT)
        ? environment.ASSET_ROOT
        : join(workspaceRoot, environment.ASSET_ROOT)
    const storage = createLocalObjectStorage(assetRoot)
    const browser = await chromium.launch()
    const results: ImportResult[] = []
    let importedSites = 0

    try {
        for (const entry of entries) {
            if (importedSites >= COUNT) break

            const externalUrl = await resolveExternalUrl(entry)

            if (!externalUrl) {
                results.push({
                    ...entry,
                    capturedUrl: '',
                    externalUrl: '',
                    pageType: 'home',
                    reason: 'dbcut link did not resolve',
                    status: 'skipped',
                })
                continue
            }

            try {
                const home = await captureAndStore({
                    apiBase,
                    browser,
                    entry,
                    internalApiKey,
                    storage,
                    url: externalUrl,
                })
                results.push({
                    ...entry,
                    capturedUrl: home.captured.finalUrl,
                    externalUrl,
                    pageId: home.pageId,
                    pageType: home.pageType,
                    status: 'imported',
                })
                importedSites += 1

                const innerLinks = selectInnerLinks(home.captured.links, PAGES_PER_SITE - 1)

                for (const link of innerLinks) {
                    try {
                        const inner = await captureAndStore({
                            apiBase,
                            browser,
                            entry,
                            internalApiKey,
                            storage,
                            url: link,
                        })
                        results.push({
                            ...entry,
                            capturedUrl: inner.captured.finalUrl,
                            externalUrl,
                            pageId: inner.pageId,
                            pageType: inner.pageType,
                            status: 'imported',
                        })
                    }
                    catch (error) {
                        results.push({
                            ...entry,
                            capturedUrl: link,
                            externalUrl,
                            pageType: 'other',
                            reason: error instanceof Error ? error.message : 'unknown import error',
                            status: 'skipped',
                        })
                    }
                }
            }
            catch (error) {
                results.push({
                    ...entry,
                    capturedUrl: externalUrl,
                    externalUrl,
                    pageType: 'home',
                    reason: error instanceof Error ? error.message : 'unknown import error',
                    status: 'skipped',
                })
            }
        }
    }
    finally {
        await browser.close()
    }

    await writeEvidence(results)
    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`)
}

type CaptureRequest = {
    apiBase: string
    browser: Browser
    entry: DbcutEntry
    internalApiKey: string
    storage: ReturnType<typeof createLocalObjectStorage>
    url: string
}

/**
 * 擷取一個首頁或內頁，完成圖片尺寸讀取後交由內部 API 寫入。
 *
 * @param request 本機 API、瀏覽器、來源網站與目標網址。
 * @returns 已擷取證據、頁面類型與資料庫頁面識別碼。
 */
async function captureAndStore(request: CaptureRequest): Promise<{
    captured: CapturedPage
    pageId: string
    pageType: PageTypeKey
}>
{
    const captured = await capturePage({
        browser: request.browser,
        storage: request.storage,
        timeoutMs: 45_000,
        url: request.url,
    })
    const [viewport, fullPage] = await Promise.all([
        imageSize(request.storage, captured.viewport.objectKey),
        imageSize(request.storage, captured.fullPage.objectKey),
    ])
    const fingerprint = createHash('sha256')
        .update(captured.finalUrl)
        .update(captured.viewport.sha256)
        .update(captured.fullPage.sha256)
        .digest('hex')
    const pageType = classifyPageType(captured.finalUrl, captured.title, captured.textSummary)
    const response = await fetch(`${request.apiBase}/internal/v1/captured-pages`, {
        body: JSON.stringify({
            contentFingerprint: fingerprint,
            finalUrl: captured.finalUrl,
            fullPageAsset: {
                ...captured.fullPage,
                ...fullPage,
            },
            language: captured.language,
            pageType,
            sourceName: request.entry.name,
            sourceUrl: request.entry.postUrl,
            summary: captured.textSummary.slice(0, 1200),
            title: captured.title || request.entry.name,
            viewportAsset: {
                ...captured.viewport,
                ...viewport,
            },
        }),
        headers: {
            'content-type': 'application/json',
            'x-sitesensory-key': request.internalApiKey,
        },
        method: 'POST',
    })

    if (!response.ok) {
        const body = await response.text()
        throw new Error(`API ${response.status}: ${body}`)
    }

    const page = await response.json() as { id: string }

    return { captured, pageId: page.id, pageType }
}

/**
 * 優先挑選常用導覽內頁，避免頁碼、語系副本與內容頁擠掉主要頁型。
 *
 * @param links 首頁探索到的同網域連結。
 * @param limit 單一網站最多再擷取的內頁數。
 * @returns 依導覽用途排序後的網址。
 */
function selectInnerLinks(links: string[], limit: number): string[]
{
    const priority = /about|company|service|product|business|portfolio|project|case|news|blog|contact|career|recruit|faq|紹介|事業|採用|会社|문의|서비스|채용/iu

    return [...links]
        .sort((left, right) => Number(!priority.test(left)) - Number(!priority.test(right)))
        .slice(0, Math.max(0, limit))
}

async function fetchDbcutEntries(): Promise<DbcutEntry[]>
{
    const response = await fetch(DBCUT_URL)

    if (!response.ok) throw new Error(`DBCut list failed: ${response.status}`)

    const html = await response.text()
    const matches = [...html.matchAll(/href="(?<url>https:\/\/www\.dbcut\.com\/websites\/(?<id>\d+))"[^>]*>[\s\S]{0,300}<span class="tit_str">(?<name>[^<]+)<\/span>/g)]
    const entries = matches
        .map(match => ({
            name: decodeHtml(match.groups?.name ?? '').trim(),
            postUrl: match.groups?.url ?? '',
            websiteId: match.groups?.id ?? '',
        }))
        .filter(entry => entry.name && entry.websiteId)

    return [...new Map(entries.map(entry => [entry.websiteId, entry])).values()]
}

async function resolveExternalUrl(entry: DbcutEntry): Promise<string | null>
{
    const url = new URL('/bbs/link.php', DBCUT_URL)
    url.searchParams.set('bo_table', 'websites')
    url.searchParams.set('no', '1')
    url.searchParams.set('wr_id', entry.websiteId)

    try {
        const response = await fetch(url, {
            redirect: 'follow',
        })
        const resolvedUrl = normalizeUrl(response.url)

        if (new URL(resolvedUrl).hostname === new URL(DBCUT_URL).hostname) return null

        return resolvedUrl
    }
    catch {
        return null
    }
}

async function imageSize(
    storage: ReturnType<typeof createLocalObjectStorage>,
    objectKey: string,
): Promise<{ height: number, width: number }>
{
    const metadata = await sharp(await storage.get(objectKey)).metadata()

    if (!metadata.width || !metadata.height) throw new Error(`cannot read image size for ${objectKey}`)

    return {
        height: metadata.height,
        width: metadata.width,
    }
}

async function writeEvidence(results: ImportResult[]): Promise<void>
{
    const workspaceRoot = process.env.INIT_CWD ?? process.cwd()
    const directory = join(workspaceRoot, 'artifacts/verification/p5')
    const target = join(directory, 'dbcut-import.json')

    await mkdir(directory, { recursive: true })
    await writeFile(target, `${JSON.stringify({
        createdAt: new Date().toISOString(),
        results,
        source: DBCUT_URL,
    }, null, 2)}\n`, 'utf8')
}

function decodeHtml(value: string): string
{
    return value
        .replaceAll('&amp;', '&')
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&quot;', '"')
        .replaceAll('&#039;', "'")
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : '未知的 DBCut 匯入錯誤'
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
})
