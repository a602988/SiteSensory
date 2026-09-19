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

describe('capture worker', { timeout: 20_000 }, () => {
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
    })

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
    }, 15_000)

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
