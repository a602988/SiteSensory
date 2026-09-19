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
const OVERLAY_SETTLE_MS = 250
const SIGNATURE_HEIGHT = 18
const SIGNATURE_WIDTH = 32
const VIRTUAL_CANVAS_DUPLICATE_THRESHOLD = 0.015
const VIEWPORT_SETTLE_TIMEOUT_MS = 12_000
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

        await waitForVisibleViewportToSettle(page)
        const viewportBuffer = await screenshotViewport(page, 'disabled')
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
        await waitForVisibleViewportToSettle(page)

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

        const viewport = await screenshotViewport(page, 'disabled')
        const segment = await sharp(viewport)
            .extract({
                height: segmentHeight,
                left: 0,
                top: sourceTop,
                width: dimensions.width,
            })
            .toBuffer()
        const signature = hasVirtualCanvas
            ? await createVisualSignature(segment)
            : null

        if (
            signature
            && previousSignature
            && visualDifference(previousSignature, signature) <= VIRTUAL_CANVAS_DUPLICATE_THRESHOLD
        ) {
            continue
        }

        segments.push({ input: segment, left: 0, top: outputHeight })
        outputHeight += segmentHeight
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

    return fullPage
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
 * 判斷目前頁面是否以覆蓋大部分 viewport 的 fixed 或 sticky 元素呈現捲動內容。
 *
 * @param page Playwright 頁面。
 * @returns 存在可見的虛擬捲動畫布時為 true。
 */
async function detectsVirtualCanvas(page: import('playwright').Page): Promise<boolean>
{
    return page.evaluate(canvasCoverageRatio => [...document.body.querySelectorAll<HTMLElement>('*')]
        .some(element => {
            const style = getComputedStyle(element)

            if (style.position !== 'fixed' && style.position !== 'sticky') return false
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
 * 標記頁首已存在的小型固定介面，以及已出現在首屏的頂部 sticky 導覽列，
 * 避免導覽列、聊天按鈕等元素在每段重複出現。覆蓋大部分 viewport 的固定畫布，
 * 與接近整段 viewport 高的 sticky 捲動場景不在此列。
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
        chromeTopMaxPx,
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
            const inFirstViewport = bounds.bottom > 0 && bounds.top < window.innerHeight
            const isTopChrome = Number.isFinite(top)
                && top <= chromeTopMaxPx
                && bounds.height > 0
                && bounds.height < window.innerHeight * chromeMaxHeightRatio
                && bounds.width >= window.innerWidth * chromeMinWidthRatio
                && inFirstViewport

            if (isTopChrome) element.setAttribute(attribute, '')
        }
    }, {
        attribute: FIXED_ELEMENT_ATTRIBUTE,
        canvasCoverageRatio: FIXED_CANVAS_COVERAGE_RATIO,
        chromeMaxHeightRatio: STICKY_CHROME_MAX_HEIGHT_RATIO,
        chromeMinWidthRatio: STICKY_CHROME_MIN_WIDTH_RATIO,
        chromeTopMaxPx: STICKY_CHROME_TOP_MAX_PX,
    })
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
 * 逾時後保存當時畫面。不使用 prefers-reduced-motion。
 *
 * @param page 已捲到目標位置的 Playwright 頁面。
 * @returns 畫面穩定或等待上限用盡後結束。
 */
async function waitForVisibleViewportToSettle(page: import('playwright').Page): Promise<void>
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

    while (Date.now() < deadline) {
        const hasCssMotion = await hasFiniteViewportAnimations(page)
        const layout = await readViewportLayoutState(page)
        const screenshot = await screenshotViewport(page, 'allow')
        const signature = await createSettleSignature(screenshot)
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

        stableSamples = !hasCssMotion && visuallyStable && layoutStable ? stableSamples + 1 : 0
        previousSignature = signature
        previousLayout = layout

        if (stableSamples >= VIEWPORT_SETTLE_STABLE_SAMPLES) return

        await page.waitForTimeout(VIEWPORT_SETTLE_POLL_MS)
    }
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
