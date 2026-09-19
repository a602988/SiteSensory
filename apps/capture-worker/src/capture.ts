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
const STICKY_CHROME_SIDE_MAX_PX = 80
const SCENE_TRIM_MAX_RATIO = 0.8
const SCENE_TRIM_CONTINUE_RATIO = 0.75
const SCENE_TRIM_SCRAP_RATIO = 0.35
const SCENE_TRIM_MIN_VARIANCE = 0.02
const SCENE_TRIM_THRESHOLD = 0.015
const PHOTO_CARD_RATIOS = [0.8, 0.7, 0.55, 0.4]
const PHOTO_BELT_RATIOS = [0.22, 0.19, 0.16, 0.13, 0.1, 0.06, 0.04, 0.02, 0.015, 0.012]
const PHOTO_BELT_THICK_RATIO = 0.1
const PHOTO_BELT_THRESHOLD = 0.012
const PHOTO_BELT_THIN_THRESHOLD = 0.02
const PHOTO_BELT_THIN_PX = 36
const PHOTO_CARD_WIPE_THRESHOLD = 0.04
const WIPE_NEIGHBOR_MIN_LUMA = 20
const WIPE_NEIGHBOR_MAX_LUMA = 195
const WIPE_NEIGHBOR_MIN_CHROMA = 22
const PHOTO_BELT_ABOVE_DELTA = 0.08
const PHOTO_BELT_ALIGN_ROWS = 8
const PHOTO_CARD_ALIGN_ROWS = 20
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
const WIPE_BAND_RATIO = 0.18
const WIPE_BAND_MIN_ROWS = 6
const VIEWPORT_WIPE_HOLD_SAMPLES = 12
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
            `,
        })
        await dismissBlockingOverlays(page)
        await preparePageForCapture(page)
        await dismissBlockingOverlays(page)
        await page.evaluate(async () => document.fonts.ready)

        const evidence = await page.evaluate(() => ({
            language: document.documentElement.lang || null,
            links: [...document.querySelectorAll('a[href]')].map(link => (link as HTMLAnchorElement).href),
            text: document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 20_000),
            title: document.title.trim(),
        }))

        if (isAccessInterstitial(evidence.title, evidence.text)) {
            throw new Error('目標網站回傳存取驗證頁，未取得可分析的網站內容')
        }

        const hero = await settleVisibleViewport(page)
        const viewportBuffer = hero.hasWipeArtifact
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

            window.scrollTo(0, next)

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
    await page.evaluate(() => window.scrollTo(0, 0))
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

    await markFixedElements(page)

    const segments: OverlayOptions[] = []
    const keptSegments: Buffer[] = []
    const hasVirtualCanvas = await detectsVirtualCanvas(page)
    const capturePositions = createCapturePositions(dimensions.height, dimensions.viewportHeight)
    let documentCoveredUntil = 0
    let outputHeight = 0
    let previousSignature: Buffer | null = null

    for (const target of capturePositions) {
        await page.evaluate(({ hideFixedAttribute, scrollTop }) => {
            document.documentElement.toggleAttribute(hideFixedAttribute, scrollTop > 0)
            window.scrollTo(0, scrollTop)
        }, { hideFixedAttribute: HIDE_FIXED_ATTRIBUTE, scrollTop: target })
        let settled = await settleVisibleViewport(page)

        if (settled.hasWipeArtifact) {
            const clean = await nudgeForCleanViewport(page, target)

            if (clean && hasVirtualCanvas) {
                settled = clean
            }
            else {
                continue
            }
        }

        let actualScroll = await page.evaluate(() => Math.round(window.scrollY))

        if (actualScroll > target) {
            await page.evaluate(scrollTop => window.scrollTo(0, scrollTop), target)
            await page.waitForTimeout(SCROLL_DELAY_MS)
            actualScroll = await page.evaluate(() => Math.round(window.scrollY))
        }

        if (actualScroll > target && actualScroll > documentCoveredUntil) {
            throw new Error(`網站將 ${target}px 的擷取位置改到 ${actualScroll}px，無法產生無缺口的完整頁面`)
        }

        const documentStart = hasVirtualCanvas ? actualScroll : Math.max(actualScroll, documentCoveredUntil)
        const documentEnd = Math.min(actualScroll + dimensions.viewportHeight, dimensions.height)
        const sourceTop = hasVirtualCanvas ? 0 : documentStart - actualScroll
        const segmentHeight = hasVirtualCanvas ? dimensions.viewportHeight : documentEnd - documentStart

        if (segmentHeight <= 0) {
            throw new Error(`無法擷取頁面 ${target}px 到 ${target + dimensions.viewportHeight}px 的區段`)
        }

        const viewport = settled.image
        let segment: Buffer | null = await sharp(viewport)
            .extract({
                height: segmentHeight,
                left: 0,
                top: sourceTop,
                width: dimensions.width,
            })
            .toBuffer()

        if (!hasVirtualCanvas) {
            const previous = keptSegments.at(-1)

            if (previous) {
                segment = await trimDuplicateScenePrefix(previous, segment, dimensions.width)
            }
        }

        if (segment && !hasVirtualCanvas) {
            segment = await trimRepeatedTailBand(segment, dimensions.width)
        }

        if (!segment) {
            documentCoveredUntil = Math.max(documentCoveredUntil, documentEnd)
            continue
        }

        const trimmedMeta = await sharp(segment).metadata()
        const keptHeight = trimmedMeta.height ?? 0

        if (keptHeight <= 0) {
            documentCoveredUntil = Math.max(documentCoveredUntil, documentEnd)
            continue
        }

        const signature = hasVirtualCanvas
            ? await createVisualSignature(segment)
            : null
        const previousKept = keptSegments.at(-1)

        if (
            signature
            && previousSignature
            && visualDifference(previousSignature, signature) <= VIRTUAL_CANVAS_DUPLICATE_THRESHOLD
        ) {
            continue
        }

        if (
            hasVirtualCanvas
            && previousKept
            && await isSamePinnedScene(previousKept, segment, dimensions.width)
        ) {
            continue
        }

        segments.push({ input: segment, left: 0, top: outputHeight })
        keptSegments.push(segment)
        outputHeight += keptHeight
        documentCoveredUntil = documentEnd
        previousSignature = signature
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
        || finalHeight !== dimensions.height
    ) {
        throw new Error('完整頁面合成後的尺寸與穩定頁面尺寸不一致')
    }

    return hasVirtualCanvas
        ? fullPage
        : trimRepeatedTailBand(fullPage, dimensions.width)
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
 * 判斷目前頁面是否以覆蓋大部分 viewport 的 fixed 元素呈現捲動內容。
 * 接近整段 viewport 的 sticky 區塊是文件流裡的捲動場景，要保留預留高度，
 * 不可當成可壓縮的虛擬畫布。
 *
 * @param page Playwright 頁面。
 * @returns 存在可見的虛擬捲動畫布時為 true。
 */
async function detectsVirtualCanvas(page: import('playwright').Page): Promise<boolean>
{
    return page.evaluate(canvasCoverageRatio => [...document.body.querySelectorAll<HTMLElement>('*')]
        .some(element => {
            const style = getComputedStyle(element)

            if (style.position !== 'fixed') return false
            if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false

            const bounds = element.getBoundingClientRect()

            return bounds.width >= window.innerWidth * canvasCoverageRatio
                && bounds.height >= window.innerHeight * canvasCoverageRatio
                && bounds.bottom > 0
                && bounds.top < window.innerHeight
        }), FIXED_CANVAS_COVERAGE_RATIO)
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
 * 標記頁首已存在的小型固定介面、頂部 sticky 導覽列，以及貼齊左右的
 * sticky 側欄，避免這些 chrome 在每段重複出現。覆蓋大部分 viewport 的
 * 固定畫布，與接近整段 viewport 高且接近全寬的 sticky 捲動場景不在此列。
 *
 * @param page Playwright 頁面。
 * @returns 完成 DOM 標記後結束。
 */
async function markFixedElements(page: import('playwright').Page): Promise<void>
{
    await page.evaluate(({
        attribute,
        canvasCoverageRatio,
        chromeMaxHeightRatio,
        chromeMinWidthRatio,
        chromeSideMaxPx,
        chromeTopMaxPx,
        sideMaxWidthRatio,
        sideMinHeightRatio,
    }) => {
        const elements = [...document.body.querySelectorAll<HTMLElement>('*')]

        for (const element of elements) {
            const style = getComputedStyle(element)
            const position = style.position

            if (position !== 'fixed' && position !== 'sticky') continue
            if (element.parentElement) {
                const parentPosition = getComputedStyle(element.parentElement).position

                if (parentPosition === 'fixed' || parentPosition === 'sticky') continue
            }

            const bounds = element.getBoundingClientRect()
            const coversViewport = bounds.width >= window.innerWidth * canvasCoverageRatio
                && bounds.height >= window.innerHeight * canvasCoverageRatio

            if (coversViewport) continue

            if (position === 'fixed') {
                element.setAttribute(attribute, '')
                continue
            }

            const top = Number.parseFloat(style.top)
            const left = Number.parseFloat(style.left)
            const right = Number.parseFloat(style.right)
            const inFirstViewport = bounds.bottom > 0 && bounds.top < window.innerHeight
            const isTopChrome = Number.isFinite(top)
                && top <= chromeTopMaxPx
                && bounds.height > 0
                && bounds.height < window.innerHeight * chromeMaxHeightRatio
                && bounds.width >= window.innerWidth * chromeMinWidthRatio
                && inFirstViewport
            const isSideChrome = inFirstViewport
                && bounds.width > 0
                && bounds.width < window.innerWidth * sideMaxWidthRatio
                && bounds.height >= window.innerHeight * sideMinHeightRatio
                && (
                    Number.isFinite(left) && left <= chromeSideMaxPx
                    || Number.isFinite(right) && right <= chromeSideMaxPx
                    || bounds.left <= 8
                    || bounds.right >= window.innerWidth - 8
                )

            if (isTopChrome || isSideChrome) element.setAttribute(attribute, '')
        }
    }, {
        attribute: FIXED_ELEMENT_ATTRIBUTE,
        canvasCoverageRatio: FIXED_CANVAS_COVERAGE_RATIO,
        chromeMaxHeightRatio: STICKY_CHROME_MAX_HEIGHT_RATIO,
        chromeMinWidthRatio: STICKY_CHROME_MIN_WIDTH_RATIO,
        chromeSideMaxPx: STICKY_CHROME_SIDE_MAX_PX,
        chromeTopMaxPx: STICKY_CHROME_TOP_MAX_PX,
        sideMaxWidthRatio: STICKY_SIDE_MAX_WIDTH_RATIO,
        sideMinHeightRatio: STICKY_SIDE_MIN_HEIGHT_RATIO,
    })
}

/**
 * 等到可見區域穩定；若仍像 wipe 殘影，再等一輪後決定要不要寫入。
 *
 * @param page 已捲到目標位置的 Playwright 頁面。
 * @returns 最後一張視窗截圖，以及是否仍偵測到 wipe 條紋。
 */
async function settleVisibleViewport(page: import('playwright').Page): Promise<{
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
 * 提早結束 settle，交給呼叫端微移或略過，不可把逾時垃圾寫進成品。
 * 不使用 prefers-reduced-motion。
 *
 * @param page 已捲到目標位置的 Playwright 頁面。
 * @returns 最後一張視窗截圖，以及該幀是否仍像 wipe。
 */
async function waitForVisibleViewportToSettle(page: import('playwright').Page): Promise<{
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
    let previousSignature: Buffer | null = null
    let previousLayout = ''
    let stableSamples = 0
    let wipeHoldSamples = 0
    let latest: Buffer | null = null
    let latestHasWipe = false

    while (Date.now() < deadline) {
        const hasCssMotion = await hasFiniteViewportAnimations(page)
        const layout = await readViewportLayoutState(page)
        const screenshot = await screenshotViewport(page, 'allow')
        const signature = await createSettleSignature(screenshot)
        const hasWipe = looksLikeVerticalWipe(signature, SETTLE_SIGNATURE_WIDTH, SETTLE_SIGNATURE_HEIGHT)
        const visuallyStable = Boolean(
            previousSignature
            && visualDifference(previousSignature, signature) <= VIEWPORT_SETTLE_THRESHOLD
            && maxStripDifference(
                previousSignature,
                signature,
                SETTLE_SIGNATURE_WIDTH,
                SETTLE_SIGNATURE_HEIGHT,
            ) <= VIEWPORT_SETTLE_STRIP_THRESHOLD,
        )
        const layoutStable = previousLayout !== '' && previousLayout === layout
        const motionStopped = !hasCssMotion && visuallyStable && layoutStable
        const pageLevelWipe = looksLikeFullColumnWipe(signature, SETTLE_SIGNATURE_WIDTH, SETTLE_SIGNATURE_HEIGHT)

        latest = screenshot
        latestHasWipe = hasWipe
        wipeHoldSamples = hasWipe && motionStopped ? wipeHoldSamples + 1 : 0
        const wipeLooksLikeDesign = pageLevelWipe && wipeHoldSamples >= VIEWPORT_WIPE_HOLD_SAMPLES
        const wipeLooksLocked = hasWipe && !pageLevelWipe && motionStopped
            && wipeHoldSamples >= VIEWPORT_LOCKED_WIPE_SAMPLES

        stableSamples = motionStopped && (!hasWipe || wipeLooksLikeDesign) ? stableSamples + 1 : 0
        previousSignature = signature
        previousLayout = layout

        if (wipeLooksLocked) {
            return { hasWipeArtifact: true, image: screenshot }
        }

        if (stableSamples >= VIEWPORT_SETTLE_STABLE_SAMPLES) {
            return { hasWipeArtifact: hasWipe && !wipeLooksLikeDesign, image: screenshot }
        }

        await page.waitForTimeout(VIEWPORT_SETTLE_POLL_MS)
    }

    if (!latest) latest = await screenshotViewport(page, 'allow')

    return { hasWipeArtifact: latestHasWipe, image: latest }
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
): Promise<{ hasWipeArtifact: boolean, image: Buffer } | null>
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

        await page.evaluate(scrollTop => window.scrollTo(0, scrollTop), nextTop)
        await page.waitForTimeout(NUDGE_PEEK_MS)
        await page.evaluate(() => new Promise<void>(resolve => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        }))

        const image = await screenshotViewport(page, 'allow')
        const signature = await createSettleSignature(image)

        if (!looksLikeVerticalWipe(signature, SETTLE_SIGNATURE_WIDTH, SETTLE_SIGNATURE_HEIGHT)) {
            return { hasWipeArtifact: false, image }
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
 * 讀取視窗內大型元素的幾何與遮罩狀態。GSAP／JS 驅動的 clip-path、
 * transform、opacity 不會出現在 document.getAnimations()，但會改這些值。
 *
 * @param page Playwright 頁面。
 * @returns 可供前後比較的版面摘要。
 */
async function readViewportLayoutState(page: import('playwright').Page): Promise<string>
{
    return page.evaluate(() => {
        const minArea = window.innerWidth * window.innerHeight * 0.02
        const parts: string[] = []

        for (const element of document.body.querySelectorAll<HTMLElement>('*')) {
            const bounds = element.getBoundingClientRect()

            if (bounds.width * bounds.height < minArea) continue
            if (bounds.bottom <= 0 || bounds.top >= window.innerHeight) continue
            if (bounds.right <= 0 || bounds.left >= window.innerWidth) continue

            const style = getComputedStyle(element)

            if (style.display === 'none' || style.visibility === 'hidden') continue

            parts.push([
                Math.round(bounds.x),
                Math.round(bounds.y),
                Math.round(bounds.width),
                Math.round(bounds.height),
                style.opacity,
                style.transform,
                style.clipPath,
                style.maskImage,
                style.getPropertyValue('-webkit-mask-image'),
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

    const neighborIsPhoto = (column: number): boolean => {
        const luma = columnMean[column] ?? 0
        const chroma = columnChroma[column] ?? 0

        if (luma >= PHOTO_WIPE_LUMA) return false
        if (luma > WIPE_BAR_CONTENT_MIN_LUMINANCE && luma < WIPE_NEIGHBOR_MAX_LUMA) return true

        return luma >= WIPE_NEIGHBOR_MIN_LUMA
            && luma <= WIPE_BAR_CONTENT_MIN_LUMINANCE
            && chroma >= WIPE_NEIGHBOR_MIN_CHROMA
    }

    let spikes = 0

    for (let column = 2; column < width - 2; column += 1) {
        const left = ((columnMean[column - 2] ?? 0) + (columnMean[column - 1] ?? 0)) / 2
        const right = ((columnMean[column + 1] ?? 0) + (columnMean[column + 2] ?? 0)) / 2
        const neighborhood = (left + right) / 2
        const current = columnMean[column] ?? 0
        const classicInside = left > WIPE_BAR_CONTENT_MIN_LUMINANCE
            && left < WIPE_BAR_CONTENT_MAX_LUMINANCE
            && right > WIPE_BAR_CONTENT_MIN_LUMINANCE
            && right < WIPE_BAR_CONTENT_MAX_LUMINANCE
        const photoInside = neighborIsPhoto(column - 2) && neighborIsPhoto(column + 2)
        const sitsInsideContent = classicInside || photoInside

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
export async function trimDuplicateScenePrefix(previous: Buffer, next: Buffer, width: number): Promise<Buffer | null>
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
    let matchedRows = 0

    for (let start = 0; start <= nextRows - windowRows; start += 1) {
        const slice = nextSignature.subarray(start * rowBytes, (start + windowRows) * rowBytes)

        if (rowSliceVariance(slice) < SCENE_TRIM_MIN_VARIANCE) break

        let found = false

        for (let previousStart = 0; previousStart <= previousRows - windowRows; previousStart += 1) {
            const previousSlice = previousSignature.subarray(previousStart * rowBytes, (previousStart + windowRows) * rowBytes)

            const wipeAware = looksLikeVerticalWipe(slice, SETTLE_SIGNATURE_WIDTH, windowRows)
                || looksLikeVerticalWipe(previousSlice, SETTLE_SIGNATURE_WIDTH, windowRows)
            const difference = wipeAware
                ? contentMaskedDifference(slice, previousSlice, SETTLE_SIGNATURE_WIDTH)
                : visualDifference(slice, previousSlice)

            if (difference <= SCENE_TRIM_THRESHOLD) {
                found = true
                break
            }
        }

        if (!found) break

        matchedRows = start + windowRows
    }

    if (nextRows > 0 && matchedRows / nextRows >= SCENE_TRIM_CONTINUE_RATIO) {
        return isVerticallyUniformScene(nextSignature, nextRows) ? next : null
    }

    const trimPx = Math.min(Math.round(matchedRows / scale), Math.floor(nextHeight * SCENE_TRIM_MAX_RATIO))

    if (trimPx <= 8 || trimPx >= nextHeight) return next

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

export async function trimRepeatedTailBand(image: Buffer, width: number): Promise<Buffer>
{
    let current = image

    for (let pass = 0; pass < 3; pass += 1) {
        const next = await trimOnePhotoBelt(current, width)
        const before = (await sharp(current).metadata()).height ?? 0
        const after = (await sharp(next).metadata()).height ?? 0

        if (after >= before) return current

        current = next
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
async function trimOnePhotoBelt(image: Buffer, width: number): Promise<Buffer>
{
    const metadata = await sharp(image).metadata()
    const height = metadata.height ?? 0

    if (height < 160) return image

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
    const cardCut = height > PHOTO_BELT_REFERENCE_HEIGHT
        ? findRepeatCut(coarseContext, PHOTO_CARD_RATIOS, true)
        : null
    const thickCut = cardCut ?? findRepeatCut(
        coarseContext,
        PHOTO_BELT_RATIOS.filter(ratio => ratio >= PHOTO_BELT_THICK_RATIO),
        false,
    )

    if (thickCut) return applyRepeatCut(image, width, height, thickCut)

    const fineHeight = Math.max(coarseHeight, Math.round(height / PHOTO_BELT_FINE_PX))
    const fine = fineHeight === coarseHeight
        ? coarse
        : await sharp(image)
            .resize(PHOTO_BELT_SIGNATURE_WIDTH, fineHeight, { fit: 'fill' })
            .removeAlpha()
            .raw()
            .toBuffer()
    const thinCut = findRepeatCut({
        height,
        reference,
        rowBytes,
        scale: height / fineHeight,
        signature: fine,
        signatureHeight: fineHeight,
    }, PHOTO_BELT_RATIOS.filter(ratio => ratio < PHOTO_BELT_THICK_RATIO), false)

    return thinCut ? applyRepeatCut(image, width, height, thinCut) : image
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

    if (cutStart < 8 || cutHeight < PHOTO_BELT_MIN_CUT || cutStart >= height) return image

    const topHeight = cutStart
    const bottomHeight = height - cutStart - cutHeight
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
 * 在指紋上找一處相鄰重複帶。cardScale 時視窗可以比實際週期大（上複本
 * 常帶 wipe、下緣還有 CTA／留白），因此 lower 上方只需放得下上複本，
 * 週期可小於視窗。作品集中段上一張卡不必是近白；上複本有 wipe 時門檻
 * 放寬。細帶則仍要求上方是另一段高細節照片。
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
        const bandRows = Math.max(cardScale ? 8 : 2, Math.round(bandPx / scale))

        if (bandRows * 2 + 1 > signatureHeight) continue

        const minimumLower = bandRows + 1
        const maximumLower = signatureHeight - bandRows
        const step = cardScale ? 3 : 2
        const minimumPeriod = cardScale
            ? Math.max(2, Math.ceil(bandRows * 0.75))
            : Math.max(2, bandRows - 2)

        for (let lower = maximumLower; lower >= minimumLower; lower -= step) {
            const lowerSlice = signature.subarray(lower * rowBytes, (lower + bandRows) * rowBytes)

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

            for (let offset = -alignRows; offset <= alignRows; offset += 1) {
                const upper = lower - bandRows + offset

                if (upper < 1 || lower - upper < minimumPeriod) continue

                const upperSlice = signature.subarray(upper * rowBytes, (upper + bandRows) * rowBytes)
                const pairRows = cardScale ? Math.max(8, Math.round(bandRows * 0.7)) : bandRows
                const pairOffset = (bandRows - pairRows) * rowBytes
                const pairDifference = contentMaskedDifference(
                    upperSlice.subarray(pairOffset),
                    lowerSlice.subarray(pairOffset),
                    PHOTO_BELT_SIGNATURE_WIDTH,
                )

                if (pairDifference < bestDifference) {
                    bestDifference = pairDifference
                    bestUpper = upper
                }
            }

            const upperSlice = signature.subarray(bestUpper * rowBytes, (bestUpper + bandRows) * rowBytes)
            const upperHasWipe = cardScale
                && looksLikeVerticalWipe(upperSlice, PHOTO_BELT_SIGNATURE_WIDTH, bandRows)
            const pairLimit = cardScale
                ? (upperHasWipe ? PHOTO_CARD_WIPE_THRESHOLD : 0.025)
                : (bandPx < PHOTO_BELT_THIN_PX ? PHOTO_BELT_THIN_THRESHOLD : PHOTO_BELT_THRESHOLD)

            if (bestUpper < 1 || bestDifference > pairLimit) continue

            const aboveStart = Math.max(0, bestUpper - bandRows)
            const aboveSlice = signature.subarray(aboveStart * rowBytes, bestUpper * rowBytes)
            const aboveIsPage = isNearWhitePage(aboveSlice)
            const aboveDifference = contentMaskedDifference(
                aboveSlice,
                upperSlice,
                PHOTO_BELT_SIGNATURE_WIDTH,
            )

            if (aboveIsPage && !cardScale) continue

            const aboveLimit = !cardScale && bandPx < PHOTO_BELT_THIN_PX
                ? Math.max(0.03, bestDifference * 4)
                : Math.max(PHOTO_BELT_ABOVE_DELTA, bestDifference * 4)

            if (!aboveIsPage && aboveDifference < aboveLimit) {
                continue
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

            const periodRows = Math.max(bandRows, lower - bestUpper)
            const candidateStart = Math.round((cardScale || upperHasWipe ? bestUpper : lower) * scale)
            const candidateHeight = Math.round(periodRows * scale)
            const betterPage = cardScale && aboveIsPage && !cutFromPage
            const worsePage = cardScale && cutFromPage && !aboveIsPage
            const betterDiff = bestDifference < cutDifference - 0.002
            const similarLarger = Math.abs(bestDifference - cutDifference) <= 0.002
                && candidateHeight > cutHeight

            if (worsePage && !betterDiff) continue

            if (betterPage || betterDiff || similarLarger || cutStart < 0) {
                cutDifference = bestDifference
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
 * 計算兩段 RGB 的差異，略過近白頁面與 wipe 白條對照片的像素，
 * 並丟掉最差的 15% 像素，以免單一 CTA 把近乎複製品抬高。
 *
 * @param left 第一段。
 * @param right 第二段。
 * @param width 指紋寬度；大於 0 時略過 wipe 欄。
 * @returns 介於 0 與 1 的內容差異；內容太少時為 1。
 */
function contentMaskedDifference(left: Buffer, right: Buffer, width = 0): number
{
    if (left.length !== right.length || left.length < 3) return 1

    if (width > 0 && left.length % (width * 3) !== 0) return 1

    const differences: number[] = []

    for (let index = 0; index < left.length; index += 3) {
        const leftLuma = 0.299 * (left[index] ?? 0)
            + 0.587 * (left[index + 1] ?? 0)
            + 0.114 * (left[index + 2] ?? 0)
        const rightLuma = 0.299 * (right[index] ?? 0)
            + 0.587 * (right[index + 1] ?? 0)
            + 0.114 * (right[index + 2] ?? 0)

        if (leftLuma > PHOTO_BELT_PAGE_LUMA || rightLuma > PHOTO_BELT_PAGE_LUMA) continue

        const wipeVsPhoto = (
            leftLuma > PHOTO_WIPE_LUMA
            && rightLuma > WIPE_BAR_CONTENT_MIN_LUMINANCE
            && rightLuma < WIPE_BAR_CONTENT_MAX_LUMINANCE
        ) || (
            rightLuma > PHOTO_WIPE_LUMA
            && leftLuma > WIPE_BAR_CONTENT_MIN_LUMINANCE
            && leftLuma < WIPE_BAR_CONTENT_MAX_LUMINANCE
        )

        if (wipeVsPhoto) continue

        const pixel = (
            Math.abs((left[index] ?? 0) - (right[index] ?? 0))
            + Math.abs((left[index + 1] ?? 0) - (right[index + 1] ?? 0))
            + Math.abs((left[index + 2] ?? 0) - (right[index + 2] ?? 0))
        ) / 3

        differences.push(pixel)
    }

    if (differences.length < left.length / 3 * 0.08) return 1

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

    const scale = SETTLE_SIGNATURE_WIDTH / width
    const previousRows = Math.max(1, Math.round(previousHeight * scale))
    const nextRows = Math.max(1, Math.round(nextHeight * scale))
    const windowRows = Math.max(8, Math.round(Math.min(previousRows, nextRows) * PINNED_SCENE_ROWS_RATIO))

    if (windowRows > previousRows || windowRows > nextRows) return false

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
    const previousTop = previousSignature.subarray(0, windowRows * rowBytes)
    const nextTop = nextSignature.subarray(0, windowRows * rowBytes)

    if (rowSliceVariance(nextTop) < SCENE_TRIM_MIN_VARIANCE) return false

    return visualDifference(previousTop, nextTop) <= PINNED_SCENE_THRESHOLD
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
