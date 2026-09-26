import type { Browser } from 'playwright'
import sharp, { type OverlayOptions } from 'sharp'

import { DESKTOP_CAPTURE_PROFILE } from '@sitesensory/config'
import type { PageTypeKey } from '@sitesensory/contracts'
import type { ObjectStorage, StoredObject } from '@sitesensory/image'
import {
    assertPublicUrl,
    normalizeUrl,
} from '@sitesensory/ingestion'

const EXCLUDED_PATH_PARTS = ['/cart', '/checkout', '/login', '/logout', '/search', '/signin']
const CAPTURE_STEP_RATIO = 0.8
const CAPTURE_SETTLE_MS = 800
const CONTENT_SETTLE_MS = 250
const IMAGE_SETTLE_TIMEOUT_MS = 5_000
const NETWORK_SETTLE_TIMEOUT_MS = 5_000
const MAX_CAPTURE_HEIGHT = 86_400
const MAX_SCROLL_STEPS = 160
const SCROLL_DELAY_MS = 100
const SCROLL_STEP_RATIO = 0.8
const STABLE_BOTTOM_CHECKS = 3
const FIXED_ELEMENT_ATTRIBUTE = 'data-sitesensory-fixed-element'
const HIDE_FIXED_ATTRIBUTE = 'data-sitesensory-hide-fixed'
const OVERLAY_ATTRIBUTE = 'data-sitesensory-hide-overlay'
const FIXED_CANVAS_COVERAGE_RATIO = 0.8
const STICKY_CHROME_MAX_HEIGHT_RATIO = 0.35
const STICKY_CHROME_MIN_WIDTH_RATIO = 0.5
const STICKY_CHROME_TOP_MAX_PX = 80
const STICKY_SIDE_MAX_WIDTH_RATIO = 0.4
const STICKY_SIDE_MIN_HEIGHT_RATIO = 0.2
const STICKY_PIN_LABEL_MAX_WIDTH_RATIO = 0.45
const STICKY_PIN_LABEL_MAX_HEIGHT_RATIO = 0.55
const STICKY_PIN_LABEL_SIDE_RATIO = 0.22
const STICKY_CHROME_SIDE_MAX_PX = 80
const SCENE_TRIM_MAX_RATIO = 0.8
const SCENE_TRIM_CONTINUE_RATIO = 0.75
const SCENE_TRIM_SCRAP_RATIO = 0.35
const SCENE_TRIM_MIN_VARIANCE = 0.02
const SCENE_TRIM_THRESHOLD = 0.015
const PHOTO_CARD_RATIOS = [1, 0.8, 0.7, 0.6, 0.55, 0.4]
const PHOTO_BELT_RATIOS = [0.22, 0.19, 0.16, 0.13, 0.1, 0.06, 0.04, 0.02, 0.015, 0.012]
const PHOTO_BELT_THICK_RATIO = 0.1
const PHOTO_BELT_THRESHOLD = 0.012
const PHOTO_BELT_THIN_THRESHOLD = 0.028
const PHOTO_RESIDUAL_SPIKE_FLOOR = 0.028
const PHOTO_BELT_THIN_PX = 36
const PHOTO_CARD_WIPE_THRESHOLD = 0.04
const VIEWPORT_TILE_THRESHOLD = 0.055
const PINNED_MASKED_SAME_THRESHOLD = 0.022
const WIPE_NEIGHBOR_MIN_LUMA = 20
const WIPE_NEIGHBOR_MIN_CHROMA = 22
const PHOTO_BELT_ABOVE_DELTA = 0.08
const PHOTO_BELT_ALIGN_ROWS = 8
const PHOTO_CARD_ALIGN_ROWS = 12
const PHOTO_BELT_PAGE_LUMA = 230
const PHOTO_BELT_REFERENCE_HEIGHT = 1080
const PHOTO_BELT_SIGNATURE_WIDTH = 384
const PHOTO_BELT_FINE_PX = 2
const PHOTO_BELT_MIN_CUT = 12
const PHOTO_WIPE_LUMA = 200
const NUDGE_RATIOS = [0.12, 0.22, 0.34]
const NUDGE_PEEK_MS = 350
const VIEWPORT_LOCKED_WIPE_SAMPLES = 8
const PINNED_SCENE_THRESHOLD = 0.04
const PINNED_SCENE_ROWS_RATIO = 0.35
const WIPE_BAR_MIN_COUNT = 3
const WIPE_BAR_NEIGHBOR_DELTA = 40
const WIPE_BAR_MIN_LUMINANCE = 200
const WIPE_BAR_CONTENT_MIN_LUMINANCE = 45
const WIPE_BAR_CONTENT_MAX_LUMINANCE = 175
const BLENDED_WIPE_MIN_LUMINANCE = 168
const BLENDED_WIPE_NEIGHBOR_DELTA = 24
const WIPE_BAND_RATIO = 0.18
const WIPE_BAND_MIN_ROWS = 6
const VIEWPORT_WIPE_HOLD_SAMPLES = 12
const VIEWPORT_REVEAL_HOLD_SAMPLES = 10
const SCROLL_POSITION_ATTEMPTS = 3
const OVERLAY_SETTLE_MS = 250
const SIGNATURE_HEIGHT = 18
const SIGNATURE_WIDTH = 32
const VIRTUAL_CANVAS_DUPLICATE_THRESHOLD = 0.015
const VIEWPORT_SETTLE_TIMEOUT_MS = 20_000
const VIEWPORT_SETTLE_POLL_MS = 200
const VIEWPORT_SETTLE_STABLE_SAMPLES = 5
const VIEWPORT_SETTLE_THRESHOLD = 0.004
const VIEWPORT_SETTLE_STRIP_THRESHOLD = 0.025
const SETTLE_SIGNATURE_HEIGHT = 108
const SETTLE_SIGNATURE_WIDTH = 192
const SCREENSHOT_TIMEOUT_MS = 120_000
const DOCUMENT_HEIGHT_TOLERANCE_PX = 8
const DOCUMENT_ROW_IDENTITY = 0.003
const CURSOR_FOLLOWER_ATTRIBUTE = 'data-sitesensory-hide-cursor'
const SETTLED_REVEAL_ATTRIBUTE = 'data-sitesensory-settled'
const SUPPRESSED_SWAP_ATTRIBUTE = 'data-sitesensory-suppress-swap'
const VIRTUAL_CANVAS_SCENE_RATIO = 0.45
const SCROLL_SHELL_HEIGHT_RATIO = 1.35
const OVERLAP_SEAM_THRESHOLD = 0.012
const OVERLAP_SEAM_MIN_VARIANCE = 0.05
export type CaptureOptions = {
    allowLocalNetwork?: boolean
    browser: Browser
    storage: ObjectStorage
    timeoutMs?: number
    url: string
}

export type CapturedPage = {
    finalUrl: string
    fullPage: StoredObject
    language: string | null
    links: string[]
    textSummary: string
    title: string
    viewport: StoredObject
}

/**
 * 以固定的 1920 桌面設定擷取首屏、完整頁面與分析摘要。
 *
 * @param options 瀏覽器、檔案儲存與目標網址。
 * @returns 已保存的圖片與頁面證據。
 */
export async function capturePage(options: CaptureOptions): Promise<CapturedPage>
{
    const context = await options.browser.newContext({
        deviceScaleFactor: DESKTOP_CAPTURE_PROFILE.deviceScaleFactor,
        locale: 'en-US',
        timezoneId: 'UTC',
        viewport: {
            height: DESKTOP_CAPTURE_PROFILE.height,
            width: DESKTOP_CAPTURE_PROFILE.width,
        },
    })

    try {
        const page = await context.newPage()

        // tsx／esbuild 的 keepNames 會在送進瀏覽器的函式裡呼叫 __name。
        // 頁面裡沒有這個 helper 時，逐段擷取會在 evaluate 直接失敗。
        await page.addInitScript(() => {
            const host = globalThis as typeof globalThis & {
                __name?: (target: object, value: string) => object
            }

            if (typeof host.__name === 'function') return

            host.__name = (target, value) => Object.defineProperty(target, 'name', {
                configurable: true,
                value,
            })
        })

        await page.route('**/*', async route => {
            const requestUrl = route.request().url()
            const protocol = new URL(requestUrl).protocol

            if (protocol !== 'http:' && protocol !== 'https:') {
                await route.continue()
                return
            }

            try {
                if (!options.allowLocalNetwork) await assertPublicUrl(normalizeUrl(requestUrl))
                await route.continue()
            }
            catch {
                await route.abort('blockedbyclient')
            }
        })
        await page.goto(options.url, {
            timeout: options.timeoutMs ?? 30_000,
            waitUntil: 'domcontentloaded',
        })
        await page.waitForLoadState('networkidle', {
            timeout: Math.min(options.timeoutMs ?? 30_000, NETWORK_SETTLE_TIMEOUT_MS),
        }).catch(() => undefined)
        await page.addStyleTag({
            content: `
                html, body, * {
                    scroll-behavior: auto !important;
                    scroll-snap-align: none !important;
                    scroll-snap-stop: normal !important;
                    scroll-snap-type: none !important;
                }
                html[${HIDE_FIXED_ATTRIBUTE}] [${FIXED_ELEMENT_ATTRIBUTE}] {
                    visibility: hidden !important;
                }
                [${OVERLAY_ATTRIBUTE}] {
                    display: none !important;
                }
                [data-sitesensory-repeat-label] {
                    visibility: hidden !important;
                }
                [${CURSOR_FOLLOWER_ATTRIBUTE}] {
                    visibility: hidden !important;
                }
                [${SETTLED_REVEAL_ATTRIBUTE}] {
                    clip-path: none !important;
                    filter: none !important;
                    opacity: 1 !important;
                    transform: none !important;
                }
                [${SUPPRESSED_SWAP_ATTRIBUTE}] {
                    opacity: 0 !important;
                }
            `,
        })
        await dismissBlockingOverlays(page)
        await preparePageForCapture(page)
        await dismissBlockingOverlays(page)
        await page.evaluate(async () => document.fonts.ready)

        const evidence = await page.evaluate(() => {
            /**
             * 只收集畫面上真正看得見的文字。innerText 會帶進螢幕外選單、
             * aria-hidden 與透明度為 0 的消息，那些不該進分析摘要。
             */
            function readVisiblePageText(): string
            {
                const chunks: string[] = []
                const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
                let node = walker.nextNode()

                while (node) {
                    const parent = node.parentElement

                    if (parent && isVisibleTextElement(parent)) {
                        const value = node.textContent?.replace(/\s+/g, ' ').trim()

                        if (value) chunks.push(value)
                    }

                    node = walker.nextNode()
                }

                return chunks.join(' ').replace(/\s+/g, ' ').trim().slice(0, 20_000)
            }

            function isVisibleTextElement(element: HTMLElement): boolean
            {
                let current: HTMLElement | null = element

                while (current && current !== document.documentElement) {
                    if (current.hidden || current.getAttribute('aria-hidden') === 'true' || current.inert) return false
                    if (current instanceof HTMLDialogElement && !current.open) return false

                    const style = getComputedStyle(current)

                    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false

                    current = current.parentElement
                }

                const bounds = element.getBoundingClientRect()

                if (bounds.width < 1 || bounds.height < 1) return false

                const top = bounds.top + window.scrollY
                const left = bounds.left + window.scrollX
                const scrollHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)
                const scrollWidth = Math.max(document.body.scrollWidth, document.documentElement.scrollWidth)

                if (top + bounds.height < -1 || top > scrollHeight + 1) return false
                if (left + bounds.width < -1 || left > scrollWidth + 1) return false

                return true
            }

            return {
                language: document.documentElement.lang || null,
                links: [...document.querySelectorAll('a[href]')].map(link => (link as HTMLAnchorElement).href),
                text: readVisiblePageText(),
                title: document.title.trim(),
            }
        })

        if (isAccessInterstitial(evidence.title, evidence.text)) {
            throw new Error('目標網站回傳存取驗證頁，未取得可分析的網站內容')
        }

        const hero = await settleVisibleViewport(page)
        const viewportBuffer = hero.hasWipeArtifact || hero.hasRevealArtifact
            ? (await nudgeForCleanViewport(page, 0))?.image ?? hero.image
            : hero.image
        const fullPageBuffer = await captureFullPage(page)
        const finalUrl = normalizeUrl(page.url())
        const [viewport, fullPage] = await Promise.all([
            options.storage.put(viewportBuffer, 'png'),
            options.storage.put(fullPageBuffer, 'png'),
        ])

        return {
            finalUrl,
            fullPage,
            language: evidence.language,
            links: discoverInternalLinks(finalUrl, evidence.links),
            textSummary: evidence.text,
            title: evidence.title,
            viewport,
        }
    }
    finally {
        await context.close()
    }
}

/**
 * 辨識通用的機器人驗證或存取攔截頁，避免把中介畫面發布成網站設計。
 *
 * @param title 瀏覽器頁面標題。
 * @param text 頁面可見文字。
 * @returns 證據符合存取驗證頁時為 true。
 */
export function isAccessInterstitial(title: string, text: string): boolean
{
    const normalizedTitle = title.toLocaleLowerCase().trim()
    const normalizedText = text.toLocaleLowerCase()
    const titleSignals = [
        'just a moment',
        'attention required',
        'security verification',
    ]
    const textSignals = [
        'checking your browser',
        'enable javascript and cookies to continue',
        'performing security verification',
        'verify you are human',
    ]
    const hasBlockedTitle = titleSignals.some(signal => normalizedTitle.includes(signal))
    const matchedTextSignals = textSignals.filter(signal => normalizedText.includes(signal)).length

    return hasBlockedTitle && matchedTextSignals > 0 || matchedTextSignals >= 2
}

/**
 * 把視窗與平滑捲動控制器一起跳到指定位置。Lenis 這類函式庫會用自己的
 * scroll 值蓋掉 window.scrollTo；有立即捲動 API 時先叫它，再同步
 * ScrollTrigger。這不是針對特定網域，只認頁面上的控制器。
 *
 * @param page Playwright 頁面。
 * @param scrollTop 文件座標。
 * @returns 完成捲動後結束。
 */
async function scrollPageTo(page: import('playwright').Page, scrollTop: number): Promise<void>
{
    await page.evaluate(top => {
        const host = window as Window & {
            ScrollTrigger?: { update?: () => void }
            __lenis?: { scrollTo?: (target: number, options?: { force?: boolean, immediate?: boolean }) => void }
            lenis?: { scrollTo?: (target: number, options?: { force?: boolean, immediate?: boolean }) => void }
        }

        for (const controller of [host.lenis, host.__lenis]) {
            if (typeof controller?.scrollTo === 'function') {
                controller.scrollTo(top, { force: true, immediate: true })
            }
        }

        window.scrollTo(0, top)
        document.documentElement.scrollTop = top
        document.body.scrollTop = top
        host.ScrollTrigger?.update?.()
    }, scrollTop)
}

/**
 * 讀取目前文件捲動位置。
 *
 * @param page Playwright 頁面。
 * @returns 四捨五入後的 scrollY。
 */
async function readDocumentScroll(page: import('playwright').Page): Promise<number>
{
    return page.evaluate(() => Math.round(window.scrollY))
}

/**
 * 捲到指定位置並確認沒有被平滑捲動再帶走。網站若把目標改寫到別的位置，
 * 會再下達幾次立即捲動；每次都等到 scrollY 連續不動。
 *
 * @param page Playwright 頁面。
 * @param scrollTop 文件座標。
 * @returns 穩定後的 scrollY。可能仍與目標不同。
 */
async function scrollPageToAndHold(page: import('playwright').Page, scrollTop: number): Promise<number>
{
    let actual = await readDocumentScroll(page)

    for (let attempt = 0; attempt < SCROLL_POSITION_ATTEMPTS; attempt += 1) {
        await scrollPageTo(page, scrollTop)
        actual = await waitUntilScrollStops(page)

        if (Math.abs(actual - scrollTop) <= DOCUMENT_HEIGHT_TOLERANCE_PX) return actual
    }

    return actual
}

/**
 * 等到 scrollY 連續兩次不變，避免把還在滑動的中間值當成擷取位置。
 *
 * @param page Playwright 頁面。
 * @returns 停下時的 scrollY。
 */
async function waitUntilScrollStops(page: import('playwright').Page): Promise<number>
{
    let previous = await readDocumentScroll(page)
    let stable = 0

    for (let index = 0; index < 12 && stable < 2; index += 1) {
        await page.waitForTimeout(40)
        const current = await readDocumentScroll(page)

        stable = current === previous ? stable + 1 : 0
        previous = current
    }

    return previous
}

/**
 * 先瀏覽完整頁面，讓依賴捲動或 IntersectionObserver 的內容完成載入。
 *
 * @param page Playwright 頁面。
 * @returns 頁面回到頂端且主要圖片已完成請求。
 */
async function preparePageForCapture(page: import('playwright').Page): Promise<void>
{
    let pageSettled = false
    let stableBottomChecks = 0

    for (let index = 0; index < MAX_SCROLL_STEPS; index += 1) {
        const state = await page.evaluate(stepRatio => {
            const viewportHeight = Math.max(window.innerHeight, 1)
            const step = Math.max(Math.floor(viewportHeight * stepRatio), 1)
            const pageHeight = Math.max(
                document.body.scrollHeight,
                document.documentElement.scrollHeight,
            )
            const bottom = Math.max(pageHeight - viewportHeight, 0)
            const next = Math.min(window.scrollY + step, bottom)
            const host = window as Window & {
                ScrollTrigger?: { update?: () => void }
                __lenis?: { scrollTo?: (target: number, options?: { force?: boolean, immediate?: boolean }) => void }
                lenis?: { scrollTo?: (target: number, options?: { force?: boolean, immediate?: boolean }) => void }
            }

            for (const controller of [host.lenis, host.__lenis]) {
                if (typeof controller?.scrollTo === 'function') {
                    controller.scrollTo(next, { force: true, immediate: true })
                }
            }

            window.scrollTo(0, next)
            host.ScrollTrigger?.update?.()

            return { pageHeight, reachedBottom: next >= bottom }
        }, SCROLL_STEP_RATIO)

        if (state.pageHeight > MAX_CAPTURE_HEIGHT) {
            throw new Error(`頁面高度 ${state.pageHeight}px 超過單次擷取上限 ${MAX_CAPTURE_HEIGHT}px`)
        }

        await page.waitForTimeout(SCROLL_DELAY_MS)

        if (!state.reachedBottom) {
            stableBottomChecks = 0
            continue
        }

        const currentHeight = await page.evaluate(() => Math.max(
            document.body.scrollHeight,
            document.documentElement.scrollHeight,
        ))

        stableBottomChecks = currentHeight === state.pageHeight ? stableBottomChecks + 1 : 0

        if (stableBottomChecks >= STABLE_BOTTOM_CHECKS) {
            pageSettled = true
            break
        }
    }

    if (!pageSettled) throw new Error('頁面持續新增內容，無法在擷取上限內取得穩定頁尾')

    await page.waitForFunction(
        () => [...document.images].every(image => image.complete),
        undefined,
        { timeout: IMAGE_SETTLE_TIMEOUT_MS },
    ).catch(() => undefined)
    await scrollPageTo(page, 0)
    await page.waitForTimeout(CONTENT_SETTLE_MS)
}

/**
 * 逐個視窗實際捲動並合成完整頁面，避免 scroll-driven animation(捲動驅動動畫)
 * 在瀏覽器的一次性 fullPage 截圖中保持透明。
 *
 * @param page 已完成預載並停在頁首的 Playwright 頁面。
 * @returns 寬度固定為 1920px 的完整 PNG。
 */
async function captureFullPage(page: import('playwright').Page): Promise<Buffer>
{
    const dimensions = await page.evaluate(() => ({
        height: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
        viewportHeight: window.innerHeight,
        width: window.innerWidth,
    }))

    if (dimensions.width !== DESKTOP_CAPTURE_PROFILE.width) {
        throw new Error(`擷取寬度應為 ${DESKTOP_CAPTURE_PROFILE.width}px，實際為 ${dimensions.width}px`)
    }

    if (dimensions.height > MAX_CAPTURE_HEIGHT) {
        throw new Error(`頁面高度 ${dimensions.height}px 超過單次擷取上限 ${MAX_CAPTURE_HEIGHT}px`)
    }

    const hasVirtualCanvas = await markFixedElements(page)
    const singleScreen = dimensions.height <= dimensions.viewportHeight + DOCUMENT_HEIGHT_TOLERANCE_PX

    const segments: OverlayOptions[] = []
    const keptSegments: Buffer[] = []
    const capturePositions = createCapturePositions(dimensions.height, dimensions.viewportHeight)
    let documentCoveredUntil = 0
    let outputHeight = 0
    let previousSignature: Buffer | null = null
    let recentTail: Buffer | null = null
    let stickyHold: StickySignature | null = null
    let trimmedPixels = 0
    const protectedBands: MediaBand[] = []

    for (const target of capturePositions) {
        await page.evaluate(({ hideFixedAttribute, scrollTop }) => {
            document.documentElement.toggleAttribute(hideFixedAttribute, scrollTop > 0)
        }, { hideFixedAttribute: HIDE_FIXED_ATTRIBUTE, scrollTop: target })
        await scrollPageToAndHold(page, target)
        await freezeExpandingBoxes(page)
        await settleScrollScrubbedFrame(page)
        await hideRepeatedStickyPinLabels(page, Math.max(0, documentCoveredUntil - target))
        let settled = await settleVisibleViewport(page)
        let acceptedNudge = false

        if (settled.hasWipeArtifact || settled.hasRevealArtifact) {
            const clean = await nudgeForCleanViewport(page, target)

            if (clean) {
                const nudged = await readDocumentScroll(page)
                const opensGap = !hasVirtualCanvas && nudged > documentCoveredUntil + DOCUMENT_HEIGHT_TOLERANCE_PX

                if (!opensGap) {
                    settled = clean
                    acceptedNudge = true
                }
                else {
                    await scrollPageToAndHold(page, target)
                }
            }
            else {
                await scrollPageToAndHold(page, target)
            }

            const stillDirty = !acceptedNudge && settled.hasWipeArtifact && !settled.hasRevealArtifact
            const laterCovers = capturePositions.some(position => position > target
                && position <= documentCoveredUntil + DOCUMENT_HEIGHT_TOLERANCE_PX)

            // 跟捲動綁死的 wipe 不寫進成品，但只在後面還有一段能從已覆蓋處接上時略過。
            // 略過的範圍不是像素比對裁掉的重複，不能計入 trimmedPixels。
            // 半完成揭示、以及後面接不上的區段，都寫入當時畫面；缺頁要讓高度檢查失敗。
            if (stillDirty && laterCovers && !hasVirtualCanvas) continue
        }

        const actualScroll = acceptedNudge
            ? await readDocumentScroll(page)
            : await scrollPageToAndHold(page, target)

        if (actualScroll > target && actualScroll > documentCoveredUntil) {
            throw new Error(`網站將 ${target}px 的擷取位置改到 ${actualScroll}px，無法產生無缺口的完整頁面`)
        }

        const documentStart = hasVirtualCanvas ? actualScroll : Math.max(actualScroll, documentCoveredUntil)
        const documentEnd = Math.min(actualScroll + dimensions.viewportHeight, dimensions.height)
        let sourceTop = hasVirtualCanvas ? 0 : documentStart - actualScroll
        let segmentHeight = hasVirtualCanvas ? dimensions.viewportHeight : documentEnd - documentStart

        if (segmentHeight <= 0) {
            const uncovered = dimensions.height - documentCoveredUntil

            // 文件只比一個視窗高幾個像素，而且捲動被鎖住時，第二段切不出新像素。
            // 單屏成品就是目前視窗，不能把這 4px 級的尾巴當成擷取失敗。
            if (keptSegments.length > 0 && uncovered <= DOCUMENT_HEIGHT_TOLERANCE_PX) break

            throw new Error(`無法擷取頁面 ${target}px 到 ${target + dimensions.viewportHeight}px 的區段`)
        }

        const viewport = settled.image
        const mediaBands = hasVirtualCanvas ? [] : await readUncroppedMediaBands(page)
        let segment: Buffer | null = await sharp(viewport)
            .extract({
                height: segmentHeight,
                left: 0,
                top: sourceTop,
                width: dimensions.width,
            })
            .toBuffer()
        let segmentBands = viewportBandsToSegment(mediaBands, sourceTop, segmentHeight)

        let preserveStickyFrame = false
        let pendingSticky: StickySignature | null = null

        if (segment && !hasVirtualCanvas && await stickyPinCoversViewport(page)) {
            const safeToCollapse = mediaBands.every(band => {
                const bandHeight = band.span ?? (band.bottom - band.top)

                return bandHeight < 40 || bandHeight > dimensions.viewportHeight * 0.7
            })

            if (safeToCollapse) {
                const signature = await readStickySignature(page)
                const relation = relateStickySignatures(stickyHold, signature)

                if (relation === 'drop-same') {
                    const richer = await captureRicherStickyFrame(page, signature, viewport)
                    const grew = richer.signature.texts.length > signature.texts.length
                        || richer.signature.images > signature.images

                    if (!grew) {
                        const sameText = stickyHold?.texts === signature.texts
                        const samePixels = !sameText || (recentTail
                            ? visualDifference(
                                await createVisualSignature(viewport),
                                await createVisualSignature(recentTail),
                            ) <= 0.06
                            : true)

                        if (samePixels) {
                            trimmedPixels += Math.max(0, documentEnd - documentCoveredUntil)
                            documentCoveredUntil = Math.max(documentCoveredUntil, documentEnd)
                            continue
                        }
                    }

                    const richerHeight = (await sharp(richer.image).metadata()).height ?? segmentHeight

                    segment = richer.image
                    segmentHeight = richerHeight
                    sourceTop = 0
                    segmentBands = viewportBandsToSegment(mediaBands, 0, richerHeight)
                    preserveStickyFrame = true
                    pendingSticky = richer.signature
                }

                if (relation === 'empty') {
                    const duplicatePrefix = recentTail
                        ? await stickyDuplicatePrefixLength(segment, recentTail, dimensions.width)
                        : 0

                    if (duplicatePrefix >= segmentHeight - 2) {
                        trimmedPixels += Math.max(0, documentEnd - documentCoveredUntil)
                        documentCoveredUntil = Math.max(documentCoveredUntil, documentEnd)
                        continue
                    }
                }
                else if (relation === 'replace' && stickyHold && keptSegments.length > 0) {
                    const richer = await captureRicherStickyFrame(page, signature, viewport)
                    const lastIndex = keptSegments.length - 1
                    const previousBuffer = keptSegments[lastIndex] ?? richer.image
                    const previousHeight = (await sharp(previousBuffer).metadata()).height ?? 0
                    const nextHeight = (await sharp(richer.image).metadata()).height ?? 0
                    const lastTop = Number(segments[lastIndex]?.top ?? 0)

                    segments[lastIndex] = { input: richer.image, left: 0, top: lastTop }
                    keptSegments[lastIndex] = richer.image
                    outputHeight += nextHeight - previousHeight

                    const advance = Math.max(0, documentEnd - documentCoveredUntil)

                    trimmedPixels += Math.max(0, advance - (nextHeight - previousHeight))
                    documentCoveredUntil = Math.max(documentCoveredUntil, documentEnd)
                    stickyHold = richer.signature
                    recentTail = richer.image

                    for (let bandIndex = protectedBands.length - 1; bandIndex >= 0; bandIndex -= 1) {
                        if ((protectedBands[bandIndex]?.top ?? 0) >= lastTop) protectedBands.splice(bandIndex, 1)
                    }

                    continue
                }
                else if (relation === 'keep') {
                    const richer = await captureRicherStickyFrame(page, signature, viewport)
                    const richerHeight = (await sharp(richer.image).metadata()).height ?? segmentHeight

                    segment = richer.image
                    segmentHeight = richerHeight
                    sourceTop = 0
                    segmentBands = viewportBandsToSegment(mediaBands, 0, richerHeight)
                    preserveStickyFrame = true
                    pendingSticky = richer.signature
                }
            }
            else {
                stickyHold = null
            }
        }
        else if (!hasVirtualCanvas) {
            stickyHold = null
        }

        if (!preserveStickyFrame && segment && !hasVirtualCanvas && recentTail && await stickyPinCoversViewport(page)) {
            const safeToCollapse = mediaBands.every(band => {
                const bandHeight = band.span ?? (band.bottom - band.top)

                return bandHeight < 40 || bandHeight > dimensions.viewportHeight * 0.7
            })
            const duplicatePrefix = safeToCollapse
                ? await stickyDuplicatePrefixLength(segment, recentTail, dimensions.width)
                : 0

            if (duplicatePrefix >= segmentHeight - 2) {
                trimmedPixels += Math.max(0, documentEnd - documentCoveredUntil)
                documentCoveredUntil = Math.max(documentCoveredUntil, documentEnd)
                continue
            }

            if (duplicatePrefix >= 24) {
                segment = await sharp(segment)
                    .extract({
                        height: segmentHeight - duplicatePrefix,
                        left: 0,
                        top: duplicatePrefix,
                        width: dimensions.width,
                    })
                    .png()
                    .toBuffer()
                trimmedPixels += duplicatePrefix
                segmentBands = viewportBandsToSegment(
                    mediaBands,
                    sourceTop + duplicatePrefix,
                    segmentHeight - duplicatePrefix,
                )
            }

            if (segment && safeToCollapse) {
                const edges = await stickyBlankEdges(segment, dimensions.width)
                const heightNow = (await sharp(segment).metadata()).height ?? 0
                const lead = edges.lead >= 200 && edges.lead < heightNow ? edges.lead : 0
                const tail = edges.tail >= 200 && lead + edges.tail < heightNow ? edges.tail : 0

                if (lead + tail >= 200 && edges.ink > 0) {
                    segment = await sharp(segment)
                        .extract({
                            height: heightNow - lead - tail,
                            left: 0,
                            top: lead,
                            width: dimensions.width,
                        })
                        .png()
                        .toBuffer()
                    trimmedPixels += lead + tail
                    segmentBands = viewportBandsToSegment(mediaBands, sourceTop + duplicatePrefix + lead, heightNow - lead - tail)
                }
            }
        }

        if (preserveStickyFrame && segment) {
            const advance = Math.max(0, documentEnd - documentCoveredUntil)
            const frameHeight = (await sharp(segment).metadata()).height ?? 0
            const overlap = frameHeight - advance

            // 整幀比這次文件行程高出的那一截，是和前一幀重疊的步進。
            // 留著會被接縫檢查當成重複帶。字與數字在畫面中段，拿掉頂端重疊仍讀得到。
            if (overlap > 8 && advance >= 24) {
                segment = await sharp(segment)
                    .extract({
                        height: advance,
                        left: 0,
                        top: overlap,
                        width: dimensions.width,
                    })
                    .png()
                    .toBuffer()
                segmentHeight = advance
                segmentBands = viewportBandsToSegment(mediaBands, overlap, advance)
            }
        }

        if (!hasVirtualCanvas) {
            const previous = keptSegments.at(-1)

            if (previous) {
                const beforePrefix = segmentHeight

                segment = await trimDuplicateScenePrefix(previous, segment, dimensions.width, {
                    bandOrigin: sourceTop,
                    identicalRows: true,
                    // 這一整幀的前綴若與前一幀相同，就是重疊步進，不能因為卡面保護帶而留下。
                    protectedBands: preserveStickyFrame ? [] : mediaBands,
                })

                const afterPrefix = segment
                    ? (await sharp(segment).metadata()).height ?? 0
                    : 0

                segmentBands = viewportBandsToSegment(mediaBands, sourceTop + (beforePrefix - afterPrefix), afterPrefix)
            }
        }

        if (segment && !hasVirtualCanvas && !singleScreen && !preserveStickyFrame) {
            segment = await trimRepeatedTailBand(segment, dimensions.width, {
                identicalRows: true,
                protectedBands: segmentBands,
            })
        }

        if (!segment) {
            trimmedPixels += Math.max(0, documentEnd - documentCoveredUntil)
            documentCoveredUntil = Math.max(documentCoveredUntil, documentEnd)
            continue
        }

        const trimmedMeta = await sharp(segment).metadata()
        const keptHeight = trimmedMeta.height ?? 0

        if (keptHeight <= 0) {
            trimmedPixels += Math.max(0, documentEnd - documentCoveredUntil)
            documentCoveredUntil = Math.max(documentCoveredUntil, documentEnd)
            continue
        }

        if (!hasVirtualCanvas) trimmedPixels += Math.max(0, segmentHeight - keptHeight)

        const signature = hasVirtualCanvas
            ? await createVisualSignature(segment)
            : null
        const previousKept = keptSegments.at(-1)

        if (
            signature
            && previousSignature
            && visualDifference(previousSignature, signature) <= VIRTUAL_CANVAS_DUPLICATE_THRESHOLD
        ) {
            const lastIndex = segments.length - 1
            const lastTop = Number(segments[lastIndex]?.top ?? 0)

            segments[lastIndex] = { input: segment, left: 0, top: lastTop }
            keptSegments[lastIndex] = segment
            previousSignature = signature
            continue
        }

        if (
            hasVirtualCanvas
            && previousKept
            && await isSamePinnedScene(previousKept, segment, dimensions.width)
        ) {
            const lastIndex = segments.length - 1
            const lastTop = Number(segments[lastIndex]?.top ?? 0)

            segments[lastIndex] = { input: segment, left: 0, top: lastTop }
            keptSegments[lastIndex] = segment
            previousSignature = signature
            continue
        }

        segments.push({ input: segment, left: 0, top: outputHeight })
        keptSegments.push(segment)
        stickyHold = pendingSticky ?? (hasVirtualCanvas ? stickyHold : null)

        if (!hasVirtualCanvas) {
            recentTail = await rememberRecentScene(recentTail, segment, dimensions.width, dimensions.viewportHeight)
        }

        if (!hasVirtualCanvas) {
            for (const band of segmentBands) {
                const top = outputHeight + band.top
                const bottom = outputHeight + band.bottom

                if (bottom - top >= 24 && bottom <= outputHeight + keptHeight) {
                    protectedBands.push({ bottom, top })
                }
            }
        }

        outputHeight += keptHeight
        documentCoveredUntil = documentEnd
        previousSignature = signature
    }

    if (outputHeight <= 0 || segments.length === 0) {
        throw new Error('沒有可拼接的視窗，無法產生完整頁面')
    }

    const fullPage = await sharp({
        create: {
            background: '#ffffff',
            channels: 3,
            height: outputHeight,
            width: dimensions.width,
        },
    })
        .composite(segments)
        .png()
        .toBuffer()
    const metadata = await sharp(fullPage).metadata()
    const finalHeight = await page.evaluate(() => Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight,
    ))

    if (
        metadata.width !== dimensions.width
        || metadata.height !== outputHeight
        || Math.abs(finalHeight - dimensions.height) > DOCUMENT_HEIGHT_TOLERANCE_PX
    ) {
        throw new Error('完整頁面合成後的尺寸與穩定頁面尺寸不一致')
    }

    let trimmed = singleScreen
        ? fullPage
        : await trimRepeatedTailBand(
            fullPage,
            dimensions.width,
            hasVirtualCanvas
                ? { viewportTiles: true }
                : { identicalRows: true, protectedBands },
        )
    let trimmedMeta = await sharp(trimmed).metadata()
    let imageHeight = trimmedMeta.height ?? 0

    if (!hasVirtualCanvas && imageHeight > finalHeight + DOCUMENT_HEIGHT_TOLERANCE_PX) {
        const absorbed = await absorbStrictWhiteOvershoot(
            trimmed,
            dimensions.width,
            imageHeight - finalHeight,
            protectedBands,
        )

        if (absorbed) {
            trimmed = absorbed
            trimmedMeta = await sharp(trimmed).metadata()
            imageHeight = trimmedMeta.height ?? 0
        }
    }

    if (trimmedMeta.width !== dimensions.width) {
        throw new Error('完整頁面合成後的尺寸與穩定頁面尺寸不一致')
    }

    if (!hasVirtualCanvas) {
        const removedByTail = Math.max(0, outputHeight - imageHeight)
        const accounted = trimmedPixels + removedByTail

        if (imageHeight > finalHeight + DOCUMENT_HEIGHT_TOLERANCE_PX) {
            throw new Error(`完整頁面高度 ${imageHeight}px 高於文件高度 ${finalHeight}px`)
        }

        if (imageHeight + accounted + DOCUMENT_HEIGHT_TOLERANCE_PX < finalHeight) {
            throw new Error(`完整頁面高度 ${imageHeight}px 低於文件高度 ${finalHeight}px，且沒有對應的去重`)
        }
    }

    if (await hasRepeatedOverlapSeam(trimmed, dimensions.width, dimensions.viewportHeight)) {
        throw new Error('拼接接縫以重疊步進重複同一段內容，拒絕保存')
    }

    return trimmed
}

/**
 * 以 20% 重疊產生逐段擷取位置，並確保最後一次停在可達頁尾。
 *
 * @param pageHeight 穩定後的文件高度。
 * @param viewportHeight 固定擷取視窗高度。
 * @returns 已去重且遞增的捲動位置。
 */
function createCapturePositions(pageHeight: number, viewportHeight: number): number[]
{
    const maximumScroll = Math.max(pageHeight - viewportHeight, 0)
    const step = Math.max(Math.floor(viewportHeight * CAPTURE_STEP_RATIO), 1)
    const positions: number[] = []

    for (let position = 0; position <= maximumScroll; position += step) {
        positions.push(position)
    }

    if (positions.at(-1) !== maximumScroll) positions.push(maximumScroll)

    return positions
}

/**
 * 將完整視窗縮成固定尺寸的 RGB 指紋，供相鄰虛擬畫布狀態比較。
 *
 * @param image 單一擷取區段。
 * @returns 固定長度的 RGB 像素資料。
 */
async function createVisualSignature(image: Buffer): Promise<Buffer>
{
    return sharp(image)
        .resize(SIGNATURE_WIDTH, SIGNATURE_HEIGHT, { fit: 'fill' })
        .removeAlpha()
        .raw()
        .toBuffer()
}

/**
 * 計算兩個同尺寸 RGB 指紋的平均正規化差異。
 *
 * @param left 前一個保留區段的指紋。
 * @param right 目前區段的指紋。
 * @returns 介於 0 與 1 的平均像素差異。
 */
function visualDifference(left: Buffer, right: Buffer): number
{
    if (left.length !== right.length) return 1

    let total = 0

    for (let index = 0; index < left.length; index += 1) {
        total += Math.abs((left[index] ?? 0) - (right[index] ?? 0))
    }

    return total / left.length / 255
}

/**
 * 計算指紋差異時略過裝飾區域。沒有遮罩時與全圖差異相同。
 * 遮罩蓋滿時視為沒有可比較的內容變化。
 *
 * @param left 前一幀指紋。
 * @param right 目前指紋。
 * @param mask 為 1 的像素不比較；null 表示全圖比較。
 * @returns 介於 0 與 1 的平均像素差異。
 */
function maskedVisualDifference(left: Buffer, right: Buffer, mask: Uint8Array | null): number
{
    if (!mask) return visualDifference(left, right)
    if (left.length !== right.length) return 1

    let total = 0
    let count = 0

    for (let pixel = 0; pixel < mask.length; pixel += 1) {
        if (mask[pixel]) continue

        const index = pixel * 3

        total += Math.abs((left[index] ?? 0) - (right[index] ?? 0))
        total += Math.abs((left[index + 1] ?? 0) - (right[index + 1] ?? 0))
        total += Math.abs((left[index + 2] ?? 0) - (right[index + 2] ?? 0))
        count += 3
    }

    if (count === 0) return 0

    return total / count / 255
}

/**
 * 單欄或單列差異，略過裝飾像素。整欄都被遮罩時不計入。
 *
 * @param left 前一幀指紋。
 * @param right 目前指紋。
 * @param width 指紋寬度。
 * @param height 指紋高度。
 * @param mask 為 1 的像素不比較；null 表示全圖比較。
 * @returns 介於 0 與 1 的最大欄或列差異。
 */
function maskedStripDifference(
    left: Buffer,
    right: Buffer,
    width: number,
    height: number,
    mask: Uint8Array | null,
): number
{
    if (!mask) return maxStripDifference(left, right, width, height)
    if (left.length !== right.length || left.length !== width * height * 3) return 1

    let maximum = 0

    for (let column = 0; column < width; column += 1) {
        let total = 0
        let count = 0

        for (let row = 0; row < height; row += 1) {
            if (mask[row * width + column]) continue

            const index = (row * width + column) * 3

            total += Math.abs((left[index] ?? 0) - (right[index] ?? 0))
            total += Math.abs((left[index + 1] ?? 0) - (right[index + 1] ?? 0))
            total += Math.abs((left[index + 2] ?? 0) - (right[index + 2] ?? 0))
            count += 1
        }

        if (count > 0) maximum = Math.max(maximum, total / count / 3 / 255)
    }

    for (let row = 0; row < height; row += 1) {
        let total = 0
        let count = 0

        for (let column = 0; column < width; column += 1) {
            if (mask[row * width + column]) continue

            const index = (row * width + column) * 3

            total += Math.abs((left[index] ?? 0) - (right[index] ?? 0))
            total += Math.abs((left[index + 1] ?? 0) - (right[index + 1] ?? 0))
            total += Math.abs((left[index + 2] ?? 0) - (right[index + 2] ?? 0))
            count += 1
        }

        if (count > 0) maximum = Math.max(maximum, total / count / 3 / 255)
    }

    return maximum
}

type ViewportRect = {
    height: number
    width: number
    x: number
    y: number
}

/**
 * 找出視窗裡一直在動、但不該擋住定影的裝飾：canvas、video，以及
 * 無限循環的 CSS／WAAPI 動畫目標。
 *
 * @param page Playwright 頁面。
 * @returns 與視窗相交的矩形，單位是 CSS 像素。
 */
async function readDecorativeViewportRects(page: import('playwright').Page): Promise<ViewportRect[]>
{
    return page.evaluate(() => {
        const rects: ViewportRect[] = []
        const seen = new Set<Element>()
        const push = (element: Element): void => {
            if (seen.has(element)) return

            const bounds = element.getBoundingClientRect()

            if (bounds.bottom <= 0 || bounds.top >= window.innerHeight) return
            if (bounds.right <= 0 || bounds.left >= window.innerWidth) return
            if (bounds.width < 8 || bounds.height < 8) return

            seen.add(element)
            rects.push({
                height: bounds.height,
                width: bounds.width,
                x: bounds.x,
                y: bounds.y,
            })
        }

        for (const node of document.querySelectorAll('canvas, video')) push(node)

        for (const animation of document.getAnimations()) {
            if (animation.playState !== 'running') continue

            const effect = animation.effect

            if (!(effect instanceof KeyframeEffect)) continue
            if (effect.getComputedTiming().iterations !== Infinity) continue
            if (effect.target instanceof Element) push(effect.target)
        }

        return rects
    })
}

/**
 * 把裝飾矩形對到 settle 指紋的像素遮罩。
 *
 * @param rects 視窗座標中的裝飾範圍。
 * @param viewportWidth 視窗寬度。
 * @param viewportHeight 視窗高度。
 * @returns 指紋像素遮罩；沒有裝飾時為 null。
 */
function buildDecorativeMask(rects: ViewportRect[], viewportWidth: number, viewportHeight: number): Uint8Array | null
{
    if (rects.length === 0 || viewportWidth <= 0 || viewportHeight <= 0) return null

    const mask = new Uint8Array(SETTLE_SIGNATURE_WIDTH * SETTLE_SIGNATURE_HEIGHT)

    for (const rect of rects) {
        const x0 = Math.max(0, Math.floor(rect.x / viewportWidth * SETTLE_SIGNATURE_WIDTH))
        const x1 = Math.min(
            SETTLE_SIGNATURE_WIDTH,
            Math.ceil((rect.x + rect.width) / viewportWidth * SETTLE_SIGNATURE_WIDTH),
        )
        const y0 = Math.max(0, Math.floor(rect.y / viewportHeight * SETTLE_SIGNATURE_HEIGHT))
        const y1 = Math.min(
            SETTLE_SIGNATURE_HEIGHT,
            Math.ceil((rect.y + rect.height) / viewportHeight * SETTLE_SIGNATURE_HEIGHT),
        )

        for (let y = y0; y < y1; y += 1) {
            for (let x = x0; x < x1; x += 1) mask[y * SETTLE_SIGNATURE_WIDTH + x] = 1
        }
    }

    return mask
}

/**
 * 檢查長圖是否在每個 viewport 接縫重複了 20% 重疊帶。
 * 文件流正確拼接時，接縫前後是相鄰的文件內容；虛擬畫布誤判會把整張
 * 1080 視窗以 864 步進疊上去，接縫兩側的 216px 就會是同一段畫面。
 * 純色帶不算，避免留白長頁被誤殺。
 *
 * @param image 拼接後的完整頁面。
 * @param width 圖片寬度。
 * @param viewportHeight 擷取視窗高度。
 * @returns 有內容的接縫重複時為 true。
 */
function mostlyWhiteBand(slice: Buffer): boolean
{
    if (slice.length < 3) return true

    let white = 0
    let count = 0

    for (let index = 0; index < slice.length; index += 3) {
        const luma = (slice[index] ?? 0) * 0.3
            + (slice[index + 1] ?? 0) * 0.59
            + (slice[index + 2] ?? 0) * 0.11

        count += 1
        if (luma >= 246) white += 1
    }

    return count === 0 || white / count >= 0.92
}

export async function hasRepeatedOverlapSeam(
    image: Buffer,
    width: number,
    viewportHeight: number,
): Promise<boolean>
{
    const metadata = await sharp(image).metadata()
    const height = metadata.height ?? 0
    const overlap = Math.max(Math.round(viewportHeight * (1 - CAPTURE_STEP_RATIO)), 1)

    if (height < viewportHeight + overlap || width <= 0) return false

    for (let seam = viewportHeight; seam + overlap <= height; seam += viewportHeight) {
        const [before, after] = await Promise.all([
            sharp(image).extract({
                height: overlap,
                left: 0,
                top: seam - overlap,
                width,
            }).removeAlpha().raw().toBuffer(),
            sharp(image).extract({
                height: overlap,
                left: 0,
                top: seam,
                width,
            }).removeAlpha().raw().toBuffer(),
        ])

        if (before.length !== after.length || before.length === 0) continue
        if (rowSliceVariance(before) < OVERLAP_SEAM_MIN_VARIANCE) continue
        if (mostlyWhiteBand(before) && mostlyWhiteBand(after)) continue
        if (visualDifference(before, after) > OVERLAP_SEAM_THRESHOLD) continue

        // 整段 sticky 場景會讓接縫前後都長一樣，而且再往下仍一樣。
        // 864 步進沒裁重疊時，重複只佔一個 216px，下一段就是新內容。
        if (seam + overlap * 2 <= height) {
            const following = await sharp(image).extract({
                height: overlap,
                left: 0,
                top: seam + overlap,
                width,
            }).removeAlpha().raw().toBuffer()

            if (visualDifference(after, following) <= OVERLAP_SEAM_THRESHOLD) continue

            return true
        }

        if (seam - overlap * 2 >= 0) {
            const preceding = await sharp(image).extract({
                height: overlap,
                left: 0,
                top: seam - overlap * 2,
                width,
            }).removeAlpha().raw().toBuffer()

            if (visualDifference(preceding, before) <= OVERLAP_SEAM_THRESHOLD) continue
        }

        return true
    }

    return false
}

/**
 * 標記頁首已存在的小型固定介面、透明的固定殼、頂部 sticky 導覽列，
 * 以及貼齊左右的 sticky 側欄，避免這些 chrome 在每段重複出現。
 * 真正的虛擬畫布（不透明舞台，或裡頭有蓋住約半個視窗的 canvas／影片）
 * 與接近整段 viewport 高且接近全寬的 sticky 捲動場景不在此列。
 * 透明且 pointer-events:none、又沒有大型畫面的 fixed 殼不是虛擬畫布，
 * 後段要藏起來，否則導覽鈕與裝飾圓會跟著每一段出現。
 *
 * @param page Playwright 頁面。
 * @returns 頁面上存在虛擬捲動畫布時為 true。
 */
async function markFixedElements(page: import('playwright').Page): Promise<boolean>
{
    return page.evaluate(options => {
        const backgroundAlpha = (style: CSSStyleDeclaration): number => {
            const color = style.backgroundColor

            if (!color || color === 'transparent') return 0

            const slash = color.match(/\/\s*([\d.]+%?)\s*\)/u)

            if (slash?.[1]) {
                return slash[1].endsWith('%') ? Number(slash[1].slice(0, -1)) / 100 : Number(slash[1])
            }

            const rgba = color.match(/rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/u)

            if (rgba?.[1]) return Number(rgba[1])

            return 1
        }
        const coversViewport = (bounds: DOMRect): boolean => bounds.width >= window.innerWidth * options.canvasCoverageRatio
            && bounds.height >= window.innerHeight * options.canvasCoverageRatio
            && bounds.bottom > 0
            && bounds.top < window.innerHeight
        const isVirtualCanvas = (element: HTMLElement): boolean => {
            const style = getComputedStyle(element)

            if (style.position !== 'fixed') return false
            if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false
            if (!coversViewport(element.getBoundingClientRect())) return false
            if (element.scrollHeight > window.innerHeight * options.shellRatio) return false

            for (const child of element.children) {
                if (child instanceof HTMLElement && child.scrollHeight > window.innerHeight * options.shellRatio) return false
            }

            const coversScene = (target: Element): boolean => {
                const targetBounds = target.getBoundingClientRect()

                return targetBounds.width >= window.innerWidth * options.sceneRatio
                    && targetBounds.height >= window.innerHeight * options.sceneRatio
            }
            const paintsScene = (target: HTMLElement): boolean => {
                const targetStyle = getComputedStyle(target)

                if (targetStyle.display === 'none' || targetStyle.visibility === 'hidden' || Number(targetStyle.opacity) === 0) {
                    return false
                }

                if (!coversScene(target)) return false
                if (target instanceof HTMLCanvasElement || target instanceof HTMLVideoElement) return true
                if (targetStyle.backgroundImage && targetStyle.backgroundImage !== 'none') return true

                return backgroundAlpha(targetStyle) >= 0.2
            }

            if (paintsScene(element)) return true
            if ([...element.querySelectorAll('canvas, video')].some(node => coversScene(node))) return true

            const transparent = backgroundAlpha(style) < 0.04
                && (!style.backgroundImage || style.backgroundImage === 'none')

            if (transparent && style.pointerEvents === 'none') return false

            return [...element.querySelectorAll<HTMLElement>('*')].some(node => paintsScene(node))
        }
        const elements = [...document.body.querySelectorAll<HTMLElement>('*')]
        let hasVirtualCanvas = false

        for (const element of elements) {
            const style = getComputedStyle(element)
            const position = style.position

            if (position !== 'fixed' && position !== 'sticky') continue
            if (element.parentElement) {
                const parentPosition = getComputedStyle(element.parentElement).position

                if (parentPosition === 'fixed' || parentPosition === 'sticky') continue
            }

            const bounds = element.getBoundingClientRect()

            if (position === 'fixed' && coversViewport(bounds)) {
                if (isVirtualCanvas(element)) {
                    hasVirtualCanvas = true
                    continue
                }

                if (element.scrollHeight > window.innerHeight * options.shellRatio) continue

                element.setAttribute(options.attribute, '')
                continue
            }

            if (coversViewport(bounds)) continue

            if (position === 'fixed') {
                element.setAttribute(options.attribute, '')
                continue
            }

            const top = Number.parseFloat(style.top)
            const left = Number.parseFloat(style.left)
            const right = Number.parseFloat(style.right)
            const inFirstViewport = bounds.bottom > 0 && bounds.top < window.innerHeight
            const isTopChrome = Number.isFinite(top)
                && top <= options.chromeTopMaxPx
                && bounds.height > 0
                && bounds.height < window.innerHeight * options.chromeMaxHeightRatio
                && bounds.width >= window.innerWidth * options.chromeMinWidthRatio
                && inFirstViewport
            const isSideChrome = inFirstViewport
                && bounds.width > 0
                && bounds.width < window.innerWidth * options.sideMaxWidthRatio
                && bounds.height >= window.innerHeight * options.sideMinHeightRatio
                && (
                    Number.isFinite(left) && left <= options.chromeSideMaxPx
                    || Number.isFinite(right) && right <= options.chromeSideMaxPx
                    || bounds.left <= 8
                    || bounds.right >= window.innerWidth - 8
                )

            if (isTopChrome || isSideChrome) element.setAttribute(options.attribute, '')
        }

        return hasVirtualCanvas
    }, {
        attribute: FIXED_ELEMENT_ATTRIBUTE,
        canvasCoverageRatio: FIXED_CANVAS_COVERAGE_RATIO,
        chromeMaxHeightRatio: STICKY_CHROME_MAX_HEIGHT_RATIO,
        chromeMinWidthRatio: STICKY_CHROME_MIN_WIDTH_RATIO,
        chromeSideMaxPx: STICKY_CHROME_SIDE_MAX_PX,
        chromeTopMaxPx: STICKY_CHROME_TOP_MAX_PX,
        sceneRatio: VIRTUAL_CANVAS_SCENE_RATIO,
        shellRatio: SCROLL_SHELL_HEIGHT_RATIO,
        sideMaxWidthRatio: STICKY_SIDE_MAX_WIDTH_RATIO,
        sideMinHeightRatio: STICKY_SIDE_MIN_HEIGHT_RATIO,
    })
}

/**
 * 把指標移出視窗，避免停在連結上時把「View Project」這類跟隨游標畫進截圖。
 *
 * @param page Playwright 頁面。
 * @returns 移動完成後結束。
 */
async function parkPointer(page: import('playwright').Page): Promise<void>
{
    await page.mouse.move(-80, -80).catch(() => undefined)
}

/**
 * 藏起跟著指標走的圓形游標。包含小圓點，以及寫著短標籤的較大圓泡。
 * 按鈕、連結與返回頂端不藏。
 *
 * @param page Playwright 頁面。
 * @returns 標記完成後結束。
 */
async function hideCustomCursorFollowers(page: import('playwright').Page): Promise<void>
{
    await page.evaluate(attribute => {
        for (const element of document.body.querySelectorAll<HTMLElement>(`[${attribute}]`)) {
            element.removeAttribute(attribute)
        }

        const rootCursor = getComputedStyle(document.documentElement).cursor
        const bodyCursor = getComputedStyle(document.body).cursor
        const systemCursorHidden = rootCursor === 'none' || bodyCursor === 'none'

        for (const element of document.body.querySelectorAll<HTMLElement>('*')) {
            const style = getComputedStyle(element)

            if (style.position !== 'fixed') continue
            if (style.visibility === 'hidden' || Number(style.opacity) === 0) continue

            const bounds = element.getBoundingClientRect()
            const size = Math.max(bounds.width, bounds.height)

            if (bounds.width < 4 || bounds.height < 4 || size > 200) continue
            if (bounds.bottom < 0 || bounds.right < 0) continue
            if (element.closest('a, button, input, textarea, select, [role="button"]')) continue

            const text = element.textContent?.replace(/\s+/g, ' ').trim() ?? ''

            if (text.length > 24) continue

            const radius = Number.parseFloat(style.borderTopLeftRadius)
            const round = style.borderRadius.includes('%')
                || (Number.isFinite(radius) && radius >= Math.min(bounds.width, bounds.height) * 0.4)
            const decorative = style.pointerEvents === 'none' || style.mixBlendMode === 'difference'
            const tinyTracker = size <= 18 && text.length === 0 && style.pointerEvents === 'none'

            if (!round && !tinyTracker) continue
            if (!decorative && !systemCursorHidden) continue

            element.setAttribute(attribute, '')
        }
    }, CURSOR_FOLLOWER_ATTRIBUTE)
}

/**
 * 蓋滿視窗的 sticky 場景。這種畫面的新列若只是同一幀的空白或複本，
 * 不能再往下接一截。
 *
 * @param page Playwright 頁面。
 * @returns 有 sticky 層同時蓋住寬高約 85% 時為 true。
 */
async function stickyPinCoversViewport(page: import('playwright').Page): Promise<boolean>
{
    return page.evaluate(() => {
        for (const element of document.body.querySelectorAll<HTMLElement>('*')) {
            const style = getComputedStyle(element)

            if (style.position !== 'sticky') continue
            if (style.visibility === 'hidden' || Number(style.opacity) < 0.2) continue

            const bounds = element.getBoundingClientRect()

            if (bounds.width < window.innerWidth * 0.85 || bounds.height < window.innerHeight * 0.85) continue
            if (bounds.top > window.innerHeight * 0.45) continue
            if (bounds.bottom < window.innerHeight * 0.7) continue

            return true
        }

        return false
    })
}

/**
 * 把還在長大的內聯盒子收到它自己的終態。只對已經佔據視窗的盒子往前看，
 * 讀到寬高與圓角不再變化後回到原捲動位置，再用 !important 釘住那組尺寸。
 *
 * @param page 已停在擷取位置的頁面。
 * @returns 釘住或確認不需要釘之後結束。
 */
async function freezeExpandingBoxes(page: import('playwright').Page): Promise<void>
{
    const original = await readDocumentScroll(page)

    await page.evaluate(() => {
        for (const node of document.querySelectorAll('[data-sitesensory-freeze-for]')) node.remove()
    })

    const candidate = await page.evaluate(() => {
        let bestId = ''
        let bestArea = 0
        const viewportArea = window.innerWidth * window.innerHeight

        for (const element of document.body.querySelectorAll<HTMLElement>('*')) {
            if (element.style.width === '' || element.style.height === '') continue

            const style = getComputedStyle(element)

            if (style.position === 'fixed' || style.display === 'none') continue

            const bounds = element.getBoundingClientRect()
            const area = bounds.width * bounds.height

            if (area < viewportArea * 0.28 || area <= bestArea) continue
            if (bounds.bottom < window.innerHeight * 0.45 || bounds.top > window.innerHeight * 0.92) continue

            const radiusText = style.borderTopLeftRadius
            const radius = Number.parseFloat(radiusText)
            const shorter = Math.min(bounds.width, bounds.height)
            const circle = (radiusText.includes('%') && radius >= 40)
                || (Number.isFinite(radius) && radius >= shorter * 0.45)

            if (circle) continue

            const fullBleed = bounds.width >= window.innerWidth - 8
                && bounds.height >= window.innerHeight - 8
                && (!Number.isFinite(radius) || radius < 1)

            if (fullBleed) continue

            const id = element.getAttribute('data-sitesensory-box-id')
                ?? `box-${bestArea.toFixed(0)}-${Math.round(bounds.top)}`

            element.setAttribute('data-sitesensory-box-id', id)
            bestId = id
            bestArea = area
        }

        return bestId
    })

    if (!candidate) return

    const initial = await readFrozenBox(page, candidate)

    await page.evaluate(id => {
        document.querySelector(`[data-sitesensory-freeze-for="${id}"]`)?.remove()
    }, candidate)

    let saved: FrozenBox | null = null
    let stable = 0

    for (let step = 1; step <= 14; step += 1) {
        const landed = await scrollPageToAndHold(page, original + step * 180)
        const box = await readFrozenBox(page, candidate)

        if (!box || Math.abs(landed - (original + step * 180)) > DOCUMENT_HEIGHT_TOLERANCE_PX * 4) break

        const grew = saved === null
            || box.width > saved.width + 4
            || box.height > saved.height + 4
            || box.radius < saved.radius - 1

        saved = box
        stable = grew ? 0 : stable + 1

        const fullBleed = box.width >= 1912 && box.height >= 1072 && box.radius < 1

        if (fullBleed || stable >= 2) break
    }

    await scrollPageToAndHold(page, original)

    if (!saved || !initial) return

    const grew = saved.width > initial.width + 4
        || saved.height > initial.height + 4
        || saved.radius < initial.radius - 1

    if (!grew) return

    const finalBox = saved
    const top = initial.top > 160 ? initial.top : finalBox.top

    await page.evaluate(({ box, id, top: lockedTop }) => {
        const element = document.querySelector<HTMLElement>(`[data-sitesensory-box-id="${id}"]`)

        if (!element) return

        const style = document.createElement('style')

        style.setAttribute('data-sitesensory-freeze-for', id)
        style.textContent = `[data-sitesensory-box-id="${id}"]{width:${box.width}px !important;height:${box.height}px !important;top:${lockedTop}px !important;left:${box.left}px !important;border-radius:${box.radius}px !important;}`
        document.head.appendChild(style)
    }, { box: finalBox, id: candidate, top })
}

type FrozenBox = {
    height: number
    left: number
    radius: number
    top: number
    width: number
}

/**
 * 讀取正在展開的盒子目前尺寸。
 *
 * @param page Playwright 頁面。
 * @param id 先前標上的盒子 id。
 * @returns 找不到時為 null。
 */
async function readFrozenBox(page: import('playwright').Page, id: string): Promise<FrozenBox | null>
{
    return page.evaluate(boxId => {
        const element = document.querySelector<HTMLElement>(`[data-sitesensory-box-id="${boxId}"]`)

        if (!element) return null

        const bounds = element.getBoundingClientRect()
        const radius = Number.parseFloat(getComputedStyle(element).borderTopLeftRadius)

        return {
            height: Math.round(bounds.height),
            left: Math.round(bounds.left),
            radius: Number.isFinite(radius) ? Math.round(radius) : 0,
            top: Math.round(bounds.top),
            width: Math.round(bounds.width),
        }
    }, id)
}

/**
 * 把視窗裡跟捲動綁住、又停在半路的揭示收到看得到的狀態。
 * 有限次 CSS 轉場仍交給原本的等待。互相重疊、輪流出現的內容只留目前最明顯的那一層。
 * 圖片、畫布與大面積的 translate／scale 收到版面位置，避免同一幕被縫成多種縮放。
 *
 * @param page Playwright 頁面。
 * @returns 標記完成後結束。
 */
async function settleScrollScrubbedFrame(page: import('playwright').Page): Promise<void>
{
    await page.evaluate(options => {
        for (const element of document.body.querySelectorAll<HTMLElement>(`[${options.settled}], [${options.suppressed}]`)) {
            element.removeAttribute(options.settled)
            element.removeAttribute(options.suppressed)
        }

        const viewportArea = window.innerWidth * window.innerHeight

        type ScrubTarget = {
            blur: number
            bounds: DOMRect
            element: HTMLElement
            midClip: boolean
            midScale: boolean
            opacity: number
        }

        const fades: ScrubTarget[] = []

        for (const element of document.body.querySelectorAll<HTMLElement>('*')) {
            if (hasRunningFiniteAnimation(element)) continue
            if (getComputedStyle(element).position === 'fixed') continue

            const inlineOpacity = element.style.opacity !== ''
            const inlineFilter = element.style.filter !== ''
            const inlineClip = element.style.clipPath !== '' && element.style.clipPath !== 'none'
            const inlineTransform = element.style.transform
            const style = getComputedStyle(element)
            const bounds = element.getBoundingClientRect()
            const heading = element.tagName === 'H1' || element.tagName === 'H2' || element.tagName === 'H3'
            const text = element.textContent?.replace(/\s+/g, ' ').trim() ?? ''
            const glyph = (element.tagName === 'SPAN' || element.tagName === 'EM' || element.tagName === 'I')
                && text.length > 0
                && text.length < 28
                && bounds.height > 8
                && bounds.height < 220
                && bounds.width < 480
            const shift = translationOf(style.transform)
            const verticalParallax = element.matches('img, video, canvas, [data-parallax]')
                && shift !== null
                && Math.abs(shift.y) > 8
                && Math.abs(shift.x) < 16
            const computedReveal = (heading || glyph)
                && bounds.bottom > 4
                && bounds.top < window.innerHeight - 4
                && (Number(style.opacity) < 0.98 || blurAmount(style.filter) > 0.5 || (glyph && style.transform !== 'none'))

            if (!inlineOpacity && !inlineFilter && !inlineClip && !inlineTransform && !computedReveal && !verticalParallax) continue

            if (bounds.bottom <= 4 || bounds.top >= window.innerHeight - 4) continue
            if (bounds.width < 8 || bounds.height < 8) continue
            if (style.display === 'none' || style.visibility === 'hidden') continue

            const target: ScrubTarget = {
                blur: blurAmount(style.filter),
                bounds,
                element,
                midClip: inlineClip && clipIsOpen(style.clipPath, bounds.height),
                midScale: scaleIsMid(style.transform),
                opacity: Number(style.opacity),
            }
            const area = bounds.width * bounds.height
            const textual = inlineOpacity || inlineFilter || inlineClip || computedReveal

            if (glyph && style.transform !== 'none' && target.opacity >= 0.9 && target.blur <= 0.5) {
                element.setAttribute(options.settled, '')
                continue
            }

            if (textual) fades.push(target)

            const parallaxMedia = element.matches('img, video, canvas, [data-parallax]')
                && (/translate|scale/i.test(inlineTransform) || verticalParallax)
            const largeShift = area >= viewportArea * 0.2
                && /translateY|translate3d|scale/i.test(inlineTransform)

            if (verticalParallax || ((parallaxMedia || largeShift || target.midScale) && area >= viewportArea * 0.04)) {
                element.setAttribute(options.settled, '')
            }
        }

        const visited = new Set<HTMLElement>()

        for (const seed of fades) {
            if (visited.has(seed.element)) continue

            const cluster: ScrubTarget[] = []
            const queue = [seed]

            visited.add(seed.element)

            while (queue.length > 0) {
                const current = queue.pop()

                if (!current) continue

                cluster.push(current)

                for (const other of fades) {
                    if (visited.has(other.element)) continue
                    if (overlapRatio(current.bounds, other.bounds) <= 0.55) continue

                    visited.add(other.element)
                    queue.push(other)
                }
            }

            const winner = cluster.reduce((best, item) => item.opacity > best.opacity ? item : best)
            const winnerNeedsSettle = winner.opacity < 0.98
                || winner.blur > 0.5
                || winner.midClip
                || winner.midScale

            if (cluster.length < 2) {
                if (seed.opacity < 0.2) {
                    const text = seed.element.textContent?.replace(/\s+/g, ' ').trim() ?? ''

                    if (shouldForceHiddenText(seed)) seed.element.setAttribute(options.settled, '')
                    else if (text.length >= 2) seed.element.setAttribute(options.suppressed, '')

                    continue
                }

                if (winnerNeedsSettle) seed.element.setAttribute(options.settled, '')

                continue
            }

            if (winnerNeedsSettle) winner.element.setAttribute(options.settled, '')

            for (const item of cluster) {
                if (item.element === winner.element) continue
                if (item.opacity >= winner.opacity - 0.02) continue

                item.element.setAttribute(options.suppressed, '')
            }
        }

        function hasRunningFiniteAnimation(element: HTMLElement): boolean
        {
            return element.getAnimations().some(animation => {
                if (animation.playState !== 'running') return false

                const effect = animation.effect

                if (!(effect instanceof KeyframeEffect)) return false

                return effect.getComputedTiming().iterations !== Infinity
            })
        }

        function blurAmount(filter: string): number
        {
            const match = filter.match(/blur\(\s*([0-9.]+)px\s*\)/iu)

            return match?.[1] ? Number.parseFloat(match[1]) : 0
        }

        function translationOf(transform: string): { x: number, y: number } | null
        {
            const match = transform.match(/matrix\(\s*([^)]+)\)/u)

            if (!match?.[1]) return null

            const parts = match[1].split(',').map(value => Number.parseFloat(value))
            const x = parts[4]
            const y = parts[5]

            if (x === undefined || y === undefined || Number.isNaN(x) || Number.isNaN(y)) return null

            return { x, y }
        }

        function scaleIsMid(transform: string): boolean
        {
            const match = transform.match(/matrix\(\s*([^)]+)\)/u)

            if (!match?.[1]) return false

            const parts = match[1].split(',').map(value => Number.parseFloat(value))
            const a = parts[0]
            const b = parts[1]
            const c = parts[2]
            const d = parts[3]

            if (a === undefined || b === undefined || c === undefined || d === undefined) return false

            const scaleX = Math.hypot(a, b)
            const scaleY = Math.hypot(c, d)
            const scale = Math.min(scaleX, scaleY)

            return Math.abs(scaleX - scaleY) < 0.08 && scale > 0.35 && scale < 0.94
        }

        function clipIsOpen(clip: string, elementHeight: number): boolean
        {
            const match = clip.match(/inset\(\s*([^)]+)\)/iu)

            if (!match?.[1]) return false

            const top = Number.parseFloat(match[1])
            const pixels = match[1].trim().endsWith('%') ? top / 100 * elementHeight : top

            return pixels > elementHeight * 0.08 && pixels < elementHeight * 0.92
        }

        function overlapRatio(left: DOMRect, right: DOMRect): number
        {
            const width = Math.min(left.right, right.right) - Math.max(left.left, right.left)
            const height = Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top)

            if (width <= 0 || height <= 0) return 0

            const smaller = Math.min(left.width * left.height, right.width * right.height)

            return smaller > 0 ? (width * height) / smaller : 0
        }

        function coverageOf(target: DOMRect, other: DOMRect): number
        {
            const width = Math.min(target.right, other.right) - Math.max(target.left, other.left)
            const height = Math.min(target.bottom, other.bottom) - Math.max(target.top, other.top)

            if (width <= 0 || height <= 0) return 0

            const area = target.width * target.height

            return area > 0 ? (width * height) / area : 0
        }

        function shouldForceHiddenText(target: ScrubTarget): boolean
        {
            const text = target.element.textContent?.replace(/\s+/g, ' ').trim() ?? ''

            if (text.length < 2) return false

            let pin: HTMLElement | null = target.element

            while (pin && getComputedStyle(pin).position !== 'sticky') pin = pin.parentElement

            const scope = pin ?? target.element
            const peers = fades.filter(other => {
                if (other.element === target.element) return false
                if (!scope.contains(other.element)) return false
                // 只跟蓋住這一句大部分面積的另一句競爭。滑進標題角落的專案名稱不是交叉淡化。
                if (coverageOf(target.bounds, other.bounds) <= 0.3) return false

                const otherText = other.element.textContent?.replace(/\s+/g, ' ').trim() ?? ''

                return otherText.length >= 2
            })

            if (peers.some(other => other.opacity > target.opacity + 0.04)) return false

            const tied = peers.filter(other => Math.abs(other.opacity - target.opacity) <= 0.04)

            if (tied.length > 0 && target.opacity < 0.5) {
                const ordered = [target, ...tied].sort((left, right) => {
                    const position = left.element.compareDocumentPosition(right.element)

                    if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1
                    if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1

                    return 0
                })

                return ordered[0] === target && target.opacity >= 0.08
            }

            return true
        }
    }, {
        settled: SETTLED_REVEAL_ATTRIBUTE,
        suppressed: SUPPRESSED_SWAP_ATTRIBUTE,
    })
}

/**
 * 滿視窗的 sticky 場景要留下預留高度，但裡面靠左或靠右、又比視窗窄的
 * 絕對定位標題會在每一段再畫一次。標題必須先在即將寫入的範圍裡真正看得見，
 * 才算留過一次；第一次若還是透明，不能先標記，否則後面會把標題整句藏掉。
 *
 * @param page 已捲到此段的 Playwright 頁面。
 * @param keptTop 這個視窗裡從上緣算起、已經覆蓋過、不會再寫入的像素。
 * @returns 標記完成後結束。
 */
async function hideRepeatedStickyPinLabels(page: import('playwright').Page, keptTop: number): Promise<void>
{
    await page.evaluate(options => {
        for (const node of document.querySelectorAll(`[${options.labelAttribute}]`)) {
            node.removeAttribute(options.labelAttribute)
        }

        for (const element of document.body.querySelectorAll<HTMLElement>('*')) {
            const style = getComputedStyle(element)

            if (style.position !== 'sticky') continue

            const bounds = element.getBoundingClientRect()

            if (bounds.height < window.innerHeight * options.pinCoverage) continue
            if (bounds.width < window.innerWidth * options.pinCoverage) continue
            if (bounds.bottom <= 0 || bounds.top >= window.innerHeight) continue

            const labels = sideLabels(element)
            const visibleKept = labels.some(child => labelIsVisible(child) && labelInKeptBand(child))

            if (!element.hasAttribute(options.seenAttribute)) {
                if (visibleKept) element.setAttribute(options.seenAttribute, '')

                continue
            }

            for (const child of labels) {
                if (labelInKeptBand(child) || labelIsVisible(child)) child.setAttribute(options.labelAttribute, '')
            }

            function sideLabels(pin: HTMLElement): HTMLElement[]
            {
                const found: HTMLElement[] = []

                for (const child of pin.querySelectorAll<HTMLElement>('*')) {
                    const childStyle = getComputedStyle(child)

                    if (childStyle.position !== 'absolute' && childStyle.position !== 'sticky') continue

                    const childBounds = child.getBoundingClientRect()

                    if (childBounds.width < 24 || childBounds.height < 24) continue
                    if (childBounds.width >= window.innerWidth * options.labelMaxWidthRatio) continue
                    if (childBounds.height >= window.innerHeight * options.labelMaxHeightRatio) continue
                    if (childBounds.bottom <= 0 || childBounds.top >= window.innerHeight) continue

                    const onSide = childBounds.left <= window.innerWidth * options.labelSideRatio
                        || childBounds.right >= window.innerWidth * (1 - options.labelSideRatio)

                    if (onSide) found.push(child)
                }

                return found
            }

            function labelIsVisible(child: HTMLElement): boolean
            {
                const childStyle = getComputedStyle(child)

                return childStyle.visibility !== 'hidden' && Number(childStyle.opacity) >= 0.85
            }

            function labelInKeptBand(child: HTMLElement): boolean
            {
                const childBounds = child.getBoundingClientRect()

                return childBounds.bottom > options.keptTop + 4 && childBounds.top < window.innerHeight - 4
            }
        }
    }, {
        keptTop,
        labelAttribute: 'data-sitesensory-repeat-label',
        labelMaxHeightRatio: STICKY_PIN_LABEL_MAX_HEIGHT_RATIO,
        labelMaxWidthRatio: STICKY_PIN_LABEL_MAX_WIDTH_RATIO,
        labelSideRatio: STICKY_PIN_LABEL_SIDE_RATIO,
        pinCoverage: FIXED_CANVAS_COVERAGE_RATIO,
        seenAttribute: 'data-sitesensory-pin-seen',
    })
}

/**
 * 等到可見區域穩定；若仍像 wipe 殘影，再等一輪後決定要不要寫入。
 *
 * @param page 已捲到目標位置的 Playwright 頁面。
 * @returns 最後一張視窗截圖，以及是否仍偵測到 wipe 條紋。
 */
async function settleVisibleViewport(page: import('playwright').Page): Promise<{
    hasRevealArtifact: boolean
    hasWipeArtifact: boolean
    image: Buffer
}>
{
    const first = await waitForVisibleViewportToSettle(page)

    if (!first.hasWipeArtifact) return first

    return waitForVisibleViewportToSettle(page)
}

/**
 * 關閉或隱藏阻擋畫面的隱私／Cookie 同意層，避免首屏與拼接結果留下對話框。
 * 優先點選拒絕、僅必要或關閉；找不到可點控制時再隱藏剩餘的對話框與背板。
 *
 * @param page Playwright 頁面，包含可能承載同意層的 iframe。
 * @returns 各 frame 處理完成後結束。
 */
async function dismissBlockingOverlays(page: import('playwright').Page): Promise<void>
{
    for (const frame of page.frames()) {
        await frame.evaluate(dismissAndHideOverlaysInPage, {
            overlayAttribute: OVERLAY_ATTRIBUTE,
            settleMs: OVERLAY_SETTLE_MS,
        }).catch(() => undefined)
    }
}

/**
 * 在單一文件（主頁或 iframe）內尋找同意層控制並關閉；此函式會被送進瀏覽器執行。
 *
 * @param options 隱藏用屬性名稱與點選後的等待時間。
 * @returns 點選與隱藏流程完成後結束。
 */
async function dismissAndHideOverlaysInPage(options: {
    overlayAttribute: string
    settleMs: number
}): Promise<void>
{
    if (!document.body) return

    const clicked = clickConsentControl()

    if (clicked) await new Promise<void>(resolve => setTimeout(resolve, options.settleMs))

    const hidden = hideRemainingConsentOverlays(options.overlayAttribute)

    if (clicked || hidden) unlockDocumentScroll()

    function clickConsentControl(): boolean
    {
        const controls = collectClickableElements(document)
            .filter(element => isVisible(element) && !isDisabled(element))
            .map(element => ({ element, rank: rankConsentControl(element) }))
            .filter(candidate => candidate.rank > 0)
            .sort((left, right) => left.rank - right.rank)

        const selected = controls[0]?.element

        if (!selected) return false

        selected.click()
        return true
    }

    function hideRemainingConsentOverlays(attribute: string): boolean
    {
        const overlays = collectConsentOverlays()
        let hidden = false

        for (const overlay of overlays) {
            const root = overlayRoot(overlay)

            hideNode(root, attribute)
            hidden = true

            const parent = root.parentElement

            if (!parent) continue

            for (const sibling of parent.children) {
                if (sibling === root || !(sibling instanceof HTMLElement)) continue
                if (isBackdrop(sibling)) hideNode(sibling, attribute)
            }
        }

        return hidden
    }

    function collectConsentOverlays(): HTMLElement[]
    {
        const matches: HTMLElement[] = []

        for (const element of collectElements(document.body)) {
            if (!isVisible(element)) continue
            if (!isOverlayCandidate(element)) continue
            if (!looksLikeConsent(element)) continue

            const bounds = element.getBoundingClientRect()

            if (bounds.width < 80 || bounds.height < 40) continue

            matches.push(element)
        }

        return matches.filter(element => !matches.some(other => other !== element && other.contains(element)))
    }

    function collectClickableElements(root: ParentNode): HTMLElement[]
    {
        const selector = 'button, [role="button"], input[type="button"], input[type="submit"], a, [aria-label]'
        const found = [...root.querySelectorAll<HTMLElement>(selector)]

        for (const element of collectElements(root)) {
            if (element.shadowRoot) found.push(...collectClickableElements(element.shadowRoot))
        }

        return found
    }

    function collectElements(root: ParentNode): HTMLElement[]
    {
        const elements: HTMLElement[] = []

        for (const element of root.querySelectorAll<HTMLElement>('*')) {
            elements.push(element)
            if (element.shadowRoot) elements.push(...collectElements(element.shadowRoot))
        }

        return elements
    }

    function rankConsentControl(element: HTMLElement): number
    {
        const text = controlText(element)

        if (!text) return 0
        if (isSettingsControl(text)) return 0
        if (isAcceptControl(text)) return 0
        if (isDeclineAllControl(text)) return 1
        if (isEssentialControl(text)) return 2

        const inConsent = Boolean(closestConsentOverlay(element))

        if (isDeclineControl(text) && inConsent) return 3
        if (isCloseControl(text, element) && inConsent) return 4

        return 0
    }

    function closestConsentOverlay(element: HTMLElement): HTMLElement | null
    {
        let current: HTMLElement | null = element

        while (current) {
            if (isOverlayCandidate(current) && looksLikeConsent(current)) return current

            const root: Node = current.getRootNode()

            if (current.parentElement) {
                current = current.parentElement
                continue
            }

            current = root instanceof ShadowRoot && root.host instanceof HTMLElement ? root.host : null
        }

        return null
    }

    function looksLikeConsent(element: HTMLElement): boolean
    {
        const label = [
            element.id,
            element.getAttribute('class') ?? '',
            element.getAttribute('aria-label') ?? '',
        ].join(' ')
        const text = normalizeText(element.innerText ?? '')
        const labelMatch = /cookie|consent|gdpr|ccpa|onetrust|cookiebot|didomi|usercentrics/i.test(label)
        const textMatch = /cookie|consent|gdpr|we have the cookies|個人資料|隱私權|クッキー|쿠키/i.test(text)

        if (!labelMatch && !textMatch) return false

        const bounds = element.getBoundingClientRect()
        const coversViewport = bounds.width >= window.innerWidth * 0.8
            && bounds.height >= window.innerHeight * 0.8

        return !(coversViewport && text.length > 800)
    }

    function isOverlayCandidate(element: HTMLElement): boolean
    {
        if (element === document.body || element === document.documentElement) return false

        const style = getComputedStyle(element)
        const role = element.getAttribute('role')
        const isDialog = role === 'dialog'
            || element.getAttribute('aria-modal') === 'true'
            || element instanceof HTMLDialogElement

        return isDialog
            || style.position === 'fixed'
            || style.position === 'sticky'
            || style.position === 'absolute'
    }

    function overlayRoot(element: HTMLElement): HTMLElement
    {
        let current = element

        while (current.parentElement && current.parentElement !== document.body && current.parentElement !== document.documentElement) {
            const parent = current.parentElement
            const position = getComputedStyle(parent).position

            if (position !== 'fixed' && position !== 'sticky' && position !== 'absolute') break

            current = parent
        }

        return current
    }

    function isBackdrop(element: HTMLElement): boolean
    {
        const style = getComputedStyle(element)

        if (style.position !== 'fixed' && style.position !== 'absolute') return false

        const bounds = element.getBoundingClientRect()

        if (bounds.width < window.innerWidth * 0.8 || bounds.height < window.innerHeight * 0.8) return false

        const text = normalizeText(element.innerText ?? '')

        if (text.length > 80) return false

        return isSemiTransparent(style)
    }

    function isSemiTransparent(style: CSSStyleDeclaration): boolean
    {
        if (Number(style.opacity) > 0 && Number(style.opacity) < 1) return true

        const match = style.backgroundColor.match(/rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+(?:\s*,\s*([\d.]+))?\s*\)/u)

        if (!match) return false

        const alpha = match[1] === undefined ? 1 : Number(match[1])

        return alpha > 0 && alpha < 1
    }

    function hideNode(element: HTMLElement, attribute: string): void
    {
        element.setAttribute(attribute, '')
        element.style.setProperty('display', 'none', 'important')
    }

    function unlockDocumentScroll(): void
    {
        for (const node of [document.documentElement, document.body]) {
            const style = getComputedStyle(node)

            if (style.overflow === 'hidden' || style.overflowY === 'hidden') {
                node.style.setProperty('overflow', 'auto', 'important')
                node.style.setProperty('overflow-y', 'auto', 'important')
            }
        }
    }

    function isVisible(element: HTMLElement): boolean
    {
        const style = getComputedStyle(element)

        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false

        const bounds = element.getBoundingClientRect()

        return bounds.width > 0 && bounds.height > 0
    }

    function isDisabled(element: HTMLElement): boolean
    {
        return element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true'
    }

    function controlText(element: HTMLElement): string
    {
        return normalizeText([
            element.innerText,
            element.getAttribute('aria-label'),
            element.getAttribute('title'),
            element.getAttribute('value'),
        ].filter(Boolean).join(' '))
    }

    function normalizeText(value: string): string
    {
        return value.replace(/\s+/g, ' ').trim().toLocaleLowerCase()
    }

    function compactText(value: string): string
    {
        return value.replace(/\s+/g, '')
    }

    function isSettingsControl(text: string): boolean
    {
        return /settings|customize|customise|preferences|manage cookies|設定|设置|설정|anpassen|paramètres/i.test(text)
    }

    function isAcceptControl(text: string): boolean
    {
        const compact = compactText(text)

        return /accept\s*all|allow\s*all|agree\s*all|akzeptieren|tout\s*accepter|aceptar\s*todo|同意全部|接受全部|모두\s*동의/i.test(text)
            || /acceptall|allowall|agreeall/i.test(compact)
            || /^(accept|allow|agree|同意|接受|akzeptieren|aceptar|accepter)$/i.test(text)
    }

    function isDeclineAllControl(text: string): boolean
    {
        const compact = compactText(text)

        return /decline\s*all|reject\s*all|deny\s*all|refuse\s*all|ablehnen|tout\s*refuser|rechazar\s*todo|全部拒絕|拒绝全部|모두\s*거부/i.test(text)
            || /declineall|rejectall|denyall|refuseall/i.test(compact)
    }

    function isEssentialControl(text: string): boolean
    {
        return /essential\s*only|necessary\s*only|required\s*only|only\s*(?:essential|necessary|required)|use\s*necessary|continue\s*without|accept\s*(?:essential|necessary)|nur\s*notwendige|僅必要|只允許必要/i.test(text)
    }

    function isDeclineControl(text: string): boolean
    {
        return /^(decline|reject|deny|refuse|disagree|ablehnen|refuser|rechazar|拒絕|拒绝|거부)$/i.test(text)
    }

    function isCloseControl(text: string, element: HTMLElement): boolean
    {
        const label = normalizeText(element.getAttribute('aria-label') ?? '')

        if (/close|dismiss|schlie|fermer|cerrar|關閉|关闭|닫기/i.test(label)) return true

        return /^(close|dismiss|×|✕|⨯|✖|x)$/i.test(text)
    }
}

/**
 * 等到目前可見區域的進入動畫與揭示完成：先保留既有的最短停留、兩次
 * requestAnimationFrame 與可見圖片等待，再以較高解析畫面指紋確認沒有
 * 細條 wipe／遮罩仍在移動，並比對大型可見元素的 opacity、transform、
 * clip-path。CSS／WAAPI 有限次動畫仍要等完；無限循環動畫不列入。
 * 直條若貫穿整段指紋且連續穩定超過設計停留門檻，視為版面線條而非
 * wipe。只打在照片帶上的直條若連續穩定，視為跟捲動綁死的半完成揭示，
 * 提早結束 settle，交給呼叫端微移；後面接得上才略過，否則寫入當時畫面。
 * 揭示停住約兩秒仍未結束時，視為跟捲動綁住的狀態並交回呼叫端，不再空等。
 * canvas、video 與無限循環動畫的像素不列入定影，避免裝飾永遠等不完。
 * 不使用 prefers-reduced-motion。
 *
 * @param page 已捲到目標位置的 Playwright 頁面。
 * @returns 最後一張視窗截圖，以及該幀是否仍像 wipe。
 */
async function waitForVisibleViewportToSettle(page: import('playwright').Page): Promise<{
    hasRevealArtifact: boolean
    hasWipeArtifact: boolean
    image: Buffer
}>
{
    await page.waitForTimeout(CAPTURE_SETTLE_MS)
    await page.evaluate(() => new Promise<void>(resolve => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    }))
    await waitForVisibleImages(page)

    const deadline = Date.now() + VIEWPORT_SETTLE_TIMEOUT_MS
    const viewport = page.viewportSize() ?? {
        height: DESKTOP_CAPTURE_PROFILE.height,
        width: DESKTOP_CAPTURE_PROFILE.width,
    }
    let previousSignature: Buffer | null = null
    let previousLayout = ''
    let stableSamples = 0
    let wipeHoldSamples = 0
    let revealHoldSamples = 0
    let decorativeHoldSamples = 0
    let latest: Buffer | null = null
    let latestHasWipe = false
    let latestHasReveal = false

    while (Date.now() < deadline) {
        const hasCssMotion = await hasFiniteViewportAnimations(page)
        const layout = await readViewportLayoutState(page)
        const incompleteReveal = await hasIncompleteReveal(page)
        const decorativeMask = buildDecorativeMask(
            await readDecorativeViewportRects(page),
            viewport.width,
            viewport.height,
        )
        const screenshot = await screenshotViewport(page, 'allow')
        const signature = await createSettleSignature(screenshot)
        const hasWipe = looksLikeVerticalWipe(signature, SETTLE_SIGNATURE_WIDTH, SETTLE_SIGNATURE_HEIGHT)
        const visuallyStable = Boolean(
            previousSignature
            && maskedVisualDifference(previousSignature, signature, decorativeMask) <= VIEWPORT_SETTLE_THRESHOLD
            && maskedStripDifference(
                previousSignature,
                signature,
                SETTLE_SIGNATURE_WIDTH,
                SETTLE_SIGNATURE_HEIGHT,
                decorativeMask,
            ) <= VIEWPORT_SETTLE_STRIP_THRESHOLD,
        )
        const layoutStable = previousLayout !== '' && previousLayout === layout
        const motionStopped = !hasCssMotion && visuallyStable && layoutStable
        const pageLevelWipe = looksLikeFullColumnWipe(signature, SETTLE_SIGNATURE_WIDTH, SETTLE_SIGNATURE_HEIGHT)

        latest = screenshot
        latestHasWipe = hasWipe
        latestHasReveal = incompleteReveal
        wipeHoldSamples = hasWipe && motionStopped ? wipeHoldSamples + 1 : 0
        revealHoldSamples = incompleteReveal && motionStopped && !hasWipe ? revealHoldSamples + 1 : 0
        decorativeHoldSamples = !hasCssMotion && layoutStable && !incompleteReveal && !hasWipe && !visuallyStable
            ? decorativeHoldSamples + 1
            : 0
        const wipeLooksLikeDesign = pageLevelWipe && wipeHoldSamples >= VIEWPORT_WIPE_HOLD_SAMPLES
        const wipeLooksLocked = hasWipe && !pageLevelWipe && motionStopped
            && wipeHoldSamples >= VIEWPORT_LOCKED_WIPE_SAMPLES

        stableSamples = motionStopped && (!hasWipe || wipeLooksLikeDesign) && !incompleteReveal
            ? stableSamples + 1
            : 0
        previousSignature = signature
        previousLayout = layout

        // 揭示沒結束就先交卷，會把縮放或淡入停在半路的畫面存下來。
        // 有限次動畫仍要等到結束。畫面已經停住、卻仍像揭示時，那是跟捲動綁住的狀態。
        if (wipeLooksLocked) {
            return {
                hasRevealArtifact: incompleteReveal,
                hasWipeArtifact: true,
                image: screenshot,
            }
        }

        if (revealHoldSamples >= VIEWPORT_REVEAL_HOLD_SAMPLES) {
            return {
                hasRevealArtifact: true,
                hasWipeArtifact: false,
                image: screenshot,
            }
        }

        if (decorativeHoldSamples >= VIEWPORT_REVEAL_HOLD_SAMPLES) {
            return {
                hasRevealArtifact: false,
                hasWipeArtifact: false,
                image: screenshot,
            }
        }

        if (stableSamples >= VIEWPORT_SETTLE_STABLE_SAMPLES) {
            return {
                hasRevealArtifact: false,
                hasWipeArtifact: hasWipe && !wipeLooksLikeDesign,
                image: screenshot,
            }
        }

        await page.waitForTimeout(VIEWPORT_SETTLE_POLL_MS)
    }

    if (!latest) latest = await screenshotViewport(page, 'allow')

    return {
        hasRevealArtifact: latestHasReveal,
        hasWipeArtifact: latestHasWipe,
        image: latest,
    }
}

/**
 * 半完成 wipe 若跟捲動進度綁死，再等也不會結束。往後微移幾個位置，
 * 找到沒有 wipe 的視窗就採用；都找不到則放棄該幀。
 *
 * @param page Playwright 頁面。
 * @param target 原本的擷取捲動位置。
 * @returns 乾淨視窗；找不到時為 null。
 */
async function nudgeForCleanViewport(
    page: import('playwright').Page,
    target: number,
): Promise<{ hasRevealArtifact: boolean, hasWipeArtifact: boolean, image: Buffer } | null>
{
    const limits = await page.evaluate(() => ({
        maxScroll: Math.max(
            Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) - window.innerHeight,
            0,
        ),
        viewportHeight: window.innerHeight,
    }))

    for (const ratio of NUDGE_RATIOS) {
        const nextTop = Math.min(target + Math.round(limits.viewportHeight * ratio), limits.maxScroll)

        if (nextTop <= target) continue

        await scrollPageTo(page, nextTop)
        await page.waitForTimeout(NUDGE_PEEK_MS)
        await page.evaluate(() => new Promise<void>(resolve => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        }))

        const image = await screenshotViewport(page, 'allow')
        const signature = await createSettleSignature(image)
        const incompleteReveal = await hasIncompleteReveal(page)

        if (!incompleteReveal && !looksLikeVerticalWipe(signature, SETTLE_SIGNATURE_WIDTH, SETTLE_SIGNATURE_HEIGHT)) {
            return { hasRevealArtifact: false, hasWipeArtifact: false, image }
        }
    }

    return null
}

/**
 * 判斷目前視窗內是否仍有有限次數的進入動畫或轉場。無限循環動畫不列入，
 * 以免輪播或背景動態讓擷取永遠等下去。
 *
 * @param page Playwright 頁面。
 * @returns 存在仍在進行且目標落在視窗內的有限次動畫時為 true。
 */
async function hasFiniteViewportAnimations(page: import('playwright').Page): Promise<boolean>
{
    return page.evaluate(() => document.getAnimations().some(animation => {
        if (animation.playState !== 'running') return false

        const effect = animation.effect

        if (!(effect instanceof KeyframeEffect)) return false
        if (effect.getComputedTiming().iterations === Infinity) return false

        const target = effect.target

        if (!(target instanceof Element)) return false

        const bounds = target.getBoundingClientRect()

        return bounds.bottom > 0
            && bounds.top < window.innerHeight
            && bounds.right > 0
            && bounds.left < window.innerWidth
    }))
}

/**
 * 視窗裡是否還有沒播完的水平 clip、交叉淡化、分段淡入，或大元素停在中間縮放。
 * 圓角 polygon 與單一設計用的半透明層不算，避免正常版面被空等。
 * 三條以上的半透明帶，或蓋住約半個視窗、縮放還在 0.35 到 0.94 的元素，算還沒定影。
 * canvas、video 與無限循環動畫是裝飾，不當成沒播完的揭示。
 *
 * @param page Playwright 頁面。
 * @returns 仍像揭示或交叉淡化的中間幀時為 true。
 */
async function hasIncompleteReveal(page: import('playwright').Page): Promise<boolean>
{
    return page.evaluate(() => {
        const viewportArea = window.innerWidth * window.innerHeight
        const minArea = viewportArea * 0.08
        const partials: DOMRect[] = []
        let partialBands = 0
        const decorative = decorativeMotionElements()

        for (const element of document.body.querySelectorAll<HTMLElement>('*')) {
            if (decorative.has(element)) continue

            const style = getComputedStyle(element)

            if (style.display === 'none' || style.visibility === 'hidden') continue

            const opacity = Number(style.opacity)

            if (opacity <= 0.05) continue

            const bounds = element.getBoundingClientRect()

            if (bounds.bottom <= 0 || bounds.top >= window.innerHeight) continue
            if (bounds.right <= 0 || bounds.left >= window.innerWidth) continue
            if (bounds.width < 64 || bounds.height < 48) continue

            const area = bounds.width * bounds.height

            if (scaleLooksLikeMidReveal(style.transform) && area >= minArea) return true
            if (area < minArea) {
                if (opacity < 0.92 && opacity > 0.08 && area >= viewportArea * 0.04) partialBands += 1

                continue
            }
            if (clipLooksLikeMidReveal(style.clipPath, bounds.height)) return true
            if (opacity < 0.9) partials.push(bounds)
        }

        if (partialBands >= 3) return true

        for (let leftIndex = 0; leftIndex < partials.length; leftIndex += 1) {
            for (let rightIndex = leftIndex + 1; rightIndex < partials.length; rightIndex += 1) {
                const left = partials[leftIndex]
                const right = partials[rightIndex]

                if (!left || !right) continue

                const overlapWidth = Math.min(left.right, right.right) - Math.max(left.left, right.left)
                const overlapHeight = Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top)

                if (overlapWidth <= 0 || overlapHeight <= 0) continue

                const overlap = overlapWidth * overlapHeight
                const smaller = Math.min(left.width * left.height, right.width * right.height)

                if (smaller > 0 && overlap / smaller > 0.6) return true
            }
        }

        return false

        function decorativeMotionElements(): Set<HTMLElement>
        {
            const elements = new Set<HTMLElement>()

            for (const node of document.querySelectorAll<HTMLElement>('canvas, video')) elements.add(node)

            for (const animation of document.getAnimations()) {
                if (animation.playState !== 'running') continue

                const effect = animation.effect

                if (!(effect instanceof KeyframeEffect)) continue
                if (effect.getComputedTiming().iterations !== Infinity) continue
                if (effect.target instanceof HTMLElement) elements.add(effect.target)
            }

            return elements
        }

        function scaleLooksLikeMidReveal(transform: string): boolean
        {
            const match = transform.match(/matrix\(\s*([^)]+)\)/u)

            if (!match?.[1]) return false

            const parts = match[1].split(',').map(value => Number.parseFloat(value))
            const a = parts[0]
            const b = parts[1]
            const c = parts[2]
            const d = parts[3]

            if (a === undefined || b === undefined || c === undefined || d === undefined) return false

            const scaleX = Math.hypot(a, b)
            const scaleY = Math.hypot(c, d)
            const scale = Math.min(scaleX, scaleY)

            return Math.abs(scaleX - scaleY) < 0.08 && scale > 0.35 && scale < 0.94
        }

        function clipLooksLikeMidReveal(clip: string, elementHeight: number): boolean
        {
            const match = clip.match(/inset\(\s*([^)]+)\)/iu)

            if (!match?.[1]) return false

            const lengths: string[] = []

            for (const part of match[1].split(/[\s,]+/u)) {
                if (!part || part === 'round' || part === '/') break

                lengths.push(part)
            }

            if (lengths.length === 0) return false

            const pixels = lengths.map(value => value.endsWith('%')
                ? Number.parseFloat(value) / 100 * elementHeight
                : Number.parseFloat(value))
            const top = pixels[0] ?? 0
            const bottom = pixels.length >= 3 ? pixels[2] ?? 0 : top
            const vertical = Math.max(top, bottom ?? 0)

            return vertical > elementHeight * 0.08 && vertical < elementHeight * 0.92
        }
    })
}

/**
 * 讀取視窗內大型元素的幾何與遮罩狀態。GSAP／JS 驅動的 clip-path、
 * transform、opacity 不會出現在 document.getAnimations()，但會改這些值。
 *
 * @param page Playwright 頁面。
 * @returns 可供前後比較的版面摘要。
 */
async function readViewportLayoutState(page: import('playwright').Page): Promise<string>
{
    return page.evaluate(() => {
        const parts: string[] = []
        const decorative = new Set<HTMLElement>()

        for (const node of document.querySelectorAll<HTMLElement>('canvas, video')) decorative.add(node)

        for (const animation of document.getAnimations()) {
            if (animation.playState !== 'running') continue

            const effect = animation.effect

            if (!(effect instanceof KeyframeEffect)) continue
            if (effect.getComputedTiming().iterations !== Infinity) continue
            if (effect.target instanceof HTMLElement) decorative.add(effect.target)
        }

        for (const element of document.body.querySelectorAll<HTMLElement>('*')) {
            if (decorative.has(element)) continue

            const bounds = element.getBoundingClientRect()

            if (bounds.bottom <= 0 || bounds.top >= window.innerHeight) continue
            if (bounds.right <= 0 || bounds.left >= window.innerWidth) continue

            const style = getComputedStyle(element)
            const webkitMask = style.getPropertyValue('-webkit-mask-image')
            const masked = style.clipPath !== 'none'
                || (style.maskImage && style.maskImage !== 'none')
                || (webkitMask && webkitMask !== 'none')
            const opacity = Number(style.opacity)
            const area = bounds.width * bounds.height
            const minArea = (masked || (opacity > 0.04 && opacity < 0.96))
                ? window.innerWidth * window.innerHeight * 0.004
                : window.innerWidth * window.innerHeight * 0.02

            if (style.display === 'none' || style.visibility === 'hidden') continue
            if (area < minArea) continue

            parts.push([
                Math.round(bounds.x),
                Math.round(bounds.y),
                Math.round(bounds.width),
                Math.round(bounds.height),
                style.opacity,
                style.transform,
                style.clipPath,
                style.maskImage,
                webkitMask,
                style.maskPosition,
                style.getPropertyValue('-webkit-mask-position'),
            ].join(','))
        }

        return parts.join('|')
    })
}

/**
 * 將目前視窗縮成較高解析的 RGB 指紋，用來發現細條 wipe，而不是只看 32×18。
 *
 * @param image 目前視窗截圖。
 * @returns 固定長度的 RGB 像素資料。
 */
async function createSettleSignature(image: Buffer): Promise<Buffer>
{
    return sharp(image)
        .resize(SETTLE_SIGNATURE_WIDTH, SETTLE_SIGNATURE_HEIGHT, { fit: 'fill' })
        .removeAlpha()
        .raw()
        .toBuffer()
}

/**
 * 計算兩個同尺寸指紋中，單一直欄或橫列的最大平均差異。
 * 細的垂直或水平擦除條在全域平均裡會被稀釋，但會拉高單一欄／列。
 *
 * @param left 前一幀指紋。
 * @param right 目前指紋。
 * @param width 指紋寬度。
 * @param height 指紋高度。
 * @returns 介於 0 與 1 的最大欄或列差異。
 */
function maxStripDifference(left: Buffer, right: Buffer, width: number, height: number): number
{
    if (left.length !== right.length || left.length !== width * height * 3) return 1

    let maximum = 0

    for (let column = 0; column < width; column += 1) {
        let total = 0

        for (let row = 0; row < height; row += 1) {
            const index = (row * width + column) * 3

            total += Math.abs((left[index] ?? 0) - (right[index] ?? 0))
            total += Math.abs((left[index + 1] ?? 0) - (right[index + 1] ?? 0))
            total += Math.abs((left[index + 2] ?? 0) - (right[index + 2] ?? 0))
        }

        maximum = Math.max(maximum, total / height / 3 / 255)
    }

    for (let row = 0; row < height; row += 1) {
        let total = 0

        for (let column = 0; column < width; column += 1) {
            const index = (row * width + column) * 3

            total += Math.abs((left[index] ?? 0) - (right[index] ?? 0))
            total += Math.abs((left[index + 1] ?? 0) - (right[index + 1] ?? 0))
            total += Math.abs((left[index + 2] ?? 0) - (right[index + 2] ?? 0))
        }

        maximum = Math.max(maximum, total / width / 3 / 255)
    }

    return maximum
}

/**
 * 判斷指紋是否像照片上的垂直 wipe 白條。必須同時看整欄與水平帶：
 * 只打斷照片上半、底下仍是內容或白底的直條，整欄平均會被稀釋到門檻以下。
 * 頁面底的淡格線因鄰近欄也接近白色，不會被算進去。
 *
 * @param image 較高解析 RGB 指紋。
 * @param width 指紋寬度。
 * @param height 指紋高度。
 * @returns 整欄或任一水平帶出現至少三條疑似 wipe 直條時為 true。
 */
export function looksLikeVerticalWipe(image: Buffer, width: number, height: number): boolean
{
    if (image.length !== width * height * 3) return false
    if (looksLikeFullColumnWipe(image, width, height)) return true

    const bandHeight = Math.max(WIPE_BAND_MIN_ROWS, Math.round(height * WIPE_BAND_RATIO))
    const step = Math.max(2, Math.floor(bandHeight / 2))

    for (let start = 0; start + bandHeight <= height; start += step) {
        if (countWipeSpikesInBand(image, width, start, bandHeight) >= WIPE_BAR_MIN_COUNT) return true
    }

    return false
}

/**
 * 舊的整欄平均偵測：直條必須貫穿整段指紋高度才會過門檻。
 *
 * @param image 較高解析 RGB 指紋。
 * @param width 指紋寬度。
 * @param height 指紋高度。
 * @returns 整欄平均出現至少三條 wipe 尖峰時為 true。
 */
export function looksLikeFullColumnWipe(image: Buffer, width: number, height: number): boolean
{
    if (image.length !== width * height * 3) return false

    return countWipeSpikesInBand(image, width, 0, height) >= WIPE_BAR_MIN_COUNT
}

/**
 * 計算一段列範圍內、亮於左右鄰欄的直條數量。
 *
 * @param image RGB 指紋。
 * @param width 指紋寬度。
 * @param rowStart 列起點。
 * @param rowCount 列數。
 * @returns 符合亮度與鄰欄差的直條數。
 */
function countWipeSpikesInBand(image: Buffer, width: number, rowStart: number, rowCount: number): number
{
    if (rowCount <= 0) return 0

    const columnMean = new Float64Array(width)

    for (let column = 0; column < width; column += 1) {
        let total = 0

        for (let row = rowStart; row < rowStart + rowCount; row += 1) {
            const index = (row * width + column) * 3

            total += 0.299 * (image[index] ?? 0)
                + 0.587 * (image[index + 1] ?? 0)
                + 0.114 * (image[index + 2] ?? 0)
        }

        columnMean[column] = total / rowCount
    }

    const columnChroma = new Float64Array(width)

    for (let column = 0; column < width; column += 1) {
        let total = 0

        for (let row = rowStart; row < rowStart + rowCount; row += 1) {
            const index = (row * width + column) * 3
            const red = image[index] ?? 0
            const green = image[index + 1] ?? 0
            const blue = image[index + 2] ?? 0

            total += Math.max(red, green, blue) - Math.min(red, green, blue)
        }

        columnChroma[column] = total / rowCount
    }

    const neighborChroma = (column: number): number => columnChroma[column] ?? 0

    let spikes = 0

    for (let column = 2; column < width - 2; column += 1) {
        const left = ((columnMean[column - 2] ?? 0) + (columnMean[column - 1] ?? 0)) / 2
        const right = ((columnMean[column + 1] ?? 0) + (columnMean[column + 2] ?? 0)) / 2
        const neighborhood = (left + right) / 2
        const current = columnMean[column] ?? 0
        const leftFar = columnMean[column - 2] ?? 0
        const rightFar = columnMean[column + 2] ?? 0
        const leftChroma = neighborChroma(column - 2)
        const rightChroma = neighborChroma(column + 2)
        const classicInside = left > WIPE_BAR_CONTENT_MIN_LUMINANCE
            && left < WIPE_BAR_CONTENT_MAX_LUMINANCE
            && right > WIPE_BAR_CONTENT_MIN_LUMINANCE
            && right < WIPE_BAR_CONTENT_MAX_LUMINANCE
        const brightPhotoInside = leftFar > WIPE_BAR_CONTENT_MAX_LUMINANCE
            && leftFar < PHOTO_WIPE_LUMA
            && rightFar > WIPE_BAR_CONTENT_MAX_LUMINANCE
            && rightFar < PHOTO_WIPE_LUMA
            && leftChroma >= WIPE_NEIGHBOR_MIN_CHROMA
            && rightChroma >= WIPE_NEIGHBOR_MIN_CHROMA
        const darkPhotoInside = leftFar >= WIPE_NEIGHBOR_MIN_LUMA
            && leftFar <= WIPE_BAR_CONTENT_MIN_LUMINANCE
            && rightFar >= WIPE_NEIGHBOR_MIN_LUMA
            && rightFar <= WIPE_BAR_CONTENT_MIN_LUMINANCE
            && leftChroma >= WIPE_NEIGHBOR_MIN_CHROMA
            && rightChroma >= WIPE_NEIGHBOR_MIN_CHROMA
        const sitsInsideContent = classicInside || brightPhotoInside || darkPhotoInside

        if (
            sitsInsideContent
            && current > neighborhood + WIPE_BAR_NEIGHBOR_DELTA
            && current > WIPE_BAR_MIN_LUMINANCE
        ) {
            spikes += 1
        }
    }

    return spikes
}

/**
 * 簽名尺度上的淡化百葉窗欄數。12–16px 白條縮到 384 寬後，欄均
 * 常落在 165–200，settle 用的 200／+40 尖峰會漏掉。
 *
 * @param image RGB。
 * @param width 指紋寬度。
 * @returns 亮於左右鄰欄的淡化直條數。
 */
function countBlendedWipeColumns(image: Buffer, width: number): number
{
    return listBlendedWipeColumns(image, width).reduce((total, flag) => total + (flag ? 1 : 0), 0)
}

/**
 * 標出縮圖後仍比左右照片亮一截的直欄。奶油頁面左右一樣亮，不會
 * 被標；用來在比對時略過 wipe 欄，而不是只靠單像素 200 luma。
 *
 * @param image RGB。
 * @param width 指紋寬度。
 * @returns 每欄是否像淡化 wipe。
 */
function listBlendedWipeColumns(image: Buffer, width: number): boolean[]
{
    const flags = new Array<boolean>(Math.max(0, width)).fill(false)

    if (width < 5 || image.length < width * 3 || image.length % (width * 3) !== 0) return flags

    const height = Math.floor(image.length / (width * 3))

    if (height < 2) return flags

    const columnMean = new Float64Array(width)
    const columnChroma = new Float64Array(width)

    for (let column = 0; column < width; column += 1) {
        let lumaTotal = 0
        let chromaTotal = 0

        for (let row = 0; row < height; row += 1) {
            const index = (row * width + column) * 3
            const red = image[index] ?? 0
            const green = image[index + 1] ?? 0
            const blue = image[index + 2] ?? 0

            lumaTotal += 0.299 * red + 0.587 * green + 0.114 * blue
            chromaTotal += Math.max(red, green, blue) - Math.min(red, green, blue)
        }

        columnMean[column] = lumaTotal / height
        columnChroma[column] = chromaTotal / height
    }

    for (let column = 2; column < width - 2; column += 1) {
        const left = ((columnMean[column - 2] ?? 0) + (columnMean[column - 1] ?? 0)) / 2
        const right = ((columnMean[column + 1] ?? 0) + (columnMean[column + 2] ?? 0)) / 2
        const neighborhood = (left + right) / 2
        const current = columnMean[column] ?? 0
        const neighborContent = (
            left < PHOTO_BELT_PAGE_LUMA - 10
            && right < PHOTO_BELT_PAGE_LUMA - 10
        ) || (
            (columnChroma[column - 2] ?? 0) >= 16
            && (columnChroma[column + 2] ?? 0) >= 16
        )

        if (
            neighborContent
            && current > neighborhood + BLENDED_WIPE_NEIGHBOR_DELTA
            && current > BLENDED_WIPE_MIN_LUMINANCE
        ) {
            flags[column] = true
        }
    }

    return flags
}

/**
 * 合併淡化欄與「兩幀相減後的週期直條殘差」。密百葉窗縮到
 * 0.6px 時單幀尖峰會消失，但 wipe 對乾淨複本的差仍集中在直欄。
 *
 * @param left 上帶。
 * @param right 下帶。
 * @param width 指紋寬度。
 * @returns 要略過的欄；不夠三條則為 undefined。
 */
function mergePairWipeColumns(
    left: Buffer,
    right: Buffer,
    width: number,
): boolean[] | undefined
{
    const leftWipes = listBlendedWipeColumns(left, width)
    const rightWipes = listBlendedWipeColumns(right, width)
    const residual = listResidualWipeColumns(left, right, width)
    const rowBytes = width * 3
    const rows = Math.floor(left.length / rowBytes)
    const topRows = Math.max(4, Math.round(rows * 0.4))
    const topBytes = topRows * rowBytes
    const topResidual = rows >= 4 && left.length >= topBytes && right.length >= topBytes
        ? listResidualWipeColumns(
            left.subarray(0, topBytes),
            right.subarray(0, topBytes),
            width,
        )
        : residual
    const merged = leftWipes.map((flag, column) => (
        flag
        || rightWipes[column] === true
        || residual[column] === true
        || topResidual[column] === true
    ))
    const count = merged.reduce((total, flag) => total + (flag ? 1 : 0), 0)

    return count >= WIPE_BAR_MIN_COUNT ? merged : undefined
}

/**
 * 兩幀各欄平均差。中位數低、少數欄特別高，就是同一張照片上的
 * 直條殘差，不是兩張不同的卡。
 *
 * @param left 上帶。
 * @param right 下帶。
 * @param width 指紋寬度。
 * @returns 殘差尖峰欄。
 */
function listResidualWipeColumns(left: Buffer, right: Buffer, width: number): boolean[]
{
    const flags = new Array<boolean>(Math.max(0, width)).fill(false)

    if (width < 8 || left.length !== right.length || left.length < width * 3) return flags
    if (left.length % (width * 3) !== 0) return flags

    const height = Math.floor(left.length / (width * 3))
    const totals = new Float64Array(width)
    const counts = new Float64Array(width)

    for (let row = 0; row < height; row += 1) {
        for (let column = 0; column < width; column += 1) {
            const index = (row * width + column) * 3
            const leftLuma = 0.299 * (left[index] ?? 0)
                + 0.587 * (left[index + 1] ?? 0)
                + 0.114 * (left[index + 2] ?? 0)
            const rightLuma = 0.299 * (right[index] ?? 0)
                + 0.587 * (right[index + 1] ?? 0)
                + 0.114 * (right[index + 2] ?? 0)

            if (leftLuma > PHOTO_BELT_PAGE_LUMA && rightLuma > PHOTO_BELT_PAGE_LUMA) continue

            const difference = (
                Math.abs((left[index] ?? 0) - (right[index] ?? 0))
                + Math.abs((left[index + 1] ?? 0) - (right[index + 1] ?? 0))
                + Math.abs((left[index + 2] ?? 0) - (right[index + 2] ?? 0))
            ) / 3 / 255

            totals[column] = (totals[column] ?? 0) + difference
            counts[column] = (counts[column] ?? 0) + 1
        }
    }

    const values: number[] = []

    for (let column = 0; column < width; column += 1) {
        totals[column] = (counts[column] ?? 0) > 0 ? (totals[column] ?? 0) / (counts[column] ?? 1) : 0
        if ((counts[column] ?? 0) > height * 0.2) values.push(totals[column] ?? 0)
    }

    if (values.length < 8) return flags

    values.sort((leftValue, rightValue) => leftValue - rightValue)
    const median = values[Math.floor(values.length / 2)] ?? 0
    // 384 寬後 3–20px 白條只剩 0.6–4px，欄均殘差常落在 0.03–0.04；
    // 0.045 會把 live 上半寬條當成普通紋理。兩張不同照片的中位數
    // 本來就高，2.2×median 仍擋得住誤標。
    const spike = Math.max(PHOTO_RESIDUAL_SPIKE_FLOOR, median * 2.2)

    for (let column = 2; column < width - 2; column += 1) {
        const current = totals[column] ?? 0
        const neighborhood = ((totals[column - 2] ?? 0) + (totals[column + 2] ?? 0)) / 2

        if (current > spike && current > neighborhood + 0.015) flags[column] = true
    }

    return flags
}

function countResidualWipeColumns(left: Buffer, right: Buffer, width: number): number
{
    return listResidualWipeColumns(left, right, width).reduce((total, flag) => total + (flag ? 1 : 0), 0)
}

/**
 * card-scale 視窗常比 wipe 區還高：下緣已是乾淨照片或 CTA，整帶
 * 欄均會把上半百葉窗稀釋掉。上 40% 自己有直條／殘差就當成 wipe。
 *
 * @param upperSlice 上帶。
 * @param lowerSlice 下帶。
 * @param width 指紋寬度。
 * @returns 上帶（或它的上 40%）像 wipe 時為 true。
 */
function bandHasWipe(upperSlice: Buffer, lowerSlice: Buffer, width: number): boolean
{
    const rowBytes = width * 3
    const rows = Math.floor(upperSlice.length / rowBytes)

    if (width < 8 || rows < 4 || lowerSlice.length < rowBytes) return false

    if (countResidualWipeColumns(upperSlice, lowerSlice, width) >= WIPE_BAR_MIN_COUNT) {
        return true
    }

    const topRows = Math.max(4, Math.round(rows * 0.4))
    const topBytes = topRows * rowBytes
    const topUpper = upperSlice.subarray(0, Math.min(topBytes, upperSlice.length))
    const topLower = lowerSlice.subarray(0, Math.min(topBytes, lowerSlice.length))

    if (
        topUpper.length === topLower.length
        && countResidualWipeColumns(topUpper, topLower, width) >= WIPE_BAR_MIN_COUNT
    ) {
        return true
    }

    return looksLikeVerticalWipe(upperSlice, width, rows)
        || looksLikeVerticalWipe(topUpper, width, Math.floor(topUpper.length / rowBytes))
        || countBlendedWipeColumns(upperSlice, width) >= WIPE_BAR_MIN_COUNT
        || countBlendedWipeColumns(topUpper, width) >= WIPE_BAR_MIN_COUNT
}

type MediaBand = {
    bottom: number
    span?: number
    top: number
}

type RowIdentitySample = {
    height: number
    raw: Buffer
    width: number
}

type RepeatCutGate = {
    bands?: MediaBand[]
    origin?: number
    sample?: RowIdentitySample
}

/**
 * 讀取視窗裡不該從中間剖開的圖片、影片、畫布與橫向輪播。
 * 裁切若整段落在其中一個盒子裡，就不是整張複本，不能裁。
 *
 * @param page 已捲到此段的 Playwright 頁面。
 * @returns 視窗座標裡的保護帶。
 */
async function readUncroppedMediaBands(page: import('playwright').Page): Promise<MediaBand[]>
{
    return page.evaluate(() => {
        const bands: MediaBand[] = []

        const consider = (element: Element) => {
            let current: Element | null = element

            while (current && current !== document.body) {
                const style = getComputedStyle(current)

                if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) < 0.8) return

                current = current.parentElement
            }

            const bounds = element.getBoundingClientRect()

            if (bounds.width < 160 || bounds.height < 100) return
            if (bounds.bottom <= 0 || bounds.top >= window.innerHeight) return

            const top = Math.max(0, bounds.top)
            const bottom = Math.min(window.innerHeight, bounds.bottom)

            if (bottom - top < 80) return

            bands.push({ bottom, span: bounds.height, top })
        }

        for (const node of document.querySelectorAll('img, video, canvas, picture')) consider(node)

        for (const node of document.querySelectorAll<HTMLElement>('div, section, ul, ol')) {
            const style = getComputedStyle(node)
            const bounds = node.getBoundingClientRect()
            const scrolling = (style.overflowX === 'auto' || style.overflowX === 'scroll')
                && node.scrollWidth > node.clientWidth + 24
            const images = node.querySelectorAll('img, video')
            const row = images.length >= 2
                && bounds.height >= 120
                && bounds.height <= window.innerHeight * 0.95
                && bounds.width >= window.innerWidth * 0.6

            if (scrolling || row) consider(node)
        }

        return bands
    })
}

/**
 * 把視窗座標的保護帶換成區段座標。
 *
 * @param bands 視窗座標。
 * @param origin 區段頂端在視窗裡的 y。
 * @param height 區段高度。
 * @returns 落在區段內的保護帶。
 */
function viewportBandsToSegment(bands: MediaBand[], origin: number, height: number): MediaBand[]
{
    if (height <= 0) return []

    return bands.flatMap(band => {
        const top = Math.max(0, band.top - origin)
        const bottom = Math.min(height, band.bottom - origin)

        if (bottom - top < 24) return []

        return [{ bottom, top }]
    })
}

/**
 * 裁切是否從圖片或輪播盒子的內部挖掉一截。貼齊盒子邊緣的整段複本仍可裁。
 *
 * @param cutStart 裁切起點。
 * @param cutHeight 裁切高度。
 * @param bands 保護帶。
 * @param origin 裁切座標相對保護帶的位移。
 * @returns 裁切嚴格落在某個盒子內部時為 true。
 */
function cutSplitsMedia(
    cutStart: number,
    cutHeight: number,
    bands: MediaBand[] | undefined,
    origin = 0,
): boolean
{
    if (!bands || bands.length === 0 || cutHeight <= 0) return false

    const top = origin + cutStart
    const bottom = top + cutHeight

    return bands.some(band => top > band.top + 12 && bottom < band.bottom - 12)
}

/**
 * 裁掉中間一段之後，把保護帶的座標跟著往上移。
 *
 * @param bands 裁切前的保護帶。
 * @param cutStart 裁切起點。
 * @param cutHeight 裁切高度。
 * @returns 裁切後的保護帶。
 */
function shiftBandsAfterCut(bands: MediaBand[], cutStart: number, cutHeight: number): MediaBand[]
{
    const cutEnd = cutStart + cutHeight
    const next: MediaBand[] = []

    for (const band of bands) {
        if (band.bottom <= cutStart + 1) {
            next.push(band)
            continue
        }

        if (band.top >= cutEnd - 1) {
            next.push({ bottom: band.bottom - cutHeight, top: band.top - cutHeight })
            continue
        }

        if (band.top < cutStart) next.push({ bottom: cutStart, top: band.top })
        if (band.bottom > cutEnd) next.push({ bottom: band.bottom - cutHeight, top: cutStart })
    }

    return next.filter(band => band.bottom - band.top >= 24)
}

/**
 * 保留最近一個視窗高的已寫入畫面，用來辨認下一段是不是同一幀。
 *
 * @param previous 目前保留的尾端；第一段時為 null。
 * @param segment 剛寫入的區段。
 * @param width 頁面寬度。
 * @param viewportHeight 視窗高度。
 * @returns 不超過一個視窗高的尾端圖。
 */
async function rememberRecentScene(
    previous: Buffer | null,
    segment: Buffer,
    width: number,
    viewportHeight: number,
): Promise<Buffer>
{
    if (!previous) return segment

    const previousHeight = (await sharp(previous).metadata()).height ?? 0
    const segmentHeight = (await sharp(segment).metadata()).height ?? 0
    const combinedHeight = previousHeight + segmentHeight
    const combined = await sharp({
        create: {
            background: '#ffffff',
            channels: 3,
            height: combinedHeight,
            width,
        },
    })
        .composite([
            { input: previous, left: 0, top: 0 },
            { input: segment, left: 0, top: previousHeight },
        ])
        .png()
        .toBuffer()

    if (combinedHeight <= viewportHeight) return combined

    return sharp(combined)
        .extract({
            height: viewportHeight,
            left: 0,
            top: combinedHeight - viewportHeight,
            width,
        })
        .png()
        .toBuffer()
}

/**
 * 新區段開頭有多少列是已經留下的同一幀。整段都是近白，或非白列都能在
 * 最近畫面裡找到，就整段拿掉。否則只拿掉跟前一段尾端逐列對得上的前綴。
 * 飽和純色的預留高度回 0，那種畫面要留住。
 *
 * @param segment 這次準備接上的區段。
 * @param recent 最近已寫入的畫面。
 * @param width 頁面寬度。
 * @returns 應從區段頂端拿掉的像素高度。
 */
/**
 * 蓋滿視窗的 sticky 裡，目前真正看得見的文字與小圖。
 * 交叉淡化裡被壓到透明的那一層不算，避免兩個狀態疊在同一幀。
 */
export type StickySignature = {
    images: number
    texts: string
}

/**
 * 判斷這一幀的 sticky 內容跟上一幀保留的狀態是什麼關係。
 * 文字被換掉是新狀態；同一段文字又多了字或圖是同一塊的後續揭示。
 *
 * @param previous 上一張留下的簽名；還沒有時為 null。
 * @param next 目前視窗的簽名。
 * @returns empty 沒有可讀內容，drop-same 同一狀態，replace 同一塊更完整，keep 另一個狀態。
 */
export function relateStickySignatures(
    previous: StickySignature | null,
    next: StickySignature,
): 'drop-same' | 'empty' | 'keep' | 'replace'
{
    if (next.texts === '' && next.images === 0) return 'empty'
    if (!previous || (previous.texts === '' && previous.images === 0)) return 'keep'
    if (next.texts === previous.texts && next.images <= previous.images) return 'drop-same'

    const previousLines = previous.texts.split('\n').filter(line => line !== '')
    const nextLines = next.texts.split('\n').filter(line => line !== '')
    const nextLineSet = new Set(nextLines)
    const previousLineSet = new Set(previousLines)
    const previousContained = previousLines.every(line => nextLineSet.has(line))
    const nextContained = nextLines.every(line => previousLineSet.has(line))

    if (nextContained && next.images <= previous.images && (nextContained !== previousContained || next.texts === previous.texts)) {
        return 'drop-same'
    }

    if (previousContained && (next.texts.length > previous.texts.length || next.images > previous.images)) return 'replace'

    return 'keep'
}

/**
 * 讀取蓋住視窗的 sticky 裡，透明度夠高的文字與沒有鋪滿視窗的圖片數。
 *
 * @param page Playwright 頁面。
 * @returns 排序後的文字，以及可見圖片張數。
 */
async function readStickySignature(page: import('playwright').Page): Promise<StickySignature>
{
    return page.evaluate(() => {
        const pin = coveringSticky()

        if (!pin) return { images: 0, texts: '' }

        const texts = new Set<string>()
        const walker = document.createTreeWalker(pin, NodeFilter.SHOW_TEXT)
        let node = walker.nextNode()

        while (node) {
            const parent = node.parentElement

            if (parent && visuallyShown(parent)) {
                const value = node.textContent?.replace(/\s+/g, ' ').trim() ?? ''

                if (value.length >= 2) texts.add(value)
            }

            node = walker.nextNode()
        }

        let images = 0

        for (const element of pin.querySelectorAll<HTMLElement>('img, video, canvas')) {
            if (!visuallyShown(element)) continue

            const bounds = element.getBoundingClientRect()
            const area = bounds.width * bounds.height

            if (bounds.width < 10 || bounds.height < 10) continue
            if (bounds.bottom <= 0 || bounds.top >= window.innerHeight) continue
            if (area < 200 || area > window.innerWidth * window.innerHeight * 0.7) continue

            images += 1
        }

        return { images, texts: [...texts].sort().join('\n') }

        function coveringSticky(): HTMLElement | null
        {
            for (const element of document.body.querySelectorAll<HTMLElement>('*')) {
                const style = getComputedStyle(element)

                if (style.position !== 'sticky') continue
                if (style.visibility === 'hidden' || Number(style.opacity) < 0.2) continue

                const bounds = element.getBoundingClientRect()

                if (bounds.width < window.innerWidth * 0.85 || bounds.height < window.innerHeight * 0.85) continue
                if (bounds.top > window.innerHeight * 0.45) continue
                if (bounds.bottom < window.innerHeight * 0.7) continue

                return element
            }

            return null
        }

        function visuallyShown(element: HTMLElement): boolean
        {
            const bounds = element.getBoundingClientRect()

            if (bounds.bottom <= 4 || bounds.top >= window.innerHeight - 4) return false
            if (bounds.width <= 2 || bounds.height <= 2) return false

            let current: HTMLElement | null = element

            while (current && current !== document.body) {
                const style = getComputedStyle(current)

                if (style.display === 'none' || style.visibility === 'hidden') return false
                if (Number(style.opacity) < 0.8) return false

                const blur = style.filter.match(/blur\(\s*([0-9.]+)px\s*\)/iu)
                const amount = blur?.[1] ? Number.parseFloat(blur[1]) : 0

                if (amount > 1.2) return false

                current = current.parentElement
            }

            return true
        }
    })
}

/**
 * 從目前簽名往後看，停在同一塊內容最完整的那一幀。
 * 文字被換成另一句就停，避免把下一個專案或下一張卡吃進這一幀。
 *
 * @param page 停在擷取位置的頁面。
 * @param signature 這一幀已經看得見的簽名。
 * @param current 目前視窗截圖。
 * @returns 更完整的視窗，以及那一幀的簽名。
 */
async function captureRicherStickyFrame(
    page: import('playwright').Page,
    signature: StickySignature,
    current: Buffer,
): Promise<{ image: Buffer, signature: StickySignature }>
{
    const origin = await readDocumentScroll(page)
    let bestImage = current
    let bestSignature = signature
    let bestScore = stickySignatureScore(signature)

    for (let step = 1; step <= 10; step += 1) {
        const requested = origin + step * 220
        const landed = await scrollPageToAndHold(page, requested)

        if (landed < requested - 48) break
        if (!await stickyPinCoversViewport(page)) break

        await settleScrollScrubbedFrame(page)

        const next = await readStickySignature(page)
        const relation = relateStickySignatures(bestSignature, next)

        if (relation === 'keep') break

        const score = stickySignatureScore(next)

        if (score > bestScore) {
            bestScore = score
            bestSignature = next
            bestImage = await screenshotViewport(page, 'allow')
        }
    }

    await scrollPageToAndHold(page, origin)

    return { image: bestImage, signature: bestSignature }
}

/**
 * 文字愈長、可見小圖愈多，這塊揭示就愈完整。
 *
 * @param signature sticky 簽名。
 * @returns 用來比較前後幀的分數。
 */
function stickySignatureScore(signature: StickySignature): number
{
    return signature.texts.length + signature.images * 12
}

export async function stickyDuplicatePrefixLength(
    segment: Buffer,
    recent: Buffer,
    width: number,
): Promise<number>
{
    const segmentHeight = (await sharp(segment).metadata()).height ?? 0
    const recentHeight = (await sharp(recent).metadata()).height ?? 0

    if (segmentHeight < 24 || recentHeight < 24) return 0

    const sampleWidth = Math.min(64, width)
    const segmentRaw = await sharp(segment)
        .resize(sampleWidth, segmentHeight, { fit: 'fill' })
        .removeAlpha()
        .raw()
        .toBuffer()
    const recentRaw = await sharp(recent)
        .resize(sampleWidth, recentHeight, { fit: 'fill' })
        .removeAlpha()
        .raw()
        .toBuffer()
    const rowBytes = sampleWidth * 3
    const recentKeys = new Set<string>()
    let recentHasInk = false

    for (let row = 0; row < recentHeight; row += 1) {
        const slice = recentRaw.subarray(row * rowBytes, (row + 1) * rowBytes)

        if (!isNearWhiteRow(slice)) recentHasInk = true

        recentKeys.add(rowKey(slice))
    }

    if (!recentHasInk) return 0

    let inkRows = 0
    let matchedInk = 0
    let lumaTotal = 0
    let lumaSquares = 0

    for (let row = 0; row < segmentHeight; row += 1) {
        const slice = segmentRaw.subarray(row * rowBytes, (row + 1) * rowBytes)
        const luma = rowLuma(slice)

        lumaTotal += luma
        lumaSquares += luma * luma

        if (isNearWhiteRow(slice)) continue

        inkRows += 1
        if (recentKeys.has(rowKey(slice))) matchedInk += 1
    }

    const mean = lumaTotal / segmentHeight
    const variance = Math.sqrt(Math.max(0, lumaSquares / segmentHeight - mean * mean)) / 255

    if (variance < 0.02 && mean < 246) return 0
    if (variance < 0.02 || inkRows === 0 || matchedInk === inkRows) return segmentHeight

    let aligned = 0
    const limit = Math.min(segmentHeight, recentHeight)

    for (let length = 1; length <= limit; length += 1) {
        let same = true

        for (let row = 0; row < length; row += 1) {
            const nextSlice = segmentRaw.subarray(row * rowBytes, (row + 1) * rowBytes)
            const previousIndex = (recentHeight - length + row) * rowBytes
            const previousSlice = recentRaw.subarray(previousIndex, previousIndex + rowBytes)

            if (!rowsLookSame(nextSlice, previousSlice)) {
                same = false
                break
            }
        }

        if (!same) break

        aligned = length
    }

    return aligned >= 24 ? aligned : 0
}

/**
 * 量一段裡頭尾連續近白，以及中間還有沒有文字或圖片。
 * 蓋滿視窗的 sticky 常把標題夾在大片空白行程裡，那兩截不該留下。
 *
 * @param segment 區段 PNG。
 * @param width 頁面寬度。
 * @returns 頭尾近白列數，以及非白列數。
 */
export async function stickyBlankEdges(
    segment: Buffer,
    width: number,
): Promise<{ ink: number, lead: number, tail: number }>
{
    const height = (await sharp(segment).metadata()).height ?? 0

    if (height < 40) return { ink: 0, lead: 0, tail: 0 }

    const sampleWidth = Math.min(64, width)
    const raw = await sharp(segment)
        .resize(sampleWidth, height, { fit: 'fill' })
        .removeAlpha()
        .raw()
        .toBuffer()
    const rowBytes = sampleWidth * 3
    let lead = 0
    let tail = 0
    let ink = 0

    for (let row = 0; row < height; row += 1) {
        const slice = raw.subarray(row * rowBytes, (row + 1) * rowBytes)

        if (!isNearWhiteRow(slice)) break

        lead += 1
    }

    for (let row = height - 1; row >= lead; row -= 1) {
        const slice = raw.subarray(row * rowBytes, (row + 1) * rowBytes)

        if (!isNearWhiteRow(slice)) break

        tail += 1
    }

    for (let row = lead; row < height - tail; row += 1) {
        const slice = raw.subarray(row * rowBytes, (row + 1) * rowBytes)

        if (!isNearWhiteRow(slice)) ink += 1
    }

    return { ink, lead, tail }
}

/**
 * 一列是否近白。近白的 sticky 行程可以拿掉；飽和色列不行。
 *
 * @param slice 一列 RGB。
 * @returns 平均亮度很高時為 true。
 */
/**
 * 整幀 sticky 比文件行程多出來的高度，只從最長的純白縫收回。
 * 至少留下 24px，避免把刻意留白刪光。沒有夠長的純白縫就保持失敗。
 *
 * @param image 已拼接的頁面。
 * @param width 頁面寬度。
 * @param excess 高出文件的像素。
 * @param protectedBands 圖片與輪播盒子，純白縫若落在裡面就不砍。
 * @returns 收回後的頁面；收不回來時為 null。
 */
export async function absorbStrictWhiteOvershoot(
    image: Buffer,
    width: number,
    excess: number,
    protectedBands: MediaBand[] = [],
): Promise<Buffer | null>
{
    if (excess <= 0) return image

    const height = (await sharp(image).metadata()).height ?? 0

    if (height <= excess + 24) return null

    const sampleWidth = Math.min(64, width)
    const raw = await sharp(image)
        .resize(sampleWidth, height, { fit: 'fill' })
        .removeAlpha()
        .raw()
        .toBuffer()
    const rowBytes = sampleWidth * 3
    let bestStart = -1
    let bestLength = 0
    let runStart = 0
    let runLength = 0

    const blocked = (row: number): boolean => protectedBands.some(band => row >= band.top && row < band.bottom)

    const closeRun = (end: number): void => {
        if (runLength > bestLength && runLength >= excess + 24) {
            bestStart = runStart
            bestLength = runLength
        }

        runLength = 0
        runStart = end
    }

    for (let row = 0; row < height; row += 1) {
        const slice = raw.subarray(row * rowBytes, (row + 1) * rowBytes)
        const open = isNearWhiteRow(slice) && !blocked(row)

        if (open) {
            if (runLength === 0) runStart = row
            runLength += 1
        }
        else if (runLength > 0) closeRun(row)
    }

    if (runLength > 0) closeRun(height)

    if (bestStart < 0 || bestLength < excess + 24) return null

    const cutAt = bestStart + Math.floor((bestLength - excess) / 2)
    const head = await sharp(image).extract({ height: cutAt, left: 0, top: 0, width }).png().toBuffer()
    const tailHeight = height - (cutAt + excess)
    const tail = await sharp(image)
        .extract({ height: tailHeight, left: 0, top: cutAt + excess, width })
        .png()
        .toBuffer()

    return sharp({
        create: {
            background: '#ffffff',
            channels: 3,
            height: cutAt + tailHeight,
            width,
        },
    })
        .composite([
            { input: head, left: 0, top: 0 },
            { input: tail, left: 0, top: cutAt },
        ])
        .png()
        .toBuffer()
}

function isNearWhiteRow(slice: Buffer): boolean
{
    if (slice.length < 3) return true
    if (rowLuma(slice) < 246) return false

    let dark = 0
    let count = 0

    for (let index = 0; index < slice.length; index += 3) {
        const luma = (slice[index] ?? 0) * 0.3
            + (slice[index + 1] ?? 0) * 0.59
            + (slice[index + 2] ?? 0) * 0.11

        count += 1
        if (luma < 236) dark += 1
    }

    return count === 0 || dark / count < 0.015
}

/**
 * 一列的平均亮度。
 *
 * @param slice 一列 RGB。
 * @returns 0 到 255。
 */
function rowLuma(slice: Buffer): number
{
    if (slice.length < 3) return 255

    let total = 0
    let count = 0

    for (let index = 0; index < slice.length; index += 3) {
        total += (slice[index] ?? 0) * 0.3 + (slice[index + 1] ?? 0) * 0.59 + (slice[index + 2] ?? 0) * 0.11
        count += 1
    }

    return count > 0 ? total / count : 255
}

/**
 * 把一列量化成可比對的鍵。相鄰 2 階視為同一列，避免抗鋸齒差 1 就被當成新內容。
 *
 * @param slice 一列 RGB。
 * @returns 列鍵。
 */
function rowKey(slice: Buffer): string
{
    let key = ''

    for (let index = 0; index < slice.length; index += 1) {
        key += String.fromCharCode((slice[index] ?? 0) >> 2)
    }

    return key
}

/**
 * 兩列是否接近到可以當成同一幀。門檻對齊接縫檢查，避免差 1 階就被留下、
 * 最後又被接縫檢查判成重疊步進。
 *
 * @param left 第一列 RGB。
 * @param right 第二列 RGB。
 * @returns 平均通道差很小時為 true。
 */
function rowsLookSame(left: Buffer, right: Buffer): boolean
{
    const length = Math.min(left.length, right.length)

    if (length < 3) return false

    let total = 0

    for (let index = 0; index < length; index += 1) {
        total += Math.abs((left[index] ?? 0) - (right[index] ?? 0))
    }

    return total / length <= 4
}

/**
 * 做一份用來核對兩段是否像素相同的縮圖。寬度壓到 480，高度維持原像素列。
 *
 * @param image PNG。
 * @param width 原圖寬度。
 * @param height 原圖高度。
 * @returns 列對齊的 RGB 樣本。
 */
async function createRowIdentitySample(image: Buffer, width: number, height: number): Promise<RowIdentitySample>
{
    const sampleWidth = Math.min(480, width)
    const raw = await sharp(image)
        .resize(sampleWidth, height, { fit: 'fill' })
        .removeAlpha()
        .raw()
        .toBuffer()

    return { height, raw, width: sampleWidth }
}

/**
 * 兩段列是否為同一份像素。白條對照片的欄略過，其餘平均差必須近乎 0。
 *
 * @param sample 同一張圖的列樣本。
 * @param startA 第一段起點。
 * @param startB 第二段起點。
 * @param rows 列數。
 * @returns 近乎像素相同時為 true。
 */
function sampledRowsMatch(sample: RowIdentitySample, startA: number, startB: number, rows: number): boolean
{
    const rowCount = Math.min(rows, sample.height - startA, sample.height - startB)

    if (rowCount < 8 || startA < 0 || startB < 0) return false

    for (let delta = -4; delta <= 4; delta += 1) {
        const shifted = startB + delta

        if (shifted < 0 || shifted + rowCount > sample.height) continue
        if (rawRowsMatch(sample.raw, sample.raw, sample.width, startA, shifted, rowCount)) return true
    }

    return false
}

/**
 * 兩張圖各取一段列，確認是像素相同的複本，而不是縮圖上看起來接近。
 *
 * @param previous 前一段。
 * @param next 後一段。
 * @param width 寬度。
 * @param previousTop 前一段的列起點。
 * @param nextTop 後一段的列起點。
 * @param rows 列數。
 * @returns 近乎像素相同時為 true。
 */
async function rowsMatchAcross(
    previous: Buffer,
    next: Buffer,
    width: number,
    previousTop: number,
    nextTop: number,
    rows: number,
): Promise<boolean>
{
    if (rows < 8 || previousTop < 0 || nextTop < 0) return false

    const sampleWidth = Math.min(480, width)
    const left = await sharp(previous)
        .extract({ height: rows, left: 0, top: previousTop, width })
        .resize(sampleWidth, rows, { fit: 'fill' })
        .removeAlpha()
        .raw()
        .toBuffer()
    const right = await sharp(next)
        .extract({ height: rows, left: 0, top: nextTop, width })
        .resize(sampleWidth, rows, { fit: 'fill' })
        .removeAlpha()
        .raw()
        .toBuffer()

    return rawRowsMatch(left, right, sampleWidth, 0, 0, rows)
}

/**
 * 比對兩份 RGB 列。略過近白頁面與 wipe 白條對照片的像素。
 *
 * @param left 第一份 RGB。
 * @param right 第二份 RGB。
 * @param width 樣本寬度。
 * @param startA 第一份列起點。
 * @param startB 第二份列起點。
 * @param rows 列數。
 * @returns 平均通道差不超過文件流身份門檻時為 true。
 */
function rawRowsMatch(
    left: Buffer,
    right: Buffer,
    width: number,
    startA: number,
    startB: number,
    rows: number,
): boolean
{
    const rowBytes = width * 3
    const step = width > 240 ? 2 : 1
    let total = 0
    let count = 0

    for (let row = 0; row < rows; row += 1) {
        const leftRow = (startA + row) * rowBytes
        const rightRow = (startB + row) * rowBytes

        for (let column = 0; column < width; column += step) {
            const leftIndex = leftRow + column * 3
            const rightIndex = rightRow + column * 3
            const leftLuma = 0.299 * (left[leftIndex] ?? 0)
                + 0.587 * (left[leftIndex + 1] ?? 0)
                + 0.114 * (left[leftIndex + 2] ?? 0)
            const rightLuma = 0.299 * (right[rightIndex] ?? 0)
                + 0.587 * (right[rightIndex + 1] ?? 0)
                + 0.114 * (right[rightIndex + 2] ?? 0)
            const wipe = (leftLuma > PHOTO_WIPE_LUMA && rightLuma <= PHOTO_BELT_PAGE_LUMA)
                || (rightLuma > PHOTO_WIPE_LUMA && leftLuma <= PHOTO_BELT_PAGE_LUMA)

            if (wipe) continue
            if (leftLuma > PHOTO_BELT_PAGE_LUMA && rightLuma > PHOTO_BELT_PAGE_LUMA) continue

            total += Math.abs((left[leftIndex] ?? 0) - (right[rightIndex] ?? 0))
            total += Math.abs((left[leftIndex + 1] ?? 0) - (right[rightIndex + 1] ?? 0))
            total += Math.abs((left[leftIndex + 2] ?? 0) - (right[rightIndex + 2] ?? 0))
            count += 3
        }
    }

    const samples = rows * Math.ceil(width / step)

    if (count < samples * 0.25) return false

    return total / count / 255 <= DOCUMENT_ROW_IDENTITY
}

/**
 * 去掉後段開頭與前一段內容重複的捲動場景。sticky 面板停在視窗上方時，
 * 幾何裁切後仍會再寫入同一張照片。純色底不裁，以免把留白誤刪。後段幾乎
 * 整段都還是同一幕時視為預留高度的延續，不裁，以免滿 viewport 的 sticky
 * 場景被削短。
 *
 * @param previous 前一個已保留區段。
 * @param next 目前區段。
 * @param width 區段寬度。
 * @returns 去掉重複前綴後的區段；沒有重複則原樣返回；只剩同一張照片的
 * 邊角碎帶時為 null，呼叫端應略過該段。
 */
export async function trimDuplicateScenePrefix(
    previous: Buffer,
    next: Buffer,
    width: number,
    options: {
        bandOrigin?: number
        identicalRows?: boolean
        protectedBands?: MediaBand[]
    } = {},
): Promise<Buffer | null>
{
    const previousMeta = await sharp(previous).metadata()
    const nextMeta = await sharp(next).metadata()
    const previousHeight = previousMeta.height ?? 0
    const nextHeight = nextMeta.height ?? 0

    if (previousHeight < 40 || nextHeight < 40) return next

    const scale = SETTLE_SIGNATURE_WIDTH / width
    const previousRows = Math.max(1, Math.round(previousHeight * scale))
    const nextRows = Math.max(1, Math.round(nextHeight * scale))
    const previousSignature = await sharp(previous)
        .resize(SETTLE_SIGNATURE_WIDTH, previousRows, { fit: 'fill' })
        .removeAlpha()
        .raw()
        .toBuffer()
    const nextSignature = await sharp(next)
        .resize(SETTLE_SIGNATURE_WIDTH, nextRows, { fit: 'fill' })
        .removeAlpha()
        .raw()
        .toBuffer()
    const rowBytes = SETTLE_SIGNATURE_WIDTH * 3
    const windowRows = Math.min(8, previousRows, nextRows)
    let alignment = -1
    let matchedRows = 0

    for (let start = 0; start <= nextRows - windowRows; start += 1) {
        const slice = nextSignature.subarray(start * rowBytes, (start + windowRows) * rowBytes)

        if (rowSliceVariance(slice) < SCENE_TRIM_MIN_VARIANCE) break

        let foundAt = -1

        for (let previousStart = 0; previousStart <= previousRows - windowRows; previousStart += 1) {
            const previousSlice = previousSignature.subarray(previousStart * rowBytes, (previousStart + windowRows) * rowBytes)

            const wipeAware = looksLikeVerticalWipe(slice, SETTLE_SIGNATURE_WIDTH, windowRows)
                || looksLikeVerticalWipe(previousSlice, SETTLE_SIGNATURE_WIDTH, windowRows)
            const difference = wipeAware
                ? contentMaskedDifference(slice, previousSlice, SETTLE_SIGNATURE_WIDTH)
                : visualDifference(slice, previousSlice)

            if (difference <= SCENE_TRIM_THRESHOLD) {
                foundAt = previousStart
                break
            }
        }

        if (foundAt < 0) break

        const aligned = foundAt - start

        if (options.identicalRows) {
            if (alignment < 0) alignment = aligned
            else if (Math.abs(aligned - alignment) > 1) break
        }

        matchedRows = start + windowRows
    }

    const identicalPrefix = async (rows: number): Promise<boolean> => {
        if (!options.identicalRows) return true

        const trimPx = Math.round(rows / scale)
        const previousTop = Math.round(Math.max(0, alignment) / scale)

        return rowsMatchAcross(
            previous,
            next,
            width,
            previousTop,
            0,
            Math.min(trimPx, previousHeight - previousTop, nextHeight),
        )
    }

    if (nextRows > 0 && matchedRows / nextRows >= SCENE_TRIM_CONTINUE_RATIO) {
        if (options.identicalRows) {
            const identical = await identicalPrefix(matchedRows)
            const splitsMedia = cutSplitsMedia(0, nextHeight, options.protectedBands, options.bandOrigin ?? 0)

            if (!identical || splitsMedia) return next
        }

        return isVerticallyUniformScene(nextSignature, nextRows) ? next : null
    }

    const trimPx = Math.min(Math.round(matchedRows / scale), Math.floor(nextHeight * SCENE_TRIM_MAX_RATIO))

    if (trimPx <= 8 || trimPx >= nextHeight) return next

    if (options.identicalRows) {
        const identical = await identicalPrefix(matchedRows)

        if (!identical) return next
        if (cutSplitsMedia(0, trimPx, options.protectedBands, options.bandOrigin ?? 0)) return next
    }

    if (nextHeight - trimPx <= nextHeight * SCENE_TRIM_SCRAP_RATIO) return null

    return sharp(next)
        .extract({
            height: nextHeight - trimPx,
            left: 0,
            top: trimPx,
            width,
        })
        .toBuffer()
}

/**
 * 去掉同一區段底部與上方內容重複的照片帶。拼接或遮罩揭示常會把同一條
 * 照片再寫一次，形成底部五分之一的重複腰帶。
 *
 * @param image 已擷取區段。
 * @param width 區段寬度。
 * @returns 去掉重複尾帶後的區段；沒有重複則原樣返回。
 */
/**
 * 判斷區段是否上下幾乎同一種畫面。滿 viewport 的 sticky 色塊或直條紋
 * 是延續預留高度；上下內容不同的照片卡若整段重複則應丟掉。
 *
 * @param signature 區段縮圖 RGB。
 * @param rows 縮圖列數。
 * @returns 頂部與底部高細節帶很接近時為 true。
 */
function isVerticallyUniformScene(signature: Buffer, rows: number): boolean
{
    const rowBytes = SETTLE_SIGNATURE_WIDTH * 3
    const windowRows = Math.min(8, rows)

    if (windowRows < 4) return true

    const top = signature.subarray(0, windowRows * rowBytes)
    const bottom = signature.subarray((rows - windowRows) * rowBytes, rows * rowBytes)

    if (rowSliceVariance(top) < SCENE_TRIM_MIN_VARIANCE) return true

    return visualDifference(top, bottom) <= SCENE_TRIM_THRESHOLD * 2
}

export async function trimRepeatedTailBand(
    image: Buffer,
    width: number,
    options: {
        identicalRows?: boolean
        protectedBands?: MediaBand[]
        viewportTiles?: boolean
    } = {},
): Promise<Buffer>
{
    let current = image
    let removedViewportTile = false

    for (let pass = 0; pass < 3; pass += 1) {
        const beltOptions: {
            identicalRows?: boolean
            protectedBands?: MediaBand[]
            skipCardAndThick?: boolean
            viewportTiles?: boolean
        } = {
            skipCardAndThick: removedViewportTile,
        }

        if (options.identicalRows === true) beltOptions.identicalRows = true
        if (options.protectedBands) beltOptions.protectedBands = options.protectedBands
        if (options.viewportTiles === true) beltOptions.viewportTiles = true

        const outcome = await trimOnePhotoBelt(current, width, beltOptions)
        const before = (await sharp(current).metadata()).height ?? 0
        const after = (await sharp(outcome.image).metadata()).height ?? 0

        if (!outcome.cut || after >= before) return current

        if (options.protectedBands && outcome.cut) {
            const shifted = shiftBandsAfterCut(
                options.protectedBands,
                outcome.cut.cutStart,
                outcome.cut.cutHeight,
            )

            options.protectedBands.splice(0, options.protectedBands.length, ...shifted)
        }

        current = outcome.image
        if (before - after >= 800) removedViewportTile = true
    }

    return current
}

/**
 * 在一張圖裡找重複的照片卡或腰帶並裁掉。先在粗指紋上找接近整張
 * 卡的堆疊（上複本常帶 wipe），再找 1/5 級腰帶；12–20px 細帶改用
 * 約 2px／列的指紋，避免被鄰列糊掉。
 *
 * @param image PNG。
 * @param width 寬度。
 * @returns 裁掉一處重複後的圖；找不到則原樣返回。
 */
async function trimOnePhotoBelt(
    image: Buffer,
    width: number,
    options: {
        identicalRows?: boolean
        protectedBands?: MediaBand[]
        skipCardAndThick?: boolean
        viewportTiles?: boolean
    } = {},
): Promise<{ cut: { cutHeight: number, cutStart: number } | null, image: Buffer }>
{
    const metadata = await sharp(image).metadata()
    const height = metadata.height ?? 0

    if (height < 160) return { cut: null, image }

    const reference = Math.min(PHOTO_BELT_REFERENCE_HEIGHT, height)
    const coarseHeight = Math.max(16, Math.round(height * PHOTO_BELT_SIGNATURE_WIDTH / width))
    const coarse = await sharp(image)
        .resize(PHOTO_BELT_SIGNATURE_WIDTH, coarseHeight, { fit: 'fill' })
        .removeAlpha()
        .raw()
        .toBuffer()
    const rowBytes = PHOTO_BELT_SIGNATURE_WIDTH * 3
    const coarseContext = {
        height,
        reference,
        rowBytes,
        scale: height / coarseHeight,
        signature: coarse,
        signatureHeight: coarseHeight,
    }
    const gate: RepeatCutGate | undefined = options.identicalRows
        ? {
            origin: 0,
            sample: await createRowIdentitySample(image, width, height),
            ...(options.protectedBands ? { bands: options.protectedBands } : {}),
        }
        : undefined
    const tileCut = options.viewportTiles === true && options.skipCardAndThick !== true
        ? findViewportTileCut(coarseContext)
        : null

    if (tileCut) {
        return {
            cut: tileCut,
            image: await applyRepeatCut(image, width, height, tileCut),
        }
    }

    if (options.skipCardAndThick !== true) {
        const cardCut = height > PHOTO_BELT_REFERENCE_HEIGHT
            ? findRepeatCut(
                coarseContext,
                PHOTO_CARD_RATIOS.filter(ratio => options.viewportTiles === true || ratio < 0.95),
                true,
                gate,
            )
            : null
        const thickCut = cardCut ?? findRepeatCut(
            coarseContext,
            PHOTO_BELT_RATIOS.filter(ratio => ratio >= PHOTO_BELT_THICK_RATIO),
            false,
            gate,
        )

        if (thickCut) {
            return {
                cut: thickCut,
                image: await applyRepeatCut(image, width, height, thickCut),
            }
        }
    }

    const fineHeight = Math.max(coarseHeight, Math.round(height / PHOTO_BELT_FINE_PX))
    const fine = fineHeight === coarseHeight
        ? coarse
        : await sharp(image)
            .resize(PHOTO_BELT_SIGNATURE_WIDTH, fineHeight, { fit: 'fill' })
            .removeAlpha()
            .raw()
            .toBuffer()
    const fineContext = {
        height,
        reference,
        rowBytes,
        scale: height / fineHeight,
        signature: fine,
        signatureHeight: fineHeight,
    }
    const thinCut = findThinBelt1D(fineContext, undefined, gate)
        ?? findThinBelt1D(fineContext, { columnEnd: 32, columnStart: 0 }, gate)
        ?? findThinBelt1D(fineContext, { columnEnd: 64, columnStart: 32 }, gate)

    if (!thinCut) return { cut: null, image }

    return {
        cut: thinCut,
        image: await applyRepeatCut(image, width, height, thinCut),
    }
}

/**
 * 依指紋裁切座標從原圖拿掉一段。超出尾端時夾住高度，避免丢掉
 * 接在重複帶後面的下一張卡。
 *
 * @param image PNG。
 * @param width 寬度。
 * @param height 原圖高度。
 * @param cut 裁切起點與高度。
 * @returns 裁過的 PNG。
 */
async function applyRepeatCut(
    image: Buffer,
    width: number,
    height: number,
    cut: { cutHeight: number, cutStart: number },
): Promise<Buffer>
{
    const cutStart = cut.cutStart
    const cutHeight = Math.min(cut.cutHeight, height - cutStart)

    if (cutStart < 0 || cutHeight < PHOTO_BELT_MIN_CUT || cutStart >= height) return image

    const topHeight = cutStart
    const bottomHeight = height - cutStart - cutHeight

    if (topHeight <= 0) {
        if (bottomHeight <= 0) return image

        return sharp(image)
            .extract({ height: bottomHeight, left: 0, top: cutHeight, width })
            .png()
            .toBuffer()
    }

    const top = await sharp(image)
        .extract({ height: topHeight, left: 0, top: 0, width })
        .toBuffer()

    if (bottomHeight <= 0) return top

    const bottom = await sharp(image)
        .extract({
            height: bottomHeight,
            left: 0,
            top: cutStart + cutHeight,
            width,
        })
        .toBuffer()

    return sharp({
        create: {
            background: '#ffffff',
            channels: 3,
            height: topHeight + bottomHeight,
            width,
        },
    })
        .composite([
            { input: top, left: 0, top: 0 },
            { input: bottom, left: 0, top: topHeight },
        ])
        .png()
        .toBuffer()
}

type RepeatScanContext = {
    height: number
    reference: number
    rowBytes: number
    scale: number
    signature: Buffer
    signatureHeight: number
}

/**
 * 虛擬畫布成品常是整張 1080 視窗相疊，但前一刀若已切掉非整數視窗
 * （live 14040→13598），堆疊就不再落在 0／1080／2160。只比對齊磚會
 * 完全錯過 y3822 這種中段 wipe→乾淨，甚至先切到錯位混窗。改為滑動
 * 一個 viewport，並用左／右半幅比照片（該半幅必須真的是照片，不能
 * 只是奶油底上的 CTA），不要求整磚近白或一定掃到三條 wipe。
 *
 * @param context 粗指紋。
 * @returns 要裁掉的那一磚；找不到則為 null。
 */
function findViewportTileCut(
    context: RepeatScanContext,
): { cutHeight: number, cutStart: number } | null
{
    return scanViewportTiles(context, 'slide') ?? scanViewportTiles(context, 'aligned')
}

/**
 * 掃描相鄰 1080 視窗。先滑動再對齊：對齊磚若先踩到 4320 這種「wipe
 * 卡下半＋乾淨上半」，會整段留下 y3822 的百葉窗。slide 以約 20px
 * 步進，才能對上已被切過、不再對齊 viewport 的成品。
 *
 * @param context 粗指紋。
 * @param mode 對齊磚或滑動。
 * @returns 要裁掉的那一磚；找不到則為 null。
 */
function scanViewportTiles(
    context: RepeatScanContext,
    mode: 'aligned' | 'slide',
): { cutHeight: number, cutStart: number } | null
{
    const { height, reference, rowBytes, scale, signature, signatureHeight } = context
    const tileRows = Math.max(16, Math.round(reference / scale))

    if (signatureHeight < tileRows * 2) return null

    const step = mode === 'aligned' ? tileRows : 4
    const pairRows = Math.max(8, Math.round(tileRows * 0.62))
    const pairOffset = (tileRows - pairRows) * rowBytes
    let cutStart = -1
    let cutHeight = 0
    let cutDifference = 1
    let cutHadWipe = false
    let cutTopOccupancy = 0

    for (let upper = 0; upper + tileRows * 2 <= signatureHeight; upper += step) {
        const lower = upper + tileRows
        const upperSlice = signature.subarray(upper * rowBytes, (upper + tileRows) * rowBytes)
        const lowerSlice = signature.subarray(lower * rowBytes, (lower + tileRows) * rowBytes)

        if (contentPixelVariance(lowerSlice) < 0.04) continue
        if (interiorContentVariance(lowerSlice, rowBytes) < 0.025) continue

        const cheapPair = sampledContentDifference(
            upperSlice.subarray(pairOffset),
            lowerSlice.subarray(pairOffset),
            PHOTO_BELT_SIGNATURE_WIDTH,
        )
        const residualWipeCount = countResidualWipeColumns(
            upperSlice,
            lowerSlice,
            PHOTO_BELT_SIGNATURE_WIDTH,
        )

        if (cheapPair > VIEWPORT_TILE_THRESHOLD + 0.05 && residualWipeCount < WIPE_BAR_MIN_COUNT) {
            continue
        }

        const upperInterior = interiorContentVariance(upperSlice, rowBytes)
        const upperHasWipe = bandHasWipe(
            upperSlice,
            lowerSlice,
            PHOTO_BELT_SIGNATURE_WIDTH,
        ) || residualWipeCount >= WIPE_BAR_MIN_COUNT

        if (upperInterior < 0.025 && !upperHasWipe) continue

        const skipColumns = mergePairWipeColumns(
            upperSlice,
            lowerSlice,
            PHOTO_BELT_SIGNATURE_WIDTH,
        )
        const pairDifference = sceneBandDifference(
            upperSlice.subarray(pairOffset),
            lowerSlice.subarray(pairOffset),
            PHOTO_BELT_SIGNATURE_WIDTH,
            skipColumns,
        )
        const fullDifference = sceneBandDifference(
            upperSlice,
            lowerSlice,
            PHOTO_BELT_SIGNATURE_WIDTH,
            skipColumns,
        )
        const topRows = Math.max(8, Math.round(tileRows * 0.38))
        const topSlice = upperSlice.subarray(0, topRows * rowBytes)
        const topDifference = sceneBandDifference(
            topSlice,
            lowerSlice.subarray(0, topRows * rowBytes),
            PHOTO_BELT_SIGNATURE_WIDTH,
            skipColumns,
        )
        const topHasWipe = looksLikeVerticalWipe(
            topSlice,
            PHOTO_BELT_SIGNATURE_WIDTH,
            topRows,
        ) || countBlendedWipeColumns(topSlice, PHOTO_BELT_SIGNATURE_WIDTH) >= WIPE_BAR_MIN_COUNT
            || countResidualWipeColumns(
                topSlice,
                lowerSlice.subarray(0, topRows * rowBytes),
                PHOTO_BELT_SIGNATURE_WIDTH,
            ) >= WIPE_BAR_MIN_COUNT
        let bestDifference = Math.min(pairDifference, fullDifference)

        if (upperHasWipe && bestDifference > 0.02) {
            for (const shift of [-4, -2, 2, 4]) {
                const shiftedLower = lower + shift

                if (shiftedLower < 0 || shiftedLower + tileRows > signatureHeight) continue

                const shiftedSlice = signature.subarray(
                    shiftedLower * rowBytes,
                    (shiftedLower + tileRows) * rowBytes,
                )
                const shiftedDifference = sceneBandDifference(
                    upperSlice,
                    shiftedSlice,
                    PHOTO_BELT_SIGNATURE_WIDTH,
                    skipColumns,
                )

                if (shiftedDifference < bestDifference) bestDifference = shiftedDifference
            }
        }

        // 頂部必須也是同一張照片，否則滑動會切到錯位 100px 的奶油自比，
        // 或「上一張卡 + wipe」混窗。濃密百葉窗縮到 384 後，白條常被
        // 平均成 165–200；只有頂部 38% 自己有 wipe／殘差才改看下 62%，
        // 不可把整磚殘差套到混窗頂部（上一張右圖卡會被一起裁掉）。
        if (bestDifference > VIEWPORT_TILE_THRESHOLD) continue
        if (topDifference > VIEWPORT_TILE_THRESHOLD && !topHasWipe) continue
        if (topHasWipe && topLayoutMismatch(
            topSlice,
            lowerSlice.subarray(0, topRows * rowBytes),
            PHOTO_BELT_SIGNATURE_WIDTH,
        )) {
            continue
        }
        if (!upperHasWipe && bestDifference > 0.012) continue

        const candidateStart = Math.round(upper * scale)
        const candidateHeight = Math.min(
            Math.round(tileRows * scale),
            height - candidateStart,
        )

        const topOccupancy = Math.max(
            regionPhotoOccupancy(topSlice, PHOTO_BELT_SIGNATURE_WIDTH, 0, Math.floor(PHOTO_BELT_SIGNATURE_WIDTH / 2)),
            regionPhotoOccupancy(
                topSlice,
                PHOTO_BELT_SIGNATURE_WIDTH,
                Math.floor(PHOTO_BELT_SIGNATURE_WIDTH / 2),
                PHOTO_BELT_SIGNATURE_WIDTH,
            ),
        )
        const preferWipe = upperHasWipe && !cutHadWipe
        const betterDiff = bestDifference < cutDifference - 0.002
        const betterOccupancy = upperHasWipe
            && topOccupancy > cutTopOccupancy + 0.06
            && (cutStart < 0 || candidateStart <= cutStart + 80)
        const similarEarlier = Math.abs(bestDifference - cutDifference) <= 0.002
            && Math.abs(topOccupancy - cutTopOccupancy) <= 0.06
            && (cutStart < 0 || candidateStart < cutStart)

        if (preferWipe || betterDiff || betterOccupancy || similarEarlier || cutStart < 0) {
            cutDifference = bestDifference
            cutHadWipe = cutHadWipe || upperHasWipe
            cutTopOccupancy = topOccupancy
            cutStart = candidateStart
            cutHeight = candidateHeight
        }
    }

    if (cutStart < 0 || cutHeight < PHOTO_BELT_MIN_CUT) return null

    return {
        cutHeight,
        cutStart,
    }
}

/**
 * 整幅、左半、右半的遮罩差取最小。作品集卡照片只在一側，另一側近白
 * 會讓全幅差被留白稀釋或抬高；半幅才能對上 live 左圖／右圖。
 *
 * @param left 上帶。
 * @param right 下帶。
 * @param width 指紋寬度。
 * @returns 介於 0 與 1 的最小內容差。
 */
function sceneBandDifference(
    left: Buffer,
    right: Buffer,
    width: number,
    skipColumns?: boolean[],
): number
{
    const full = contentMaskedDifference(left, right, width, 0, 0, skipColumns)
    const half = Math.floor(width / 2)
    const leftHalf = contentMaskedDifference(left, right, width, 0, half, skipColumns)
    const rightHalf = contentMaskedDifference(left, right, width, half, width, skipColumns)
    let best = full

    if (regionHasPhoto(left, width, 0, half) && regionHasPhoto(right, width, 0, half) && leftHalf < best) {
        best = leftHalf
    }

    if (regionHasPhoto(left, width, half, width) && regionHasPhoto(right, width, half, width) && rightHalf < best) {
        best = rightHalf
    }

    return best
}

/**
 * 頂部主照片在哪一側必須一致。上一張右圖卡的褶衣若只剩頂部一截，
 * 右半會被當成照片、左半 festival 仍對得上；這種殘留不可整段拒裁。
 * 真正的混窗是左半奶油對左半照片（右圖卡對上左圖 wipe）。
 * 右圖褶衣殘留仍允許：左半 festival 對得上就好。
 *
 * @param upperTop 上磚頂部。
 * @param lowerTop 下磚頂部。
 * @param width 指紋寬度。
 * @returns 主照片側不一致時為 true。
 */
function topLayoutMismatch(upperTop: Buffer, lowerTop: Buffer, width: number): boolean
{
    const half = Math.floor(width / 2)
    const leftUpper = regionHasPhotoSide(upperTop, width, 0, half)
    const leftLower = regionHasPhotoSide(lowerTop, width, 0, half)
    const rightUpper = regionHasPhotoSide(upperTop, width, half, width)
    const rightLower = regionHasPhotoSide(lowerTop, width, half, width)

    // 左圖對左圖：上一張右圖褶衣殘留不可整段拒裁。
    if (leftUpper && leftLower) return false
    // 左半一邊奶油、一邊照片＝混窗（右圖卡對上左圖 wipe）。
    if (leftUpper !== leftLower) return true
    // 右圖對右圖（BRAKKA／gym）。
    if (rightUpper && rightLower) return false

    return rightUpper !== rightLower
}

/**
 * 半幅有照片或淡化 wipe 佔比。密百葉窗的白條 luma>230，regionHasPhoto
 * 會把它們當頁面；佔比仍要把 wipe 欄算進去，否則 wipe→乾淨會被當成混窗。
 *
 * @param slice RGB。
 * @param width 指紋寬度。
 * @param columnStart 欄起點。
 * @param columnEnd 欄終點。
 * @returns 該側像照片或 wipe 時為 true。
 */
function regionHasPhotoSide(
    slice: Buffer,
    width: number,
    columnStart: number,
    columnEnd: number,
): boolean
{
    return regionHasPhoto(slice, width, columnStart, columnEnd)
        || regionPhotoOccupancy(slice, width, columnStart, columnEnd) >= 0.25
}

/**
 * 半幅必須真的是照片細節。作品卡奶油側只剩 CTA／標題時，半幅差會
 * 接近 0，任何兩張卡都會被當成同一磚。
 *
 * @param slice RGB。
 * @param width 指紋寬度。
 * @param columnStart 欄起點。
 * @param columnEnd 欄終點。
 * @returns 該區有照片空間變異時為 true。
 */
function regionHasPhoto(slice: Buffer, width: number, columnStart: number, columnEnd: number): boolean
{
    if (width <= 0 || columnEnd <= columnStart || slice.length < width * 3) return false

    const rows = Math.floor(slice.length / (width * 3))
    const kept: number[] = []

    for (let row = 0; row < rows; row += 1) {
        for (let column = columnStart; column < columnEnd; column += 1) {
            const index = (row * width + column) * 3
            const luma = 0.299 * (slice[index] ?? 0)
                + 0.587 * (slice[index + 1] ?? 0)
                + 0.114 * (slice[index + 2] ?? 0)

            if (luma > PHOTO_BELT_PAGE_LUMA) continue

            kept.push(slice[index] ?? 0, slice[index + 1] ?? 0, slice[index + 2] ?? 0)
        }
    }

    const totalPixels = rows * (columnEnd - columnStart)

    if (kept.length < 24 || kept.length / 3 < totalPixels * 0.25) return false

    return contentPixelVariance(Buffer.from(kept)) >= 0.03
}

/**
 * 半幅非頁面像素比例。wipe 磚頂部應幾乎整側都是照片；若滑進上一張
 * 卡的奶油腳，佔比會掉一截，應改拿後面那扇對齊的窗。
 *
 * @param slice RGB。
 * @param width 指紋寬度。
 * @param columnStart 欄起點。
 * @param columnEnd 欄終點。
 * @returns 0 到 1。
 */
function regionPhotoOccupancy(
    slice: Buffer,
    width: number,
    columnStart: number,
    columnEnd: number,
): number
{
    if (width <= 0 || columnEnd <= columnStart || slice.length < width * 3) return 0

    const rows = Math.floor(slice.length / (width * 3))
    const totalPixels = rows * (columnEnd - columnStart)

    if (totalPixels <= 0) return 0

    const wipeColumns = listBlendedWipeColumns(slice, width)
    let content = 0

    for (let row = 0; row < rows; row += 1) {
        for (let column = columnStart; column < columnEnd; column += 1) {
            const index = (row * width + column) * 3
            const luma = 0.299 * (slice[index] ?? 0)
                + 0.587 * (slice[index + 1] ?? 0)
                + 0.114 * (slice[index + 2] ?? 0)

            if (luma <= PHOTO_BELT_PAGE_LUMA || wipeColumns[column] === true) content += 1
        }
    }

    return content / totalPixels
}

/**
 * 在指紋上找一處相鄰重複帶。cardScale 時視窗可以比實際週期大（上複本
 * 常帶 wipe、下緣還有 CTA／留白），因此 lower 上方只需放得下上複本，
 * 週期可小於視窗。拼接步進 80% 時 wipe 幀會疊在乾淨幀上，週期約
 * 432–864，同一個 1080 裁切裡同時看得到上半 wipe 與下半乾淨複本；
 * 這種短週期的 pair 窗會切到上一張褶衣殘留，必須用半幅比左圖，並認
 * 上帶上 40% 的 wipe／殘差。作品集中段上一張卡不必是近白；上複本有
 * wipe 時門檻放寬。接近一整個 viewport 的週期，只要配對夠近就裁，不
 * 要求一定偵測到 wipe。細帶則仍要求上方是另一段高細節照片。
 *
 * @param context 已縮好的長圖指紋。
 * @param ratios viewport 高度比例。
 * @param cardScale 是否以整張卡尺度掃描。
 * @returns 裁切起點與高度；找不到則為 null。
 */
function findRepeatCut(
    context: RepeatScanContext,
    ratios: number[],
    cardScale: boolean,
    gate?: RepeatCutGate,
): { cutHeight: number, cutStart: number } | null
{
    const { reference, rowBytes, scale, signature, signatureHeight } = context
    const alignRows = cardScale ? PHOTO_CARD_ALIGN_ROWS : PHOTO_BELT_ALIGN_ROWS
    let cutStart = -1
    let cutHeight = 0
    let cutDifference = 1
    let cutFromPage = false

    for (const ratio of ratios) {
        const bandPx = Math.max(cardScale ? 80 : 12, Math.round(reference * ratio))
        const periodRows = Math.max(cardScale ? 8 : 2, Math.round(bandPx / scale))
        const bandRows = cardScale
            ? Math.max(8, Math.round(periodRows * 0.62))
            : periodRows

        if (periodRows + bandRows + 1 > signatureHeight) continue

        const minimumLower = periodRows + 1
        const maximumLower = signatureHeight - bandRows
        const step = cardScale ? 4 : 3

        for (let lower = maximumLower; lower >= minimumLower; lower -= step) {
            const lowerSlice = signature.subarray(lower * rowBytes, (lower + bandRows) * rowBytes)

            if (isNearWhitePage(lowerSlice)) continue

            if (contentPixelVariance(lowerSlice) < (cardScale ? 0.05 : SCENE_TRIM_MIN_VARIANCE)) continue

            if (cardScale && interiorContentVariance(lowerSlice, rowBytes) < 0.03) continue

            if (
                (cardScale || bandRows >= 16)
                && verticalBandDifference(lowerSlice, rowBytes) <= (cardScale ? 0.04 : PHOTO_BELT_THRESHOLD)
            ) {
                continue
            }

            let bestUpper = -1
            let bestDifference = 1

            const pairRows = cardScale ? Math.max(8, Math.round(bandRows * 0.7)) : bandRows
            const pairOffset = (bandRows - pairRows) * rowBytes
            const lowerPair = lowerSlice.subarray(pairOffset)

            for (let offset = -alignRows; offset <= alignRows; offset += 1) {
                const upper = lower - periodRows + offset

                if (upper < 0) continue

                const upperSlice = signature.subarray(upper * rowBytes, (upper + bandRows) * rowBytes)
                const pairDifference = sampledContentDifference(
                    upperSlice.subarray(pairOffset),
                    lowerPair,
                    PHOTO_BELT_SIGNATURE_WIDTH,
                )

                if (pairDifference < bestDifference) {
                    bestDifference = pairDifference
                    bestUpper = upper
                }
            }

            if (bestUpper < 0) continue

            const upperSlice = signature.subarray(bestUpper * rowBytes, (bestUpper + bandRows) * rowBytes)
            const skipColumns = cardScale
                ? mergePairWipeColumns(upperSlice, lowerSlice, PHOTO_BELT_SIGNATURE_WIDTH)
                : undefined
            const pairWindow = upperSlice.subarray(pairOffset)
            const maskedPair = cardScale
                ? sceneBandDifference(
                    pairWindow,
                    lowerPair,
                    PHOTO_BELT_SIGNATURE_WIDTH,
                    skipColumns,
                )
                : contentMaskedDifference(
                    pairWindow,
                    lowerPair,
                    PHOTO_BELT_SIGNATURE_WIDTH,
                )
            const upperHasWipe = cardScale && bandHasWipe(
                upperSlice,
                lowerSlice,
                PHOTO_BELT_SIGNATURE_WIDTH,
            )
            const pairLimit = cardScale
                ? (upperHasWipe ? PHOTO_CARD_WIPE_THRESHOLD : 0.025)
                : (bandPx < PHOTO_BELT_THIN_PX ? PHOTO_BELT_THIN_THRESHOLD : PHOTO_BELT_THRESHOLD)

            if (maskedPair > pairLimit) continue

            if (cardScale) {
                const layoutRows = Math.max(6, Math.round(bandRows * 0.38))
                const layoutBytes = layoutRows * rowBytes

                if (topLayoutMismatch(
                    upperSlice.subarray(0, layoutBytes),
                    lowerSlice.subarray(0, layoutBytes),
                    PHOTO_BELT_SIGNATURE_WIDTH,
                )) {
                    continue
                }
            }

            if (
                cardScale
                && !upperHasWipe
                && interiorContentVariance(upperSlice, rowBytes) < 0.03
            ) {
                continue
            }

            const nothingAbove = bestUpper <= 0
            let aboveIsPage = false

            if (nothingAbove) {
                if (!(cardScale && upperHasWipe)) continue
            }
            else {
                const aboveStart = Math.max(0, bestUpper - bandRows)
                const aboveSlice = signature.subarray(aboveStart * rowBytes, bestUpper * rowBytes)
                const aboveRows = Math.floor(aboveSlice.length / rowBytes)

                if (aboveRows < Math.min(8, Math.max(4, Math.round(bandRows * 0.4)))) continue

                aboveIsPage = isNearWhitePage(aboveSlice)
                const aboveDifference = aboveSlice.length === upperSlice.length
                    ? contentMaskedDifference(
                        aboveSlice,
                        upperSlice,
                        PHOTO_BELT_SIGNATURE_WIDTH,
                    )
                    : 0

                if (cardScale && !aboveIsPage && !upperHasWipe) continue

                if (aboveIsPage && !cardScale) continue

                const aboveLimit = !cardScale && bandPx < PHOTO_BELT_THIN_PX
                    ? Math.max(0.03, maskedPair * 4)
                    : Math.max(PHOTO_BELT_ABOVE_DELTA, maskedPair * 4)

                if (!aboveIsPage && (aboveDifference === 0 || aboveDifference < aboveLimit)) {
                    continue
                }
            }

            const belowStart = lower + bandRows

            if (belowStart < signatureHeight) {
                const belowRows = Math.min(bandRows, signatureHeight - belowStart)
                const belowSlice = signature.subarray(
                    belowStart * rowBytes,
                    (belowStart + belowRows) * rowBytes,
                )
                const belowIsPage = isNearWhitePage(belowSlice)
                const belowDifference = contentMaskedDifference(
                    belowSlice,
                    lowerSlice,
                    PHOTO_BELT_SIGNATURE_WIDTH,
                )

                if (!belowIsPage && belowDifference < PHOTO_BELT_ABOVE_DELTA) continue
            }

            const matchedPeriod = Math.max(periodRows, lower - bestUpper)
            const candidateStart = Math.round((cardScale || upperHasWipe ? bestUpper : lower) * scale)
            const candidateHeight = Math.round(matchedPeriod * scale)
            const neighborStart = Math.round((cardScale || upperHasWipe ? lower : bestUpper) * scale)

            if (
                gate?.sample
                && !sampledRowsMatch(gate.sample, neighborStart, candidateStart, candidateHeight)
            ) {
                continue
            }

            if (cutSplitsMedia(candidateStart, candidateHeight, gate?.bands, gate?.origin ?? 0)) continue

            const betterPage = cardScale && aboveIsPage && !cutFromPage
            const worsePage = cardScale && cutFromPage && !aboveIsPage
            const betterDiff = maskedPair < cutDifference - 0.002
            const similarLarger = Math.abs(maskedPair - cutDifference) <= 0.002
                && candidateHeight > cutHeight
            const betterViewport = cardScale
                && candidateHeight >= reference * 0.85
                && cutHeight < reference * 0.7
                && maskedPair <= PHOTO_CARD_WIPE_THRESHOLD

            if (worsePage && !betterDiff && !betterViewport) continue

            if (betterPage || betterViewport || betterDiff || similarLarger || cutStart < 0) {
                cutDifference = maskedPair
                cutFromPage = aboveIsPage
                cutStart = candidateStart
                cutHeight = candidateHeight
            }

            if (cutDifference < 0.004 && (!cardScale || candidateHeight >= 200)) break
        }

        if (cutDifference < 0.004 && cutHeight >= (cardScale ? 200 : 12)) break
    }

    if (cutStart < 0 || cutHeight < PHOTO_BELT_MIN_CUT) return null

    if (cutStart >= context.height) return null

    return {
        cutHeight: Math.min(cutHeight, context.height - cutStart),
        cutStart,
    }
}

/**
 * 用一維列指紋找 12–36px 細帶。14k 長圖上若再做 2px／列的二維對齊
 * 掃描會跑數分鐘，列比對只要幾百萬次運算。暗照片腳帶若底下已是頁面
 * 留白，不再要求與上方 luma 差 ≥ 0.02，但上方探測區必須仍是有空間
 * 變異的照片，以免裁掉平面色塊。
 *
 * @param context 細指紋。
 * @returns 裁切起點與高度；找不到則為 null。
 */
function findThinBelt1D(
    context: RepeatScanContext,
    columns: { columnEnd: number, columnStart: number } = { columnEnd: 64, columnStart: 0 },
    gate?: RepeatCutGate,
): { cutHeight: number, cutStart: number } | null
{
    const { height, rowBytes, scale, signature, signatureHeight } = context
    const sampleColumns = 64
    const columnStart = Math.max(0, columns.columnStart)
    const columnEnd = Math.min(sampleColumns, columns.columnEnd)
    const usedColumns = columnEnd - columnStart
    const columnStep = Math.max(1, Math.floor(PHOTO_BELT_SIGNATURE_WIDTH / sampleColumns))
    const luma = new Float32Array(signatureHeight * sampleColumns)
    const content = new Uint8Array(signatureHeight)
    const minPairSamples = usedColumns < 40 ? 4 : 8

    for (let row = 0; row < signatureHeight; row += 1) {
        let contentCount = 0

        for (let column = columnStart; column < columnEnd; column += 1) {
            const index = row * rowBytes + column * columnStep * 3
            const value = 0.299 * (signature[index] ?? 0)
                + 0.587 * (signature[index + 1] ?? 0)
                + 0.114 * (signature[index + 2] ?? 0)

            luma[row * sampleColumns + column] = value
            if (value <= PHOTO_BELT_PAGE_LUMA) contentCount += 1
        }

        content[row] = contentCount > usedColumns * 0.15 ? 1 : 0
    }

    const rowDifference = (leftRow: number, rightRow: number): number => {
        let total = 0
        let count = 0

        for (let column = columnStart; column < columnEnd; column += 1) {
            const left = luma[leftRow * sampleColumns + column] ?? 0
            const right = luma[rightRow * sampleColumns + column] ?? 0

            if (left > PHOTO_BELT_PAGE_LUMA || right > PHOTO_BELT_PAGE_LUMA) continue

            total += Math.abs(left - right)
            count += 1
        }

        return count < minPairSamples ? 1 : total / count / 255
    }

    const windowDifference = (upper: number, lower: number, rows: number): number => {
        let total = 0

        for (let index = 0; index < rows; index += 1) {
            total += rowDifference(upper + index, lower + index)
        }

        return total / rows
    }

    let cutStart = -1
    let cutHeight = 0
    let cutDifference = 1

    for (let period = 6; period <= 20; period += 1) {
        const minimumLower = period * 2
        const maximumLower = signatureHeight - period

        for (let lower = maximumLower; lower >= minimumLower; lower -= 2) {
            if (!content[lower] || !content[lower - period]) continue

            const pairDifference = windowDifference(lower - period, lower, period)

            if (pairDifference > PHOTO_BELT_THIN_THRESHOLD) continue

            const aboveStart = Math.max(0, lower - period * 2)
            const aboveRows = lower - period - aboveStart

            if (aboveRows < 3) continue

            let aboveContent = 0

            for (let row = aboveStart; row < lower - period; row += 1) {
                aboveContent += content[row] ?? 0
            }

            if (aboveContent < 2) continue

            const aboveDifference = windowDifference(
                aboveStart,
                lower - period,
                Math.min(period, aboveRows),
            )

            const belowStart = lower + period
            let belowIsPage = belowStart >= signatureHeight

            if (belowStart < signatureHeight) {
                const belowRows = Math.min(period, signatureHeight - belowStart)
                let belowPage = 0

                for (let row = belowStart; row < belowStart + belowRows; row += 1) {
                    if (!content[row]) belowPage += 1
                }

                belowIsPage = belowPage >= belowRows * 0.5

                if (!belowIsPage) {
                    const belowDifference = windowDifference(lower, belowStart, belowRows)

                    if (belowDifference < PHOTO_BELT_ABOVE_DELTA) continue
                }
            }

            if (aboveDifference < 0.02) {
                if (!belowIsPage) continue

                // 暗腳帶與緊鄰的暗地板 1D luma 幾乎一樣；底下已是留白時
                // 仍可能是接縫複本。必須是近乎像素複本，且更上方仍是另一
                // 段照片，以免把一般照片底或平面綠卡連續切掉。
                const beltA = signature.subarray((lower - period) * rowBytes, lower * rowBytes)
                const beltB = signature.subarray(lower * rowBytes, (lower + period) * rowBytes)
                const farStart = Math.max(0, lower - period * 5)
                const farSlice = signature.subarray(farStart * rowBytes, (farStart + period) * rowBytes)
                const sigColumnStart = columnStart * columnStep
                const sigColumnEnd = columnEnd * columnStep
                const pairRgb = contentMaskedDifference(
                    beltA,
                    beltB,
                    PHOTO_BELT_SIGNATURE_WIDTH,
                    sigColumnStart,
                    sigColumnEnd,
                )
                const farRgb = contentMaskedDifference(
                    farSlice,
                    beltA,
                    PHOTO_BELT_SIGNATURE_WIDTH,
                    sigColumnStart,
                    sigColumnEnd,
                )

                if (pairRgb > 0.015 || farRgb < 0.08) continue
                if (contentPixelVariance(farSlice) < 0.03) continue
            }

            const candidateStart = Math.round(lower * scale)

            if (candidateStart < 8) continue

            const candidateHeight = Math.round(period * scale)
            const neighborStart = candidateStart - candidateHeight

            if (
                gate?.sample
                && !sampledRowsMatch(gate.sample, neighborStart, candidateStart, candidateHeight)
            ) {
                continue
            }

            if (cutSplitsMedia(candidateStart, candidateHeight, gate?.bands, gate?.origin ?? 0)) continue

            const betterDiff = pairDifference < cutDifference - 0.002
            const similarLarger = Math.abs(pairDifference - cutDifference) <= 0.002
                && candidateHeight > cutHeight

            if (betterDiff || similarLarger || cutStart < 0) {
                cutDifference = pairDifference
                cutStart = candidateStart
                cutHeight = candidateHeight
            }

            if (cutDifference < 0.004) break
        }

        if (cutDifference < 0.004 && cutHeight >= PHOTO_BELT_MIN_CUT) break
    }

    if (cutStart < 8 || cutHeight < PHOTO_BELT_MIN_CUT || cutStart >= height) return null

    return {
        cutHeight: Math.min(cutHeight, height - cutStart),
        cutStart,
    }
}

/**
 * 白條對照片：中等亮度、亮舞台、近頁面亮部或暗高彩都可以。只認
 * 45–175 時，嘉年華那種 175–230 亮照片上的百葉窗會被算成真差異。
 *
 * @param leftLuma 左側亮度。
 * @param rightLuma 右側亮度。
 * @returns 一側是 wipe 白、另一側是照片時為 true。
 */
function isWipeVersusPhoto(leftLuma: number, rightLuma: number): boolean
{
    const photoSide = (luma: number): boolean => (
        luma >= WIPE_NEIGHBOR_MIN_LUMA
        && luma < PHOTO_BELT_PAGE_LUMA
    )

    return (leftLuma > PHOTO_WIPE_LUMA && photoSide(rightLuma))
        || (rightLuma > PHOTO_WIPE_LUMA && photoSide(leftLuma))
}

function isSmearedWipeVersusPhoto(leftLuma: number, rightLuma: number): boolean
{
    if (isWipeVersusPhoto(leftLuma, rightLuma)) return true

    const photoSide = (luma: number): boolean => (
        luma >= WIPE_NEIGHBOR_MIN_LUMA
        && luma < PHOTO_BELT_PAGE_LUMA
    )
    const high = Math.max(leftLuma, rightLuma)
    const low = Math.min(leftLuma, rightLuma)

    return high >= BLENDED_WIPE_MIN_LUMINANCE
        && high - low >= BLENDED_WIPE_NEIGHBOR_DELTA
        && photoSide(low)
}

/**
 * 對齊用的便宜內容差。每隔幾個像素取樣、不排序，只用來找最佳
 * offset；通過後再用完整 `contentMaskedDifference` 把門檻。
 *
 * @param left 第一段。
 * @param right 第二段。
 * @param width 指紋寬度。
 * @returns 介於 0 與 1 的粗略內容差異。
 */
function sampledContentDifference(left: Buffer, right: Buffer, width: number): number
{
    if (left.length !== right.length || left.length < 3 || width <= 0) return 1

    let total = 0
    let count = 0
    let wipeSkipped = 0

    for (let index = 0; index < left.length; index += 12) {
        const leftLuma = 0.299 * (left[index] ?? 0)
            + 0.587 * (left[index + 1] ?? 0)
            + 0.114 * (left[index + 2] ?? 0)
        const rightLuma = 0.299 * (right[index] ?? 0)
            + 0.587 * (right[index + 1] ?? 0)
            + 0.114 * (right[index + 2] ?? 0)

        if (leftLuma > PHOTO_BELT_PAGE_LUMA || rightLuma > PHOTO_BELT_PAGE_LUMA) continue

        if (isSmearedWipeVersusPhoto(leftLuma, rightLuma)) {
            wipeSkipped += 1
            continue
        }

        total += (
            Math.abs((left[index] ?? 0) - (right[index] ?? 0))
            + Math.abs((left[index + 1] ?? 0) - (right[index + 1] ?? 0))
            + Math.abs((left[index + 2] ?? 0) - (right[index + 2] ?? 0))
        ) / 3
        count += 1
    }

    if (count < 12) return wipeSkipped >= 8 ? 0.04 : 1

    return total / count / 255
}

/**
 * 計算兩段 RGB 的差異，略過近白頁面與 wipe 白條對照片的像素，
 * 並丟掉最差的 15% 像素，以免單一 CTA 把近乎複製品抬高。
 *
 * @param left 第一段。
 * @param right 第二段。
 * @param width 指紋寬度；大於 0 時略過 wipe 欄。
 * @param columnStart 只比這欄之後（含）。
 * @param columnEnd 只比這欄之前。
 * @param skipColumns 簽名尺度上已標成淡化 wipe 的欄。
 * @returns 介於 0 與 1 的內容差異；內容太少時為 1。
 */
function contentMaskedDifference(
    left: Buffer,
    right: Buffer,
    width = 0,
    columnStart = 0,
    columnEnd = 0,
    skipColumns?: boolean[],
): number
{
    if (left.length !== right.length || left.length < 3) return 1

    if (width > 0 && left.length % (width * 3) !== 0) return 1

    const lastColumn = columnEnd > 0 ? columnEnd : width > 0 ? width : 0
    const differences: number[] = []
    let examined = 0
    let wipeSkipped = 0

    for (let index = 0; index < left.length; index += 3) {
        if (width > 0) {
            const column = (index / 3) % width

            if (column < columnStart || column >= lastColumn) continue

            if (skipColumns?.[column] === true) {
                examined += 1
                wipeSkipped += 1
                continue
            }
        }

        examined += 1
        const leftLuma = 0.299 * (left[index] ?? 0)
            + 0.587 * (left[index + 1] ?? 0)
            + 0.114 * (left[index + 2] ?? 0)
        const rightLuma = 0.299 * (right[index] ?? 0)
            + 0.587 * (right[index + 1] ?? 0)
            + 0.114 * (right[index + 2] ?? 0)

        if (leftLuma > PHOTO_BELT_PAGE_LUMA || rightLuma > PHOTO_BELT_PAGE_LUMA) continue

        if (isWipeVersusPhoto(leftLuma, rightLuma)) {
            wipeSkipped += 1
            continue
        }

        const pixel = (
            Math.abs((left[index] ?? 0) - (right[index] ?? 0))
            + Math.abs((left[index + 1] ?? 0) - (right[index + 1] ?? 0))
            + Math.abs((left[index + 2] ?? 0) - (right[index + 2] ?? 0))
        ) / 3

        differences.push(pixel)
    }

    const minSamples = Math.max(8, Math.floor(examined * 0.08))

    if (differences.length < minSamples) {
        if (wipeSkipped >= examined * 0.2 && differences.length >= 8) {
            // 百葉窗吃掉上半樣本；剩下的照片點仍可用。
        }
        else if (wipeSkipped >= examined * 0.25) {
            return 0.02
        }
        else {
            return 1
        }
    }

    differences.sort((leftValue, rightValue) => leftValue - rightValue)

    const kept = differences.slice(0, Math.max(1, Math.floor(differences.length * 0.85)))
    let total = 0

    for (const value of kept) total += value

    return total / kept.length / 255
}

/**
 * 只看視窗中段的內容變異。平面色塊加上上下邊緣時全幅變異會偏高，
 * 中段仍是單一顏色就不當照片卡。
 *
 * @param slice 帶的 RGB。
 * @param rowBytes 一列位元組數。
 * @returns 介於 0 與 1 的中段內容變異。
 */
function interiorContentVariance(slice: Buffer, rowBytes: number): number
{
    const rows = Math.floor(slice.length / rowBytes)

    if (rows < 8 || rowBytes < 3) return 0

    const top = Math.round(rows * 0.25)
    const bottom = Math.max(top + 4, Math.round(rows * 0.75))

    return contentPixelVariance(slice.subarray(top * rowBytes, bottom * rowBytes))
}

/**
 * 只有近白才算頁面留白。飽和品牌色也是低變異，但不能當成卡片上方的
 * 空白，否則兩段純色會被看成可裁的卡堆疊。
 *
 * @param slice RGB 列。
 * @returns 七成以上像素近白時為 true。
 */
function isNearWhitePage(slice: Buffer): boolean
{
    if (slice.length < 3) return false

    let white = 0
    const pixels = Math.floor(slice.length / 3)

    for (let index = 0; index < pixels * 3; index += 3) {
        const luma = 0.299 * (slice[index] ?? 0)
            + 0.587 * (slice[index + 1] ?? 0)
            + 0.114 * (slice[index + 2] ?? 0)

        if (luma > PHOTO_BELT_PAGE_LUMA) white += 1
    }

    return white / pixels >= 0.7
}

/**
 * 只看非留白像素的空間變異。平面色塊加上頁面白邊，全幅變異會偏高，
 * 但去掉近白之後就沒有照片細節。
 *
 * @param slice RGB 列。
 * @returns 介於 0 與 1 的內容變異。
 */
function contentPixelVariance(slice: Buffer): number
{
    const kept: number[] = []

    for (let index = 0; index < slice.length; index += 3) {
        const luma = 0.299 * (slice[index] ?? 0)
            + 0.587 * (slice[index + 1] ?? 0)
            + 0.114 * (slice[index + 2] ?? 0)

        if (luma > PHOTO_BELT_PAGE_LUMA) continue

        kept.push(slice[index] ?? 0, slice[index + 1] ?? 0, slice[index + 2] ?? 0)
    }

    if (kept.length < 24) return 0

    return rowSliceVariance(Buffer.from(kept))
}

/**
 * 腰帶本身必須上下有細節差，避免把一段均勻色塊從中間剖成兩條複製品。
 *
 * @param slice 帶的 RGB。
 * @param rowBytes 一列位元組數。
 * @returns 上半與下半的內容差異。
 */
function verticalBandDifference(slice: Buffer, rowBytes: number): number
{
    const rows = Math.floor(slice.length / rowBytes)

    if (rows < 4 || rowBytes < 3) return 0

    const half = Math.floor(rows / 2)
    const difference = contentMaskedDifference(
        slice.subarray(0, half * rowBytes),
        slice.subarray((rows - half) * rowBytes, rows * rowBytes),
    )

    return difference >= 1 ? 0 : difference
}

/**
 * 判斷兩個虛擬畫布視窗是否仍停在同一張釘住的場景。只比頂部高細節區：
 * 內容往上推的長畫布，後段頂部會對到前段中下部，不會被當成同一幕。
 *
 * @param previous 前一個已保留的完整視窗。
 * @param next 目前完整視窗。
 * @param width 區段寬度。
 * @returns 頂部高變異內容仍是同一幕時為 true。
 */
export async function isSamePinnedScene(previous: Buffer, next: Buffer, width: number): Promise<boolean>
{
    const previousMeta = await sharp(previous).metadata()
    const nextMeta = await sharp(next).metadata()
    const previousHeight = previousMeta.height ?? 0
    const nextHeight = nextMeta.height ?? 0

    if (previousHeight < 80 || nextHeight < 80) return false

    const scale = PHOTO_BELT_SIGNATURE_WIDTH / width
    const previousRows = Math.max(1, Math.round(previousHeight * scale))
    const nextRows = Math.max(1, Math.round(nextHeight * scale))
    const windowRows = Math.max(8, Math.round(Math.min(previousRows, nextRows) * PINNED_SCENE_ROWS_RATIO))

    if (windowRows > previousRows || windowRows > nextRows) return false

    const previousSignature = await sharp(previous)
        .resize(PHOTO_BELT_SIGNATURE_WIDTH, previousRows, { fit: 'fill' })
        .removeAlpha()
        .raw()
        .toBuffer()
    const nextSignature = await sharp(next)
        .resize(PHOTO_BELT_SIGNATURE_WIDTH, nextRows, { fit: 'fill' })
        .removeAlpha()
        .raw()
        .toBuffer()
    const rowBytes = PHOTO_BELT_SIGNATURE_WIDTH * 3
    const previousTop = previousSignature.subarray(0, windowRows * rowBytes)
    const nextTop = nextSignature.subarray(0, windowRows * rowBytes)

    if (rowSliceVariance(nextTop) < SCENE_TRIM_MIN_VARIANCE) return false

    const wipeAware = looksLikeVerticalWipe(previousTop, PHOTO_BELT_SIGNATURE_WIDTH, windowRows)
        || looksLikeVerticalWipe(nextTop, PHOTO_BELT_SIGNATURE_WIDTH, windowRows)
        || countBlendedWipeColumns(previousTop, PHOTO_BELT_SIGNATURE_WIDTH) >= WIPE_BAR_MIN_COUNT
        || countBlendedWipeColumns(nextTop, PHOTO_BELT_SIGNATURE_WIDTH) >= WIPE_BAR_MIN_COUNT
        || countResidualWipeColumns(previousTop, nextTop, PHOTO_BELT_SIGNATURE_WIDTH) >= WIPE_BAR_MIN_COUNT
    const masked = contentMaskedDifference(previousTop, nextTop, PHOTO_BELT_SIGNATURE_WIDTH)
    const visual = visualDifference(previousTop, nextTop)

    if (wipeAware) return masked <= PINNED_SCENE_THRESHOLD
    if (masked <= PINNED_MASKED_SAME_THRESHOLD && visual >= PINNED_SCENE_THRESHOLD) return true

    return visual <= PINNED_SCENE_THRESHOLD
}

/**
 * 計算一段 RGB 列資料的空間變異。必須以像素為單位，不能把單一飽和色的
 * R／G／B 通道差當成細節，否則純色區塊會被誤判成可裁的場景帶。
 *
 * @param slice 連續列的 RGB 資料。
 * @returns 介於 0 與 1 的平均空間變異。
 */
export function rowSliceVariance(slice: Buffer): number
{
    if (slice.length < 3) return 0

    const pixels = Math.floor(slice.length / 3)
    let meanRed = 0
    let meanGreen = 0
    let meanBlue = 0

    for (let index = 0; index < pixels * 3; index += 3) {
        meanRed += slice[index] ?? 0
        meanGreen += slice[index + 1] ?? 0
        meanBlue += slice[index + 2] ?? 0
    }

    meanRed /= pixels
    meanGreen /= pixels
    meanBlue /= pixels

    let total = 0

    for (let index = 0; index < pixels * 3; index += 3) {
        total += ((slice[index] ?? 0) - meanRed) ** 2
        total += ((slice[index + 1] ?? 0) - meanGreen) ** 2
        total += ((slice[index + 2] ?? 0) - meanBlue) ** 2
    }

    return Math.sqrt(total / (pixels * 3)) / 255
}

/**
 * 擷取目前視窗 PNG。重型機構頁在 settle 輪詢時會連續截圖並等待字型，
 * Playwright 預設 30 秒不夠，必須顯式拉長。
 *
 * @param page Playwright 頁面。
 * @param animations 截圖時是否凍結 CSS／Web Animation。
 * @returns 目前視窗的 PNG。
 */
async function screenshotViewport(
    page: import('playwright').Page,
    animations: 'allow' | 'disabled',
): Promise<Buffer>
{
    await parkPointer(page)
    await hideCustomCursorFollowers(page)
    await settleScrollScrubbedFrame(page)

    return page.screenshot({
        animations,
        fullPage: false,
        timeout: SCREENSHOT_TIMEOUT_MS,
        type: 'png',
    })
}

/**
 * 等待目前視窗內的圖片完成解碼；失敗的外部圖片交給畫面如實呈現，不阻塞工作。
 *
 * @param page Playwright 頁面。
 * @returns 圖片完成或等待時間用盡後結束。
 */
async function waitForVisibleImages(page: import('playwright').Page): Promise<void>
{
    await page.waitForFunction(
        () => [...document.images].filter(image => {
            const bounds = image.getBoundingClientRect()

            return bounds.bottom > 0 && bounds.top < window.innerHeight
        }).every(image => image.complete),
        undefined,
        { timeout: IMAGE_SETTLE_TIMEOUT_MS },
    ).catch(() => undefined)
}

/**
 * 從擷取頁面找出可排入後續工作的同站連結。
 *
 * @param pageUrl 目前頁面的最終網址。
 * @param candidates DOM 中找到的絕對連結。
 * @returns 已正規化、去重且排除危險流程的內頁網址。
 */
export function discoverInternalLinks(pageUrl: string, candidates: string[]): string[]
{
    const base = new URL(pageUrl)
    const results = new Set<string>()

    for (const candidate of candidates) {
        try {
            const normalized = normalizeUrl(candidate)
            const url = new URL(normalized)

            if (url.hostname !== base.hostname) continue
            if (EXCLUDED_PATH_PARTS.some(part => url.pathname.toLowerCase().includes(part))) continue
            if ([...url.searchParams.keys()].some(key => /session|token/i.test(key))) continue

            results.add(normalized)
        }
        catch {
            continue
        }
    }

    results.delete(normalizeUrl(pageUrl))

    return [...results].sort()
}

/**
 * 在 AI 分析尚未執行前，以網址與頁面文字提供可人工修正的初步內頁分類。
 *
 * @param pageUrl 頁面最終網址。
 * @param title 頁面標題。
 * @param text 頁面可見文字摘要。
 * @returns 第一版公共頁面類型。
 */
export function classifyPageType(pageUrl: string, title: string, text: string): PageTypeKey
{
    const url = new URL(pageUrl)
    const path = decodeURIComponent(url.pathname).toLocaleLowerCase()
    const segments = path.split('/').filter(Boolean)
    const pageSegments = /^[a-z]{2}(?:-[a-z]{2})?$/u.test(segments[0] ?? '')
        ? segments.slice(1)
        : segments
    const first = pageSegments[0]?.replace(/\.html?$/u, '') ?? ''
    const rest = pageSegments.slice(1)
    const inner = rest[0]?.replace(/\.html?$/u, '') ?? ''

    if (pageSegments.length === 0 || (pageSegments.length === 1 && first === 'index')) {
        const queryContent = [...url.searchParams.keys()].some(key => /^(?:lv\d+|page|section|tab)$/iu.test(key))

        return queryContent ? 'other' : 'home'
    }

    if (/^(?:career|careers|jobs?|recruit|採用|채용)$/u.test(first)) return 'careers'
    if (/^(?:contact|inquiry|문의|聯絡|聯繫)$/u.test(first)) return 'contact'
    if (/^(?:faq|frequently-asked-questions|常見問題)$/u.test(first)) return 'faq'
    if (/^(?:pricing|prices?|料金|價格|요금)$/u.test(first)) return 'pricing'
    if (/^(?:about|company|profile|關於|公司簡介|会社概要|기업소개|회사소개)$/u.test(first)) return 'about'
    if (/^(?:artists?|portfolio|projects?|cases?|works?|案例|実績|프로젝트|포트폴리오)$/u.test(first)) return 'case-study'
    if (/^(?:blog|journal|insights?|columns?)$/u.test(first)) return isContentDetail(rest) ? 'blog-detail' : 'blog-list'

    if (/^(?:news|press|notices?|最新消息|お知らせ|뉴스|보도)$/u.test(first)) {
        if (/^(?:faq|frequently-asked-questions)$/u.test(inner)) return 'faq'
        if (/^(?:blog|journal|insights?|columns?)$/u.test(inner)) return 'blog-list'

        return isContentDetail(rest) ? 'news-detail' : 'news-list'
    }
    if (/^(?:services?|products?|business|solutions?|服務|產品|事業|サービス|사업|서비스)$/u.test(first)) return 'product-service'

    const content = `${title} ${text.slice(0, 800)}`.toLocaleLowerCase()

    if (/career|careers|jobs|recruit|採用|채용/u.test(content)) return 'careers'
    if (/contact|inquiry|문의|聯絡|聯繫/u.test(content)) return 'contact'
    if (/faq|frequently|常見問題|よくある|자주 묻/u.test(content)) return 'faq'
    if (/pricing|price|料金|價格|요금/u.test(content)) return 'pricing'
    if (/about|company|profile|關於|公司簡介|会社概要|기업소개|회사소개/u.test(content)) return 'about'
    if (/portfolio|project|case|work|案例|実績|프로젝트|포트폴리오/u.test(content)) return 'case-study'
    if (/blog|journal|insight|column/u.test(content)) return 'blog-list'
    if (/news|press|notice|最新消息|お知らせ|뉴스|보도/u.test(content)) return 'news-list'
    if (/service|product|business|solution|服務|產品|事業|サービス|사업|서비스/u.test(content)) return 'product-service'

    return 'other'
}

/**
 * @param segments 列表根路徑後的網址片段。
 * @returns 路徑是否較可能指向單篇內容。
 */
function isContentDetail(segments: string[]): boolean
{
    if (segments.length === 0) return false

    const categoryNames = /^(?:index|list|archive|blog|press|updates?|category|categories)$/u

    return !categoryNames.test(segments[0]?.replace(/\.html?$/u, '') ?? '')
}
