import { createServer, type Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { chromium, type Browser } from 'playwright'
import sharp from 'sharp'
import {
    afterAll,
    beforeAll,
    describe,
    expect,
    it,
} from 'vitest'

import {
    capturePage,
    classifyPageType,
    discoverInternalLinks,
    isAccessInterstitial,
} from '../../apps/capture-worker/src/index.js'
import {
    comparePageImages,
    createLocalObjectStorage,
} from '../../packages/image/src/index.js'

let browser: Browser
let server: Server
let fixtureUrl: string
let storageRoot: string

describe('capture worker', { timeout: 60_000 }, () => {
    beforeAll(async () => {
        browser = await chromium.launch({ headless: true })
        storageRoot = await mkdtemp(join(tmpdir(), 'sitesensory-capture-'))
        server = createFixtureServer()
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
        const address = server.address()

        if (!address || typeof address === 'string') throw new Error('fixture server 未取得連接埠')

        fixtureUrl = `http://127.0.0.1:${address.port}/`
    }, 30_000)

    afterAll(async () => {
        if (browser) await browser.close()

        if (server) {
            await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
        }

        if (storageRoot) await rm(storageRoot, { force: true, recursive: true })
    })

    it('captures a 1920 viewport and a full page with evidence', async () => {
        const storage = createLocalObjectStorage(storageRoot)
        const result = await capturePage({
            allowLocalNetwork: true,
            browser,
            storage,
            url: fixtureUrl,
        })
        const viewport = await storage.get(result.viewport.objectKey)
        const fullPage = await storage.get(result.fullPage.objectKey)

        expect(readPngSize(viewport)).toEqual({ height: 1080, width: 1920 })
        expect(readPngSize(fullPage).width).toBe(1920)
        expect(readPngSize(fullPage).height).toBeGreaterThan(2000)
        expect(result.title).toBe('SiteSensory Fixture')
        expect(result.language).toBe('zh-Hant')
        expect(result.textSummary).toContain('設計案例')
        expect(result.links).toEqual([`${fixtureUrl}about`])
    })

    it('loads content that appears only after the page is scrolled', async () => {
        const storage = createLocalObjectStorage(storageRoot)
        const result = await capturePage({
            allowLocalNetwork: true,
            browser,
            storage,
            url: `${fixtureUrl}?lazy=1`,
        })
        const fullPage = await storage.get(result.fullPage.objectKey)
        const pixel = await sharp(fullPage)
            .extract({ height: 1, left: 960, top: 1700, width: 1 })
            .removeAlpha()
            .raw()
            .toBuffer()

        expect([...pixel]).toEqual([18, 181, 122])
    })

    it('waits past the minimum delay for a slow reveal after scroll', async () => {
        const storage = createLocalObjectStorage(storageRoot)
        const result = await capturePage({
            allowLocalNetwork: true,
            browser,
            storage,
            url: `${fixtureUrl}?delayedReveal=1`,
        })
        const fullPage = await storage.get(result.fullPage.objectKey)
        const revealedPixel = await samplePixel(fullPage, 960, 1500)

        expect(revealedPixel).toEqual([34, 197, 94])
        expect(revealedPixel).not.toEqual([148, 163, 184])
    })

    it('waits for a multi-second JS wipe before keeping the segment', async () => {
        const storage = createLocalObjectStorage(storageRoot)
        const result = await capturePage({
            allowLocalNetwork: true,
            browser,
            storage,
            url: `${fixtureUrl}?wipeReveal=1`,
        })
        const fullPage = await storage.get(result.fullPage.objectKey)
        const wipedPixel = await samplePixel(fullPage, 410, 1500)

        expect(wipedPixel).toEqual([34, 197, 94])
        expect(wipedPixel).not.toEqual([255, 255, 255])
    })

    it('waits for wipe bars that only cover the top of a photo card', async () => {
        const storage = createLocalObjectStorage(storageRoot)
        const result = await capturePage({
            allowLocalNetwork: true,
            browser,
            storage,
            url: `${fixtureUrl}?partialWipe=1`,
        })
        const fullPage = await storage.get(result.fullPage.objectKey)

        expect(await samplePixel(fullPage, 200, 1260)).toEqual([34, 197, 94])
        expect(await samplePixel(fullPage, 200, 1260)).not.toEqual([255, 255, 255])
        expect(await samplePixel(fullPage, 200, 1500)).toEqual([34, 197, 94])
    })

    it('does not publish a scroll-locked wipe after settle timeout', async () => {
        const storage = createLocalObjectStorage(storageRoot)
        const result = await capturePage({
            allowLocalNetwork: true,
            browser,
            storage,
            url: `${fixtureUrl}?lockedWipe=1`,
        })
        const fullPage = await storage.get(result.fullPage.objectKey)

        expect(await samplePixel(fullPage, 200, 1260)).toEqual([34, 197, 94])
        expect(await samplePixel(fullPage, 200, 1260)).not.toEqual([255, 255, 255])
        expect(await samplePixel(fullPage, 200, 1500)).toEqual([34, 197, 94])
    })

    it('does not stitch a leftover horizontal photo belt', async () => {
        const storage = createLocalObjectStorage(storageRoot)
        const result = await capturePage({
            allowLocalNetwork: true,
            browser,
            storage,
            url: `${fixtureUrl}?photoBelt=1`,
        })
        const fullPage = await storage.get(result.fullPage.objectKey)

        expect(await samplePixel(fullPage, 960, 1200)).toEqual([34, 197, 94])
        expect(await samplePixel(fullPage, 960, 2100)).toEqual([49, 92, 235])
        expect(await samplePixel(fullPage, 960, 2100)).not.toEqual([34, 197, 94])
        expect(await samplePixel(fullPage, 960, 2100)).not.toEqual([21, 128, 61])
    })

    it('removes a left-photo wipe stack sitting under another portfolio card', async () => {
        const storage = createLocalObjectStorage(storageRoot)
        const result = await capturePage({
            allowLocalNetwork: true,
            browser,
            storage,
            url: `${fixtureUrl}?portfolioStack=1`,
        })
        const fullPage = await storage.get(result.fullPage.objectKey)
        const height = readPngSize(fullPage).height

        expect(height).toBeLessThan(2400)
        expect(height).toBeGreaterThan(1600)
        expect(await samplePixel(fullPage, 200, 200)).not.toEqual([248, 245, 239])
        expect(await samplePixel(fullPage, 200, 1300)).not.toEqual([255, 255, 255])
        expect(await samplePixel(fullPage, 200, 1300)).not.toEqual([248, 245, 239])
    })

    it('waits out wipe bars on a dark photo next to the page edge', async () => {
        const storage = createLocalObjectStorage(storageRoot)
        const result = await capturePage({
            allowLocalNetwork: true,
            browser,
            storage,
            url: `${fixtureUrl}?darkEdgeWipe=1`,
        })
        const fullPage = await storage.get(result.fullPage.objectKey)

        expect(await samplePixel(fullPage, 820, 400)).not.toEqual([255, 255, 255])
        expect(await samplePixel(fullPage, 200, 400)).not.toEqual([248, 245, 239])
    })

    it('removes a stacked full card whose upper copy still has wipe bars', async () => {
        const storage = createLocalObjectStorage(storageRoot)
        const result = await capturePage({
            allowLocalNetwork: true,
            browser,
            storage,
            url: `${fixtureUrl}?stackedCardWipe=1`,
        })
        const fullPage = await storage.get(result.fullPage.objectKey)
        const height = readPngSize(fullPage).height

        expect(height).toBeLessThan(1800)
        expect(height).toBeGreaterThan(900)
        expect(await samplePixel(fullPage, 1400, 300)).not.toEqual([255, 255, 255])
        expect(await samplePixel(fullPage, 1400, 300)).not.toEqual([248, 245, 239])
    })

    it('removes a 16px offset belt that viewport-scale scan misses', async () => {
        const storage = createLocalObjectStorage(storageRoot)
        const result = await capturePage({
            allowLocalNetwork: true,
            browser,
            storage,
            url: `${fixtureUrl}?thinOffsetBelt=1`,
        })
        const fullPage = await storage.get(result.fullPage.objectKey)
        const height = readPngSize(fullPage).height

        expect(height).toBeLessThan(2150)
        expect(height).toBeGreaterThan(2000)
        expect(await samplePixel(fullPage, 1400, 1280)).not.toEqual([248, 245, 239])
        expect(await samplePixel(fullPage, 1400, height - 80)).toEqual([248, 245, 239])
    })

    it('removes a mid-page one-fifth belt from a tall stitched page', async () => {
        const storage = createLocalObjectStorage(storageRoot)
        const result = await capturePage({
            allowLocalNetwork: true,
            browser,
            storage,
            url: `${fixtureUrl}?tallCardBelt=1`,
        })
        const fullPage = await storage.get(result.fullPage.objectKey)
        const height = readPngSize(fullPage).height

        expect(height).toBeLessThan(6480)
        expect(height).toBeGreaterThan(4000)
        expect(await samplePixel(fullPage, 1400, 3500)).not.toEqual([248, 245, 239])

        const leftSamples = await Promise.all(
            [3600, 3800, 4000, 4200, 4400]
                .filter(top => top < height)
                .map(top => samplePixel(fullPage, 200, top)),
        )

        expect(leftSamples.some(pixel => pixel[0] !== 248 || pixel[1] !== 245)).toBe(true)
    })

    it('removes a one-fifth repeat under a photo card caption', async () => {
        const storage = createLocalObjectStorage(storageRoot)
        const result = await capturePage({
            allowLocalNetwork: true,
            browser,
            storage,
            url: `${fixtureUrl}?cardBelt=1`,
        })
        const fullPage = await storage.get(result.fullPage.objectKey)
        const height = readPngSize(fullPage).height

        expect(height).toBeLessThan(2160)
        expect(height).toBeGreaterThan(1700)
        expect(await samplePixel(fullPage, 1400, 1280)).not.toEqual([248, 245, 239])
        expect(await samplePixel(fullPage, 1400, 1280)).not.toEqual([21, 128, 61])
    })

    it('waits for the hero reveal after returning to the top', async () => {
        const storage = createLocalObjectStorage(storageRoot)
        const result = await capturePage({
            allowLocalNetwork: true,
            browser,
            storage,
            url: `${fixtureUrl}?heroReveal=1`,
        })
        const viewport = await storage.get(result.viewport.objectKey)
        const fullPage = await storage.get(result.fullPage.objectKey)

        expect(await samplePixel(viewport, 960, 540)).toEqual([34, 197, 94])
        expect(await samplePixel(fullPage, 960, 540)).toEqual([34, 197, 94])
        expect(await samplePixel(viewport, 960, 540)).not.toEqual([220, 38, 38])
    })

    it('waits for a scrolled block to finish revealing before capture', async () => {
        const storage = createLocalObjectStorage(storageRoot)
        const result = await capturePage({
            allowLocalNetwork: true,
            browser,
            storage,
            url: `${fixtureUrl}?settledBlock=1`,
        })
        const fullPage = await storage.get(result.fullPage.objectKey)
        const revealedPixel = await sharp(fullPage)
            .extract({ height: 1, left: 960, top: 1500, width: 1 })
            .removeAlpha()
            .raw()
            .toBuffer()

        expect([...revealedPixel]).toEqual([34, 197, 94])
    })

    it('captures scroll-driven sections without leaving their reserved height blank', async () => {
        const storage = createLocalObjectStorage(storageRoot)
        const result = await capturePage({
            allowLocalNetwork: true,
            browser,
            storage,
            url: `${fixtureUrl}?scrollScene=1`,
        })
        const fullPage = await storage.get(result.fullPage.objectKey)
        const scenePixel = await sharp(fullPage)
            .extract({ height: 1, left: 960, top: 2500, width: 1 })
            .removeAlpha()
            .raw()
            .toBuffer()
        const repeatedFixedPixel = await sharp(fullPage)
            .extract({ height: 1, left: 1850, top: 1200, width: 1 })
            .removeAlpha()
            .raw()
            .toBuffer()

        expect([...scenePixel]).toEqual([49, 92, 235])
        expect([...repeatedFixedPixel]).not.toEqual([220, 38, 38])
    }, 90_000)

    it('keeps a viewport-sized fixed canvas used for virtual scrolling', async () => {
        const storage = createLocalObjectStorage(storageRoot)
        const result = await capturePage({
            allowLocalNetwork: true,
            browser,
            storage,
            url: `${fixtureUrl}?fixedCanvas=1`,
        })
        const fullPage = await storage.get(result.fullPage.objectKey)
        const canvasPixel = await sharp(fullPage)
            .extract({ height: 1, left: 960, top: 1500, width: 1 })
            .removeAlpha()
            .raw()
            .toBuffer()

        expect([...canvasPixel]).toEqual([34, 197, 94])
    })

    it('compacts repeated states from a viewport-sized virtual canvas', async () => {
        const storage = createLocalObjectStorage(storageRoot)
        const result = await capturePage({
            allowLocalNetwork: true,
            browser,
            storage,
            url: `${fixtureUrl}?repeatedCanvas=1`,
        })
        const fullPage = await storage.get(result.fullPage.objectKey)

        expect(readPngSize(fullPage)).toEqual({ height: 2160, width: 1920 })
    })

    it('rejects pages that exceed the bounded full-page capture height', async () => {
        const storage = createLocalObjectStorage(storageRoot)

        await expect(capturePage({
            allowLocalNetwork: true,
            browser,
            storage,
            url: `${fixtureUrl}?oversized=1`,
        })).rejects.toThrow('超過單次擷取上限')
    })

    it('compares stable and clearly different fixture images', async () => {
        const storage = createLocalObjectStorage(storageRoot)
        const baseline = await capturePage({
            allowLocalNetwork: true,
            browser,
            storage,
            url: fixtureUrl,
        })
        const repeated = await capturePage({
            allowLocalNetwork: true,
            browser,
            storage,
            url: fixtureUrl,
        })
        const changed = await capturePage({
            allowLocalNetwork: true,
            browser,
            storage,
            url: `${fixtureUrl}?variant=changed`,
        })
        const baselineImage = await storage.get(baseline.fullPage.objectKey)
        const repeatedImage = await storage.get(repeated.fullPage.objectKey)
        const changedImage = await storage.get(changed.fullPage.objectKey)

        await expect(comparePageImages(baselineImage, repeatedImage)).resolves.toMatchObject({
            decision: 'unchanged',
        })
        await expect(comparePageImages(baselineImage, changedImage)).resolves.toMatchObject({
            decision: 'new_version',
            ruleVersion: 'fixture-v1-uncalibrated',
        })
    }, 60_000)

    it('rejects path traversal in local object storage', async () => {
        const storage = createLocalObjectStorage(storageRoot)

        await expect(storage.get('../secret')).rejects.toThrow('超出資產根目錄')
        await expect(storage.put(Buffer.from('test'), '../png')).rejects.toThrow('副檔名')
    })

    it('filters duplicate, external, session and unsafe navigation links', () => {
        expect(discoverInternalLinks('https://example.com/', [
            'https://example.com/about/',
            'https://example.com/about?utm_source=test',
            'https://example.com/login',
            'https://example.com/news?session=secret',
            'https://other.example/about',
            'mailto:test@example.com',
        ])).toEqual(['https://example.com/about'])
    })

    it('classifies common inner page purposes before AI analysis', () => {
        expect(classifyPageType('https://example.com/', '首頁', '')).toBe('home')
        expect(classifyPageType('https://example.com/about', 'Company', '')).toBe('about')
        expect(classifyPageType('https://example.com/news/launch', 'Launch', '')).toBe('news-detail')
        expect(classifyPageType('https://example.com/news/press', 'Careers and press', '')).toBe('news-list')
        expect(classifyPageType('https://example.com/news/faq', 'Questions', '')).toBe('faq')
        expect(classifyPageType('https://example.com/ko/contact', 'Join our team', '')).toBe('contact')
        expect(classifyPageType('https://example.com/services', 'Services', '')).toBe('product-service')
        expect(classifyPageType('https://example.com/?lv1=Appendix&lv2=ESG+Data', 'ESG Data', '')).toBe('other')
        expect(classifyPageType('https://example.com/artists', 'Artists', 'Contact us in the footer')).toBe('case-study')
    })

    it('rejects access verification pages without blocking ordinary security content', () => {
        expect(isAccessInterstitial(
            'Just a moment...',
            'Performing security verification. This website uses a security service.',
        )).toBe(true)
        expect(isAccessInterstitial(
            'Security services for teams',
            'Protect your website and verify account activity.',
        )).toBe(false)
    })

    it('dismisses a cookie consent modal before viewport and full-page capture', async () => {
        const storage = createLocalObjectStorage(storageRoot)
        const result = await capturePage({
            allowLocalNetwork: true,
            browser,
            storage,
            url: `${fixtureUrl}?cookies=1`,
        })
        const viewport = await storage.get(result.viewport.objectKey)
        const fullPage = await storage.get(result.fullPage.objectKey)
        const viewportCenter = await samplePixel(viewport, 960, 540)
        const fullPageCenter = await samplePixel(fullPage, 960, 540)
        const laterSection = await samplePixel(fullPage, 960, 1500)

        expect(viewportCenter).toEqual([34, 197, 94])
        expect(fullPageCenter).toEqual([34, 197, 94])
        expect(laterSection).toEqual([34, 197, 94])
        expect(viewportCenter).not.toEqual([17, 24, 39])
        expect(viewportCenter).not.toEqual([220, 38, 38])
    })

    it('hides a blocking cookie overlay when no consent control is available', async () => {
        const storage = createLocalObjectStorage(storageRoot)
        const result = await capturePage({
            allowLocalNetwork: true,
            browser,
            storage,
            url: `${fixtureUrl}?cookieOverlay=1`,
        })
        const viewport = await storage.get(result.viewport.objectKey)
        const fullPage = await storage.get(result.fullPage.objectKey)

        expect(await samplePixel(viewport, 960, 540)).toEqual([34, 197, 94])
        expect(await samplePixel(fullPage, 960, 540)).toEqual([34, 197, 94])
        expect(await samplePixel(viewport, 960, 540)).not.toEqual([124, 58, 237])
    })

    it('does not repeat a sticky top nav bar in later stitch segments', async () => {
        const storage = createLocalObjectStorage(storageRoot)
        const result = await capturePage({
            allowLocalNetwork: true,
            browser,
            storage,
            url: `${fixtureUrl}?stickyNav=1`,
        })
        const fullPage = await storage.get(result.fullPage.objectKey)
        const firstHeader = await samplePixel(fullPage, 960, 30)
        const laterHeader = await samplePixel(fullPage, 960, 1110)
        const laterCanvas = await samplePixel(fullPage, 960, 1500)

        expect(firstHeader).toEqual([220, 38, 38])
        expect(laterHeader).not.toEqual([220, 38, 38])
        expect(laterCanvas).toEqual([34, 197, 94])
    })

    it('does not repeat a sticky side bar in later stitch segments', async () => {
        const storage = createLocalObjectStorage(storageRoot)
        const result = await capturePage({
            allowLocalNetwork: true,
            browser,
            storage,
            url: `${fixtureUrl}?stickySidebar=1`,
        })
        const fullPage = await storage.get(result.fullPage.objectKey)

        expect(await samplePixel(fullPage, 80, 30)).toEqual([220, 38, 38])
        expect(await samplePixel(fullPage, 80, 1110)).not.toEqual([220, 38, 38])
        expect(await samplePixel(fullPage, 960, 1500)).toEqual([34, 197, 94])
    })

    it('trims a repeated sticky scene band from later stitch segments', async () => {
        const storage = createLocalObjectStorage(storageRoot)
        const result = await capturePage({
            allowLocalNetwork: true,
            browser,
            storage,
            url: `${fixtureUrl}?stickyScene=1`,
        })
        const fullPage = await storage.get(result.fullPage.objectKey)

        expect(await samplePixel(fullPage, 960, 1200)).toEqual([34, 197, 94])
        expect(await samplePixel(fullPage, 960, 2000)).not.toEqual([34, 197, 94])
        expect(await samplePixel(fullPage, 960, 2000)).not.toEqual([21, 128, 61])
    })

    it('trims a virtual-canvas wipe viewport stacked on its clean copy', async () => {
        const storage = createLocalObjectStorage(storageRoot)
        const result = await capturePage({
            allowLocalNetwork: true,
            browser,
            storage,
            url: `${fixtureUrl}?canvasWipeStack=1`,
        })
        const fullPage = await storage.get(result.fullPage.objectKey)
        const height = readPngSize(fullPage).height

        expect(height).toBeLessThan(2400)
        expect(height).toBeGreaterThan(1900)
        expect(await samplePixel(fullPage, 208, 80)).not.toEqual([255, 255, 255])
        expect(await samplePixel(fullPage, 200, 80)).not.toEqual([248, 245, 239])
        expect(await samplePixel(fullPage, 200, 1200)).toEqual([248, 245, 239])
        expect(await samplePixel(fullPage, 1400, 1200)).not.toEqual([248, 245, 239])
    })

    it('trims a mid-page virtual-canvas faint-wipe stack under another card', async () => {
        const storage = createLocalObjectStorage(storageRoot)
        const result = await capturePage({
            allowLocalNetwork: true,
            browser,
            storage,
            url: `${fixtureUrl}?midCanvasWipeStack=1`,
        })
        const fullPage = await storage.get(result.fullPage.objectKey)
        const height = readPngSize(fullPage).height

        expect(height).toBeLessThan(3600)
        expect(height).toBeGreaterThan(2800)
        expect(await samplePixel(fullPage, 200, 200)).not.toEqual([248, 245, 239])
        expect(await samplePixel(fullPage, 400, 1120)).not.toEqual([255, 255, 255])
        expect(await samplePixel(fullPage, 400, 1120)).not.toEqual([248, 245, 239])
        expect(await samplePixel(fullPage, 224, 1120)).not.toEqual([255, 255, 255])
        expect(await samplePixel(fullPage, 1400, 2300)).not.toEqual([248, 245, 239])
    })

    it('trims a dense venetian canvas wipe stacked on its clean copy', async () => {
        const storage = createLocalObjectStorage(storageRoot)
        const result = await capturePage({
            allowLocalNetwork: true,
            browser,
            storage,
            url: `${fixtureUrl}?venetianCanvasWipe=1`,
        })
        const fullPage = await storage.get(result.fullPage.objectKey)
        const height = readPngSize(fullPage).height

        expect(height).toBeLessThan(3600)
        expect(height).toBeGreaterThan(1900)
        expect(await samplePixel(fullPage, 1400, 200)).not.toEqual([248, 245, 239])
        expect(await samplePixel(fullPage, 200, 200)).toEqual([248, 245, 239])
        expect(await samplePixel(fullPage, 112, 1200)).not.toEqual([255, 255, 255])
        expect(await samplePixel(fullPage, 200, 1200)).not.toEqual([248, 245, 239])
    })

    it('keeps a pinned virtual-canvas scene only once while the tail color changes', async () => {
        const storage = createLocalObjectStorage(storageRoot)
        const result = await capturePage({
            allowLocalNetwork: true,
            browser,
            storage,
            url: `${fixtureUrl}?pinnedCanvas=1`,
        })
        const fullPage = await storage.get(result.fullPage.objectKey)

        expect(readPngSize(fullPage)).toEqual({ height: 1080, width: 1920 })
        expect(await samplePixel(fullPage, 20, 40)).toEqual([34, 197, 94])
        expect(await samplePixel(fullPage, 60, 40)).toEqual([21, 128, 61])
    })
})

/**
 * 建立不需外部網路的固定網站，供瀏覽器擷取測試使用。
 *
 * @returns 只綁定測試程序的 HTTP server。
 */
function createFixtureServer(): Server
{
    return createServer((request, response) => {
        const parameters = new URL(request.url ?? '/', 'http://fixture').searchParams
        const repeatedCanvas = parameters.has('repeatedCanvas')
        const settledBlock = parameters.has('settledBlock')
        const cookies = parameters.has('cookies')
        const cookieOverlay = parameters.has('cookieOverlay')
        const stickyNav = parameters.has('stickyNav')
        const delayedReveal = parameters.has('delayedReveal')
        const heroReveal = parameters.has('heroReveal')
        const wipeReveal = parameters.has('wipeReveal')
        const partialWipe = parameters.has('partialWipe')
        const stickySidebar = parameters.has('stickySidebar')
        const stickyScene = parameters.has('stickyScene')
        const pinnedCanvas = parameters.has('pinnedCanvas')
        const lockedWipe = parameters.has('lockedWipe')
        const photoBelt = parameters.has('photoBelt')
        const cardBelt = parameters.has('cardBelt')
        const tallCardBelt = parameters.has('tallCardBelt')
        const stackedCardWipe = parameters.has('stackedCardWipe')
        const thinOffsetBelt = parameters.has('thinOffsetBelt')
        const portfolioStack = parameters.has('portfolioStack')
        const darkEdgeWipe = parameters.has('darkEdgeWipe')
        const canvasWipeStack = parameters.has('canvasWipeStack')
        const midCanvasWipeStack = parameters.has('midCanvasWipeStack')
        const venetianCanvasWipe = parameters.has('venetianCanvasWipe')

        if (cookies) {
            const html = `<!doctype html>
<html lang="zh-Hant">
<head><meta charset="utf-8"><title>Cookie Consent Fixture</title></head>
<body style="margin:0;background:#315ceb;overflow:hidden">
<main id="main" style="min-height:2200px;background:#315ceb"></main>
<div id="cookie-backdrop" style="position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9998"></div>
<div id="cookie-dialog" role="dialog" aria-modal="true" style="position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:640px;height:320px;background:#111827;color:#fff;z-index:9999;padding:32px">
<p>We have the cookies. You have the choice.</p>
<button id="accept">Accept all</button>
<button id="decline">Decline all</button>
<button id="settings">Settings</button>
</div>
<script>
const paint = color => {
    document.body.style.background = color
    document.querySelector('#main').style.background = color
}
const removeBanner = () => {
    document.querySelector('#cookie-backdrop').remove()
    document.querySelector('#cookie-dialog').remove()
    document.body.style.overflow = 'auto'
}
document.querySelector('#accept').addEventListener('click', () => {
    paint('#dc2626')
    removeBanner()
})
document.querySelector('#decline').addEventListener('click', () => {
    paint('#22c55e')
    removeBanner()
})
</script>
</body></html>`

            response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
            response.end(html)
            return
        }

        if (cookieOverlay) {
            const html = `<!doctype html>
<html lang="zh-Hant">
<head><meta charset="utf-8"><title>Cookie Overlay Fixture</title></head>
<body style="margin:0;background:#22c55e">
<main style="min-height:2200px;background:#22c55e"></main>
<div role="dialog" aria-modal="true" style="position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:640px;height:280px;background:#7c3aed;color:#fff;z-index:9999;padding:32px">
<p>This site uses cookies to improve your experience. See our privacy policy.</p>
</div>
</body></html>`

            response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
            response.end(html)
            return
        }

        if (delayedReveal) {
            const html = `<!doctype html>
<html lang="zh-Hant">
<head><meta charset="utf-8"><title>Delayed Reveal Fixture</title></head>
<body style="margin:0">
<section style="height:1080px;background:#315ceb"></section>
<section id="scene" style="height:1080px;background:#e5e7eb;position:relative">
<div id="reveal" style="position:absolute;inset:0;background:#22c55e;opacity:0"></div>
</section>
<script>
addEventListener('scroll',()=>{
    const scene=document.querySelector('#scene')
    const reveal=document.querySelector('#reveal')
    const bounds=scene.getBoundingClientRect()
    const visible=bounds.top<innerHeight*0.9 && bounds.bottom>innerHeight*0.1
    if(!visible){
        reveal.dataset.running=''
        reveal.style.transition='none'
        reveal.style.opacity='0'
        return
    }
    if(reveal.dataset.running==='1') return
    reveal.dataset.running='1'
    reveal.style.transition='none'
    reveal.style.opacity='0'
    reveal.getBoundingClientRect()
    reveal.style.transition='opacity 1.6s linear'
    reveal.style.opacity='1'
})
</script>
</body></html>`

            response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
            response.end(html)
            return
        }

        if (partialWipe) {
            const html = `<!doctype html>
<html lang="zh-Hant">
<head><meta charset="utf-8"><title>Partial Wipe Fixture</title></head>
<body style="margin:0;background:#f5f5f7">
<section style="height:1080px;background:#315ceb"></section>
<section id="scene" style="height:1080px;background:#f5f5f7;position:relative">
<div id="photo" style="position:absolute;left:80px;top:120px;width:820px;height:520px;background:#22c55e;overflow:hidden">
<div id="wipes" style="position:absolute;left:0;right:0;top:0;height:140px"></div>
</div>
</section>
<script>
let raf=0
addEventListener('scroll',()=>{
    const scene=document.querySelector('#scene')
    const wipes=document.querySelector('#wipes')
    const bounds=scene.getBoundingClientRect()
    const visible=bounds.top<innerHeight*0.9 && bounds.bottom>innerHeight*0.1
    if(!visible){
        cancelAnimationFrame(raf)
        wipes.dataset.running=''
        wipes.innerHTML=''
        return
    }
    if(wipes.dataset.running==='1') return
    wipes.dataset.running='1'
    wipes.innerHTML=''
    const bars=[]
    for(let i=0;i<8;i+=1){
        const bar=document.createElement('div')
        bar.style.cssText='position:absolute;top:0;bottom:0;width:16px;background:#fff;transform-origin:center;left:'+(40+i*48)+'px'
        wipes.appendChild(bar)
        bars.push(bar)
    }
    const started=performance.now()
    const tick=now=>{
        const elapsed=now-started
        if(elapsed<1800){
            raf=requestAnimationFrame(tick)
            return
        }
        const t=Math.min((elapsed-1800)/400,1)
        for(const bar of bars) bar.style.transform='scaleX('+(1-t)+')'
        if(t<1) raf=requestAnimationFrame(tick)
        else wipes.innerHTML=''
    }
    raf=requestAnimationFrame(tick)
})
</script>
</body></html>`

            response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
            response.end(html)
            return
        }

        if (wipeReveal) {
            const html = `<!doctype html>
<html lang="zh-Hant">
<head><meta charset="utf-8"><title>Wipe Reveal Fixture</title></head>
<body style="margin:0">
<section style="height:1080px;background:#315ceb"></section>
<section id="scene" style="height:1080px;background:#111;position:relative;overflow:hidden">
<div id="photo" style="position:absolute;inset:0;background:#22c55e"></div>
<div id="wipes" style="position:absolute;inset:0"></div>
</section>
<script>
let raf=0
addEventListener('scroll',()=>{
    const scene=document.querySelector('#scene')
    const wipes=document.querySelector('#wipes')
    const bounds=scene.getBoundingClientRect()
    const visible=bounds.top<innerHeight*0.9 && bounds.bottom>innerHeight*0.1
    if(!visible){
        cancelAnimationFrame(raf)
        wipes.dataset.running=''
        wipes.innerHTML=''
        return
    }
    if(wipes.dataset.running==='1') return
    wipes.dataset.running='1'
    wipes.innerHTML=''
    const bars=[]
    for(let i=0;i<8;i+=1){
        const bar=document.createElement('div')
        bar.style.cssText='position:absolute;top:0;bottom:0;width:20px;background:#fff;transform-origin:center;left:'+(400+i*48)+'px'
        wipes.appendChild(bar)
        bars.push(bar)
    }
    const started=performance.now()
    const tick=now=>{
        const elapsed=now-started
        if(elapsed<1800){
            raf=requestAnimationFrame(tick)
            return
        }
        const t=Math.min((elapsed-1800)/400,1)
        for(const bar of bars) bar.style.transform='scaleX('+(1-t)+')'
        if(t<1) raf=requestAnimationFrame(tick)
        else wipes.innerHTML=''
    }
    raf=requestAnimationFrame(tick)
})
</script>
</body></html>`

            response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
            response.end(html)
            return
        }

        if (stickySidebar) {
            const html = `<!doctype html>
<html lang="zh-Hant">
<head><meta charset="utf-8"><title>Sticky Sidebar Fixture</title></head>
<body style="margin:0">
<div id="canvas" style="position:fixed;inset:0;background:#315ceb;z-index:0"></div>
<aside style="position:sticky;top:0;left:0;width:240px;height:100vh;background:#dc2626;z-index:2"></aside>
<div style="height:3240px;position:relative;z-index:1"></div>
<script>addEventListener('scroll',()=>{document.querySelector('#canvas').style.background=scrollY>0?'#22c55e':'#315ceb'})</script>
</body></html>`

            response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
            response.end(html)
            return
        }

        if (stickyScene) {
            const html = `<!doctype html>
<html lang="zh-Hant">
<head><meta charset="utf-8"><title>Sticky Scene Fixture</title></head>
<body style="margin:0">
<section style="height:1080px;background:#315ceb"></section>
<section style="height:2500px;background:#f8f5ef">
<div style="position:sticky;top:0;height:400px;background-image:repeating-linear-gradient(90deg,#22c55e 0 40px,#15803d 40px 80px)"></div>
</section>
</body></html>`

            response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
            response.end(html)
            return
        }

        if (lockedWipe) {
            const html = `<!doctype html>
<html lang="zh-Hant">
<head><meta charset="utf-8"><title>Locked Wipe Fixture</title></head>
<body style="margin:0;background:#f5f5f7">
<section style="height:1080px;background:#315ceb"></section>
<section id="scene" style="height:1080px;background:#f5f5f7;position:relative">
<div id="photo" style="position:absolute;left:80px;top:120px;width:820px;height:520px;background:#22c55e;overflow:hidden">
<div id="wipes" style="position:absolute;left:0;right:0;top:0;height:140px"></div>
</div>
</section>
<script>
const paint=show=>{
    const wipes=document.querySelector('#wipes')
    if(show){
        if(wipes.dataset.on==='1') return
        wipes.dataset.on='1'
        wipes.innerHTML=''
        for(let i=0;i<8;i+=1){
            const bar=document.createElement('div')
            bar.style.cssText='position:absolute;top:0;bottom:0;width:16px;background:#fff;left:'+(40+i*48)+'px'
            wipes.appendChild(bar)
        }
        return
    }
    wipes.dataset.on=''
    wipes.innerHTML=''
}
const sync=()=>paint((scrollY-680)/400<0.85)
addEventListener('scroll',sync)
sync()
</script>
</body></html>`

            response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
            response.end(html)
            return
        }

        if (thinOffsetBelt) {
            const html = `<!doctype html>
<html lang="zh-Hant">
<head><meta charset="utf-8"><title>Thin Offset Belt Fixture</title></head>
<body style="margin:0;background:#f8f5ef">
<section style="height:1080px;background:#315ceb"></section>
<section style="height:1080px;background:#f8f5ef;position:relative">
<div style="position:absolute;left:960px;top:40px;width:900px;height:500px;background:radial-gradient(circle at 38% 32%,#d97848 0 110px,transparent 190px),linear-gradient(160deg,#3f6f8a,#1d3a4a)"></div>
<div style="position:absolute;left:960px;top:540px;width:900px;height:16px;background-image:repeating-linear-gradient(90deg,#22c55e 0 40px,#15803d 40px 80px)"></div>
<div style="position:absolute;left:960px;top:564px;width:900px;height:16px;background-image:repeating-linear-gradient(90deg,#22c55e 0 40px,#15803d 40px 80px)"></div>
<div style="position:absolute;left:700px;top:552px;width:280px;height:28px;background:#ff5c38;border-radius:999px"></div>
</section>
</body></html>`

            response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
            response.end(html)
            return
        }

        if (portfolioStack) {
            const html = `<!doctype html>
<html lang="zh-Hant">
<head><meta charset="utf-8"><title>Portfolio Stack Fixture</title></head>
<body style="margin:0;background:#f8f5ef">
<section style="height:1080px;background:#f8f5ef;position:relative">
<div style="position:absolute;left:80px;top:40px;width:820px;height:520px;background:radial-gradient(circle at 60% 40%,#8a3f6f 0 120px,transparent 200px),linear-gradient(40deg,#4a2d55,#1d3a4a)"></div>
</section>
<section style="height:1400px;background:#f8f5ef;position:relative">
<div style="position:absolute;left:80px;top:20px;width:900px;height:540px;background:radial-gradient(circle at 38% 32%,#d97848 0 110px,transparent 190px),linear-gradient(160deg,#3f6f8a,#1d3a4a)"></div>
<div style="position:absolute;left:200px;top:20px;width:16px;height:200px;background:#fff"></div>
<div style="position:absolute;left:248px;top:20px;width:16px;height:200px;background:#fff"></div>
<div style="position:absolute;left:296px;top:20px;width:16px;height:200px;background:#fff"></div>
<div style="position:absolute;left:344px;top:20px;width:16px;height:200px;background:#fff"></div>
<div style="position:absolute;left:1100px;top:40px;width:360px;height:48px;background:#242220"></div>
<div style="position:absolute;left:1100px;top:470px;width:280px;height:44px;background:#ff5c38;border-radius:999px"></div>
<div style="position:absolute;left:80px;top:660px;width:900px;height:540px;background:radial-gradient(circle at 38% 32%,#d97848 0 110px,transparent 190px),linear-gradient(160deg,#3f6f8a,#1d3a4a)"></div>
<div style="position:absolute;left:1100px;top:1110px;width:280px;height:44px;background:#ff5c38;border-radius:999px"></div>
</section>
<section style="height:280px;background:#f8f5ef"></section>
</body></html>`

            response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
            response.end(html)
            return
        }

        if (venetianCanvasWipe) {
            const html = `<!doctype html>
<html lang="zh-Hant">
<head><meta charset="utf-8"><title>Venetian Canvas Wipe Fixture</title></head>
<body style="margin:0;background:#f8f5ef">
<div id="canvas" style="position:fixed;inset:0;background:#f8f5ef;z-index:0">
<div id="photo" style="position:absolute;left:960px;top:40px;width:900px;height:900px;background:repeating-linear-gradient(90deg,#ece8e4 0 35px,#f7f4f0 35px 70px)"></div>
<div id="wipes"></div>
<div id="caption" style="position:absolute;left:1100px;top:40px;width:360px;height:48px;background:#242220;display:none"></div>
<div id="cta" style="position:absolute;left:1100px;top:520px;width:280px;height:44px;background:#ff5c38;border-radius:999px;display:none"></div>
</div>
<div style="height:5400px"></div>
<script>
const photo=document.querySelector('#photo')
const wipes=document.querySelector('#wipes')
const caption=document.querySelector('#caption')
const cta=document.querySelector('#cta')
const paintWipes=show=>{
    wipes.innerHTML=''
    if(!show) return
    for (let left=100; left<=936; left+=12) {
        const bar=document.createElement('div')
        bar.style.cssText='position:absolute;top:40px;height:900px;width:3px;background:#fff;left:'+left+'px'
        wipes.appendChild(bar)
    }
}
const paint=()=>{
    const y=scrollY
    if(y<720){
        photo.style.left='960px'
        photo.style.width='900px'
        photo.style.height='900px'
        photo.style.background='repeating-linear-gradient(90deg,#ece8e4 0 35px,#f7f4f0 35px 70px)'
        caption.style.display='none'
        cta.style.display='none'
        caption.style.left='80px'
        paintWipes(false)
        return
    }
    if(y<1600){
        photo.style.left='80px'
        photo.style.width='900px'
        photo.style.height='900px'
        photo.style.background='radial-gradient(circle at 38% 32%,#f4d27a 0 140px,transparent 220px),linear-gradient(160deg,#f2c36a,#6ed7ea,#f6f1e8)'
        caption.style.display='block'
        caption.style.left='1100px'
        cta.style.display='block'
        paintWipes(true)
        return
    }
    photo.style.left='80px'
    photo.style.width='900px'
    photo.style.height='900px'
    photo.style.background='radial-gradient(circle at 38% 32%,#f4d27a 0 140px,transparent 220px),linear-gradient(160deg,#f2c36a,#6ed7ea,#f6f1e8)'
    caption.style.display='block'
    caption.style.left='1100px'
    cta.style.display='block'
    paintWipes(false)
}
paint()
addEventListener('scroll',paint)
</script>
</body></html>`

            response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
            response.end(html)
            return
        }

        if (midCanvasWipeStack) {
            const html = `<!doctype html>
<html lang="zh-Hant">
<head><meta charset="utf-8"><title>Mid Canvas Wipe Stack Fixture</title></head>
<body style="margin:0;background:#f8f5ef">
<div id="canvas" style="position:fixed;inset:0;background:#f8f5ef;z-index:0">
<div id="photo" style="position:absolute;left:80px;top:40px;width:820px;height:520px;background:radial-gradient(circle at 60% 40%,#8a3f6f 0 120px,transparent 200px),linear-gradient(40deg,#4a2d55,#1d3a4a)"></div>
<div id="wipes"></div>
<div id="caption" style="position:absolute;left:1100px;top:40px;width:360px;height:48px;background:#242220;display:none"></div>
<div id="cta" style="position:absolute;left:1100px;top:470px;width:280px;height:44px;background:#ff5c38;border-radius:999px;display:none"></div>
</div>
<div style="height:5400px"></div>
<script>
const photo=document.querySelector('#photo')
const wipes=document.querySelector('#wipes')
const caption=document.querySelector('#caption')
const cta=document.querySelector('#cta')
const paintWipes=show=>{
    wipes.innerHTML=''
    if(!show) return
    for (const left of [220,320]) {
        const bar=document.createElement('div')
        bar.style.cssText='position:absolute;top:40px;height:140px;width:8px;background:#fff;left:'+left+'px'
        wipes.appendChild(bar)
    }
}
const paint=()=>{
    const y=scrollY
    if(y<600){
        photo.style.left='80px'
        photo.style.width='820px'
        photo.style.height='520px'
        photo.style.background='radial-gradient(circle at 60% 40%,#8a3f6f 0 120px,transparent 200px),linear-gradient(40deg,#4a2d55,#1d3a4a)'
        caption.style.display='none'
        cta.style.display='none'
        paintWipes(false)
        return
    }
    if(y<1500){
        photo.style.left='80px'
        photo.style.width='900px'
        photo.style.height='640px'
        photo.style.background='radial-gradient(circle at 38% 32%,#d97848 0 110px,transparent 190px),linear-gradient(160deg,#3f6f8a,#1d3a4a)'
        caption.style.display='block'
        cta.style.display='block'
        paintWipes(true)
        return
    }
    if(y<2400){
        photo.style.left='80px'
        photo.style.width='900px'
        photo.style.height='640px'
        photo.style.background='radial-gradient(circle at 38% 32%,#d97848 0 110px,transparent 190px),linear-gradient(160deg,#3f6f8a,#1d3a4a)'
        caption.style.display='block'
        cta.style.display='block'
        paintWipes(false)
        return
    }
    photo.style.left='960px'
    photo.style.width='900px'
    photo.style.height='640px'
    photo.style.background='radial-gradient(circle at 55% 35%,#d97848 0 90px,transparent 160px),linear-gradient(20deg,#1d3a4a,#4a2d55)'
    caption.style.display='none'
    cta.style.display='none'
    paintWipes(false)
}
paint()
addEventListener('scroll',paint)
</script>
</body></html>`

            response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
            response.end(html)
            return
        }

        if (canvasWipeStack) {
            const html = `<!doctype html>
<html lang="zh-Hant">
<head><meta charset="utf-8"><title>Canvas Wipe Stack Fixture</title></head>
<body style="margin:0;background:#f8f5ef">
<div id="canvas" style="position:fixed;inset:0;background:#f8f5ef;z-index:0">
<div id="photo" style="position:absolute;left:80px;top:40px;width:900px;height:640px;background:radial-gradient(circle at 38% 32%,#d97848 0 110px,transparent 190px),linear-gradient(160deg,#3f6f8a,#1d3a4a)"></div>
<div id="wipes"></div>
<div id="caption" style="position:absolute;left:1100px;top:40px;width:360px;height:48px;background:#242220"></div>
<div id="cta" style="position:absolute;left:1100px;top:470px;width:280px;height:44px;background:#ff5c38;border-radius:999px"></div>
</div>
<div style="height:4320px"></div>
<script>
const photo=document.querySelector('#photo')
const wipes=document.querySelector('#wipes')
const caption=document.querySelector('#caption')
const cta=document.querySelector('#cta')
const paintWipes=show=>{
    wipes.innerHTML=''
    if(!show) return
    for (const left of [160,208,256,304]) {
        const bar=document.createElement('div')
        bar.style.cssText='position:absolute;top:40px;height:220px;width:16px;background:#fff;left:'+left+'px'
        wipes.appendChild(bar)
    }
}
const paint=()=>{
    const y=scrollY
    if(y<720){
        photo.style.left='80px'
        photo.style.background='radial-gradient(circle at 38% 32%,#d97848 0 110px,transparent 190px),linear-gradient(160deg,#3f6f8a,#1d3a4a)'
        caption.style.display='block'
        cta.style.display='block'
        paintWipes(true)
        return
    }
    if(y<1620){
        photo.style.left='80px'
        photo.style.background='radial-gradient(circle at 38% 32%,#d97848 0 110px,transparent 190px),linear-gradient(160deg,#3f6f8a,#1d3a4a)'
        caption.style.display='block'
        cta.style.display='block'
        paintWipes(false)
        return
    }
    photo.style.left='960px'
    photo.style.background='radial-gradient(circle at 60% 40%,#8a3f6f 0 120px,transparent 200px),linear-gradient(40deg,#4a2d55,#1d3a4a)'
    caption.style.display='none'
    cta.style.display='none'
    paintWipes(false)
}
paint()
addEventListener('scroll',paint)
</script>
</body></html>`

            response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
            response.end(html)
            return
        }

        if (darkEdgeWipe) {
            const html = `<!doctype html>
<html lang="zh-Hant">
<head><meta charset="utf-8"><title>Dark Edge Wipe Fixture</title></head>
<body style="margin:0;background:#f8f5ef">
<section id="scene" style="height:1080px;background:#f8f5ef;position:relative">
<div id="photo" style="position:absolute;left:80px;top:80px;width:820px;height:820px;background:
repeating-conic-gradient(from 30deg at 50% 50%,#3a1a12 0 18deg,#5a2a18 18deg 36deg)"></div>
<div id="wipes" style="position:absolute;left:80px;top:80px;width:820px;height:820px"></div>
</section>
<script>
const wipes=document.querySelector('#wipes')
for (const left of [680,720,752,776]) {
    const bar=document.createElement('div')
    bar.style.cssText='position:absolute;top:0;bottom:0;width:10px;background:#fff;left:'+left+'px'
    wipes.appendChild(bar)
}
const started=performance.now()
const tick=now=>{
    if(now-started<1800){
        requestAnimationFrame(tick)
        return
    }
    wipes.innerHTML=''
}
requestAnimationFrame(tick)
</script>
</body></html>`

            response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
            response.end(html)
            return
        }

        if (stackedCardWipe) {
            const html = `<!doctype html>
<html lang="zh-Hant">
<head><meta charset="utf-8"><title>Stacked Card Wipe Fixture</title></head>
<body style="margin:0;background:#f8f5ef">
<section style="height:200px;background:#f8f5ef"></section>
<section style="height:1400px;background:#f8f5ef;position:relative">
<div style="position:absolute;left:960px;top:20px;width:900px;height:540px;background:radial-gradient(circle at 38% 32%,#d97848 0 110px,transparent 190px),linear-gradient(160deg,#3f6f8a,#1d3a4a)"></div>
<div style="position:absolute;left:1000px;top:20px;width:16px;height:180px;background:#fff"></div>
<div style="position:absolute;left:1048px;top:20px;width:16px;height:180px;background:#fff"></div>
<div style="position:absolute;left:1096px;top:20px;width:16px;height:180px;background:#fff"></div>
<div style="position:absolute;left:1144px;top:20px;width:16px;height:180px;background:#fff"></div>
<div style="position:absolute;left:700px;top:480px;width:280px;height:44px;background:#ff5c38;border-radius:999px"></div>
<div style="position:absolute;left:960px;top:660px;width:900px;height:540px;background:radial-gradient(circle at 38% 32%,#d97848 0 110px,transparent 190px),linear-gradient(160deg,#3f6f8a,#1d3a4a)"></div>
<div style="position:absolute;left:700px;top:1120px;width:280px;height:44px;background:#ff5c38;border-radius:999px"></div>
</section>
<section style="height:400px;background:#f8f5ef"></section>
</body></html>`

            response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
            response.end(html)
            return
        }

        if (tallCardBelt) {
            const html = `<!doctype html>
<html lang="zh-Hant">
<head><meta charset="utf-8"><title>Tall Card Belt Fixture</title></head>
<body style="margin:0;background:#f8f5ef">
<section style="height:3240px;background:#f8f5ef"></section>
<section style="height:1080px;background:#f8f5ef;position:relative">
<div style="position:absolute;left:960px;top:40px;width:900px;height:500px;background:radial-gradient(circle at 38% 32%,#d97848 0 110px,transparent 190px),linear-gradient(160deg,#3f6f8a,#1d3a4a)"></div>
<div style="position:absolute;left:960px;top:540px;width:900px;height:140px;background-image:repeating-linear-gradient(90deg,#22c55e 0 40px,#15803d 40px 80px),repeating-linear-gradient(180deg,transparent 0 16px,rgba(0,0,0,0.28) 16px 32px)"></div>
<div style="position:absolute;left:960px;top:692px;width:900px;height:140px;background-image:repeating-linear-gradient(90deg,#22c55e 0 40px,#15803d 40px 80px),repeating-linear-gradient(180deg,transparent 0 16px,rgba(0,0,0,0.28) 16px 32px)"></div>
<div style="position:absolute;left:700px;top:728px;width:400px;height:48px;background:#ff5c38;border-radius:999px"></div>
</section>
<section style="height:1080px;background:#f8f5ef;position:relative">
<div style="position:absolute;left:80px;top:40px;width:820px;height:520px;background:radial-gradient(circle at 60% 40%,#8a3f6f 0 120px,transparent 200px),linear-gradient(40deg,#4a2d55,#1d3a4a)"></div>
</section>
<section style="height:1080px;background:#f8f5ef"></section>
</body></html>`

            response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
            response.end(html)
            return
        }

        if (cardBelt) {
            const html = `<!doctype html>
<html lang="zh-Hant">
<head><meta charset="utf-8"><title>Card Belt Fixture</title></head>
<body style="margin:0;background:#f8f5ef">
<section style="height:1080px;background:#315ceb"></section>
<section style="height:1080px;background:#f8f5ef;position:relative">
<div style="position:absolute;left:960px;top:40px;width:900px;height:500px;background:radial-gradient(circle at 38% 32%,#d97848 0 110px,transparent 190px),linear-gradient(160deg,#3f6f8a,#1d3a4a)"></div>
<div style="position:absolute;left:960px;top:540px;width:900px;height:140px;background-image:repeating-linear-gradient(90deg,#22c55e 0 40px,#15803d 40px 80px),repeating-linear-gradient(180deg,transparent 0 16px,rgba(0,0,0,0.28) 16px 32px)"></div>
<div style="position:absolute;left:960px;top:680px;width:900px;height:140px;background-image:repeating-linear-gradient(90deg,#22c55e 0 40px,#15803d 40px 80px),repeating-linear-gradient(180deg,transparent 0 16px,rgba(0,0,0,0.28) 16px 32px)"></div>
<div style="position:absolute;left:1000px;top:690px;width:220px;height:40px;background:#ff5c38;border-radius:999px"></div>
</section>
</body></html>`

            response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
            response.end(html)
            return
        }

        if (photoBelt) {
            const html = `<!doctype html>
<html lang="zh-Hant">
<head><meta charset="utf-8"><title>Photo Belt Fixture</title></head>
<body style="margin:0">
<section style="height:1080px;background:#f8f5ef"></section>
<section style="height:900px;background:#f8f5ef">
<div style="position:sticky;top:0;height:800px">
<div style="height:400px;background:#22c55e"></div>
<div style="height:400px;background-image:repeating-linear-gradient(90deg,#22c55e 0 40px,#15803d 40px 80px)"></div>
</div>
</section>
<section style="height:1080px;background:#315ceb"></section>
</body></html>`

            response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
            response.end(html)
            return
        }

        if (pinnedCanvas) {
            const html = `<!doctype html>
<html lang="zh-Hant">
<head><meta charset="utf-8"><title>Pinned Canvas Fixture</title></head>
<body style="margin:0">
<div id="canvas" style="position:fixed;inset:0;overflow:hidden;z-index:0">
<div style="height:400px;background-image:repeating-linear-gradient(90deg,#22c55e 0 40px,#15803d 40px 80px)"></div>
<div id="tail" style="height:680px;background:#315ceb"></div>
</div>
<div style="height:3240px"></div>
<script>addEventListener('scroll',()=>{document.querySelector('#tail').style.background=scrollY>200?'#dc2626':'#315ceb'})</script>
</body></html>`

            response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
            response.end(html)
            return
        }

        if (heroReveal) {
            const html = `<!doctype html>
<html lang="zh-Hant">
<head><meta charset="utf-8"><title>Hero Reveal Fixture</title></head>
<body style="margin:0">
<main id="hero" style="min-height:2200px;background:#dc2626"></main>
<script>
let atTop=true
const startHero=()=>{
    const hero=document.querySelector('#hero')
    hero.style.transition='none'
    hero.style.background='#dc2626'
    hero.getBoundingClientRect()
    hero.style.transition='background-color 1.6s linear'
    hero.style.background='#22c55e'
}
startHero()
addEventListener('scroll',()=>{
    const nowAtTop=scrollY<8
    if(nowAtTop && !atTop) startHero()
    atTop=nowAtTop
})
</script>
</body></html>`

            response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
            response.end(html)
            return
        }

        if (stickyNav) {
            const html = `<!doctype html>
<html lang="zh-Hant">
<head><meta charset="utf-8"><title>Sticky Nav Fixture</title></head>
<body style="margin:0">
<div id="canvas" style="position:fixed;inset:0;background:#315ceb;z-index:0"></div>
<header style="position:sticky;top:0;height:60px;width:100%;background:#dc2626;z-index:2"></header>
<div style="height:3240px;position:relative;z-index:1"></div>
<script>addEventListener('scroll',()=>{document.querySelector('#canvas').style.background=scrollY>0?'#22c55e':'#315ceb'})</script>
</body></html>`

            response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
            response.end(html)
            return
        }

        if (settledBlock) {
            const html = `<!doctype html>
<html lang="zh-Hant">
<head><meta charset="utf-8"><title>Settled Block Fixture</title></head>
<body style="margin:0">
<section style="height:1080px;background:#315ceb"></section>
<section id="revealed" style="height:1080px;background:#dc2626"></section>
<script>
let revealTimer
addEventListener('scroll',()=>{
    clearTimeout(revealTimer)
    const revealed=document.querySelector('#revealed')
    revealed.style.background='#dc2626'
    if(scrollY>=800) revealTimer=setTimeout(()=>{revealed.style.background='#22c55e'},600)
})
</script>
</body></html>`

            response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
            response.end(html)
            return
        }

        if (repeatedCanvas) {
            const html = `<!doctype html>
<html lang="zh-Hant">
<head><meta charset="utf-8"><title>Repeated Canvas Fixture</title></head>
<body style="margin:0">
<div id="canvas" style="position:fixed;inset:0;background:#315ceb"></div>
<div style="height:3240px"></div>
<script>addEventListener('scroll',()=>{document.querySelector('#canvas').style.background=scrollY>=1080?'#22c55e':'#315ceb'})</script>
</body></html>`

            response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
            response.end(html)
            return
        }

        const changed = parameters.has('variant')
        const lazy = parameters.has('lazy')
        const fixedCanvas = parameters.has('fixedCanvas')
        const oversized = parameters.has('oversized')
        const scrollScene = parameters.has('scrollScene')
        const background = changed ? '#102a43' : '#f2efe8'
        const foreground = changed ? '#f7c948' : '#18212b'
        const lazySection = lazy
            ? '<section id="lazy-section" style="height:500px;margin-top:1200px;background:#ffffff"></section><script>addEventListener(\'scroll\',()=>{document.querySelector(\'#lazy-section\').style.background=\'#12b57a\'},{once:true})</script>'
            : ''
        const scrollSceneSection = scrollScene
            ? `<section style="height:3240px;background:#fff"><div style="position:sticky;top:0;height:1080px;background:#315ceb"></div></section>
<div style="position:fixed;right:20px;top:100px;width:50px;height:50px;background:#dc2626"></div>`
            : ''
        const fixedCanvasSection = fixedCanvas
            ? `<div id="fixed-canvas" style="position:fixed;inset:0;background:#315ceb"></div>
<div style="height:3240px"></div>
<script>addEventListener('scroll',()=>{document.querySelector('#fixed-canvas').style.background=scrollY>=1080?'#22c55e':'#315ceb'})</script>`
            : ''
        const minimumHeight = oversized ? '90000px' : '2200px'
        const html = `<!doctype html>
<html lang="zh-Hant">
<head><meta charset="utf-8"><title>SiteSensory Fixture</title></head>
<body style="margin:0;background:${background};color:${foreground};font-family:Arial,sans-serif">
<main style="min-height:${minimumHeight};padding:120px"><h1 style="font-size:96px">設計案例</h1>
<a href="/about/">關於我們</a><a href="/about?utm_source=test">重複連結</a>
<a href="/login">登入</a><a href="https://outside.example/page">外站</a>${lazySection}${scrollSceneSection}${fixedCanvasSection}</main>
</body></html>`

        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        response.end(html)
    })
}

/**
 * 從 PNG IHDR 讀取圖片尺寸，不另外依賴影像套件。
 *
 * @param image PNG 檔案內容。
 * @returns 圖片寬高。
 */
function readPngSize(image: Buffer): { height: number, width: number }
{
    return {
        height: image.readUInt32BE(20),
        width: image.readUInt32BE(16),
    }
}

/**
 * 讀取 PNG 指定座標的 RGB 像素，供截圖內容斷言使用。
 *
 * @param image PNG 檔案內容。
 * @param left 水平座標。
 * @param top 垂直座標。
 * @returns 該點的 RGB 值。
 */
async function samplePixel(image: Buffer, left: number, top: number): Promise<number[]>
{
    const pixel = await sharp(image)
        .extract({ height: 1, left, top, width: 1 })
        .removeAlpha()
        .raw()
        .toBuffer()

    return [...pixel]
}
