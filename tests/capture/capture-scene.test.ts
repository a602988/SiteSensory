import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import {
    isSamePinnedScene,
    looksLikeFullColumnWipe,
    looksLikeVerticalWipe,
    rowSliceVariance,
    trimDuplicateScenePrefix,
    trimRepeatedTailBand,
} from '../../apps/capture-worker/src/capture.js'

const WIDTH = 1920
const SETTLE_WIDTH = 192
const SETTLE_HEIGHT = 108

describe('capture scene heuristics', { timeout: 15_000 }, () => {
    it('treats a saturated solid color as zero spatial variance', () => {
        const slice = Buffer.alloc(SETTLE_WIDTH * 8 * 3)

        for (let index = 0; index < slice.length; index += 3) {
            slice[index] = 34
            slice[index + 1] = 197
            slice[index + 2] = 94
        }

        expect(rowSliceVariance(slice)).toBeLessThan(0.002)
        expect(channelSpreadVariance(slice)).toBeGreaterThan(0.2)
    })

    it('does not trim a solid saturated continuation that old channel variance would cut', async () => {
        const previous = await solidPng('#22c55e', 1080)
        const next = await solidPng('#22c55e', 864)
        const trimmed = await trimDuplicateScenePrefix(previous, next, WIDTH)
        const metadata = await sharp(trimmed).metadata()

        expect(metadata.height).toBe(864)
        expect(channelSpreadVariance(await rawWindow(next, 864))).toBeGreaterThan(0.2)
    })

    it('keeps a continuing high-detail scene that fills reserved height', async () => {
        const scene = await panelPng('#315ceb', 864)
        const previous = await stackPngs([
            await solidPng('#f2efe8', 216),
            scene,
        ])
        const trimmed = await trimDuplicateScenePrefix(previous, scene, WIDTH)
        const metadata = await sharp(trimmed).metadata()

        expect(metadata.height).toBe(864)
    })

    it('drops a leftover scrap after a mostly-duplicate photo segment', async () => {
        const photo = await stackPngs([
            await stripePng(400),
            await panelPng('#315ceb', 464),
        ])

        await expect(trimDuplicateScenePrefix(photo, photo, WIDTH)).resolves.toBeNull()
    })

    it('trims a repeated horizontal photo belt from the bottom of one segment', async () => {
        const belt = await photoBeltPng(200)
        const stacked = await stackPngs([
            await uniquePhotoPng(400),
            belt,
            belt,
        ])
        const trimmed = await trimRepeatedTailBand(stacked, WIDTH)
        const metadata = await sharp(trimmed).metadata()

        expect(metadata.height).toBeLessThan(750)
        expect(metadata.height).toBeGreaterThan(500)
        expect(await sampleRgb(trimmed, 20, 200)).not.toEqual(await sampleRgb(trimmed, 20, 500))
    })

    it('trims a ~1/5 belt on a photo card that old full-segment tail compare misses', async () => {
        const card = await photoCardWithCaptionBelt()
        const legacy = await legacyFullSegmentTailTrim(card)
        const trimmed = await trimRepeatedTailBand(card, WIDTH)
        const legacyHeight = (await sharp(legacy).metadata()).height ?? 0
        const trimmedHeight = (await sharp(trimmed).metadata()).height ?? 0

        expect(legacyHeight).toBe(1080)
        expect(trimmedHeight).toBeLessThan(1000)
        expect(trimmedHeight).toBeGreaterThan(850)
        expect(await sampleRgb(trimmed, 1400, 200)).not.toEqual([248, 245, 239])
        expect(await sampleRgb(trimmed, 1400, 800)).toEqual([248, 245, 239])
    })

    it('does not trim a finished flat photo card sitting on a light page', async () => {
        const page = await stackPngs([
            await solidPng('#315ceb', 1080),
            await flatPhotoCardOnCream(),
        ])
        const trimmed = await trimRepeatedTailBand(page, WIDTH)

        expect((await sharp(trimmed).metadata()).height).toBe(2160)
        expect(await sampleRgb(trimmed, 200, 1500)).toEqual([34, 197, 94])
    })

    it('trims a mid-page ~1/5 belt on a tall stitch that narrow-offset scan misses', async () => {
        const page = await tallStitchCardBelt()
        const legacy = await legacyNarrowOffsetBeltTrim(page)
        const trimmed = await trimRepeatedTailBand(page, WIDTH)
        const legacyHeight = (await sharp(legacy).metadata()).height ?? 0
        const trimmedHeight = (await sharp(trimmed).metadata()).height ?? 0

        expect(legacyHeight).toBe(6480)
        expect(trimmedHeight).toBeLessThan(6360)
        expect(trimmedHeight).toBeGreaterThan(6100)
        expect(await sampleRgb(trimmed, 1400, 4500)).not.toEqual([248, 245, 239])
        expect(await sampleRgb(trimmed, 200, 5600)).not.toEqual([248, 245, 239])
    }, 40_000)

    it('trims a stacked full card whose upper copy still has wipe bars', async () => {
        const page = await stackedCardWithWipe()
        const legacy = await legacyNarrowOffsetBeltTrim(page)
        const trimmed = await trimRepeatedTailBand(page, WIDTH)
        const legacyHeight = (await sharp(legacy).metadata()).height ?? 0
        const trimmedHeight = (await sharp(trimmed).metadata()).height ?? 0

        expect(legacyHeight).toBe(1560)
        expect(trimmedHeight).toBeLessThan(1100)
        expect(trimmedHeight).toBeGreaterThan(800)
        expect(await sampleRgb(trimmed, 1400, 300)).not.toEqual([255, 255, 255])
        expect(await sampleRgb(trimmed, 1400, 300)).not.toEqual([248, 245, 239])
    })

    it('trims a mid-page stacked wipe card on a tall stitch that 3×-window scan misses', async () => {
        const page = await tallStackedCardWithWipe()
        const legacy = await legacyNarrowOffsetBeltTrim(page)
        const trimmed = await trimRepeatedTailBand(page, WIDTH)
        const legacyHeight = (await sharp(legacy).metadata()).height ?? 0
        const trimmedHeight = (await sharp(trimmed).metadata()).height ?? 0

        expect(legacyHeight).toBe(6760)
        expect(trimmedHeight).toBeLessThan(6400)
        expect(trimmedHeight).toBeGreaterThan(5600)
        expect(await sampleRgb(trimmed, 1400, 4200)).not.toEqual([255, 255, 255])
        expect(await sampleRgb(trimmed, 1400, 4200)).not.toEqual([248, 245, 239])
        expect(await sampleRgb(trimmed, 200, 4800)).not.toEqual([248, 245, 239])
    }, 40_000)

    it('trims a clean card prefix that only matches the previous wiped copy', async () => {
        const previous = await festivalCardPng({ wipe: true })
        const next = await stackPngs([
            await festivalCardPng({ wipe: false }),
            await nextPhotoCardOnCream(),
        ])
        const trimmed = await trimDuplicateScenePrefix(previous, next, WIDTH)

        expect(trimmed).not.toBeNull()

        const trimmedHeight = (await sharp(trimmed!).metadata()).height ?? 0

        expect(trimmedHeight).toBeLessThan(1100)
        expect(trimmedHeight).toBeGreaterThan(900)
        expect(await sampleRgb(trimmed!, 200, 200)).not.toEqual([248, 245, 239])
    })

    it('trims a virtual-canvas wipe viewport stacked on its clean copy', async () => {
        const page = await canvasWipeStackViewports()
        const legacy = await legacyNarrowOffsetBeltTrim(page)
        const trimmed = await trimRepeatedTailBand(page, WIDTH, { viewportTiles: true })
        const legacyHeight = (await sharp(legacy).metadata()).height ?? 0
        const trimmedHeight = (await sharp(trimmed).metadata()).height ?? 0

        expect(legacyHeight).toBe(3240)
        expect(trimmedHeight).toBeLessThan(2400)
        expect(trimmedHeight).toBeGreaterThan(1900)
        expect(await sampleRgb(trimmed, 200, 200)).not.toEqual([255, 255, 255])
        expect(await sampleRgb(trimmed, 200, 200)).not.toEqual([248, 245, 239])
        expect(await sampleRgb(trimmed, 200, 1200)).not.toEqual([248, 245, 239])
    })

    it('trims a 12k canvas-style wipe stack in a few seconds', async () => {
        const page = await tallCanvasWipeStack()
        const started = Date.now()
        const trimmed = await trimRepeatedTailBand(page, WIDTH, { viewportTiles: true })
        const elapsed = Date.now() - started
        const trimmedHeight = (await sharp(trimmed).metadata()).height ?? 0

        expect(elapsed).toBeLessThan(12_000)
        expect(trimmedHeight).toBeLessThan(10_800)
        expect(trimmedHeight).toBeGreaterThan(9000)
        expect(await sampleRgb(trimmed, 200, 4200)).not.toEqual([255, 255, 255])
        expect(await sampleRgb(trimmed, 200, 4200)).not.toEqual([248, 245, 239])
    }, 20_000)

    it('trims a mid-page 1080 faint-wipe stack that coarse bar detection misses', async () => {
        const page = await midPageFaintWipeStack()
        const legacy = await legacyNarrowOffsetBeltTrim(page)
        const trimmed = await trimRepeatedTailBand(page, WIDTH, { viewportTiles: true })
        const legacyHeight = (await sharp(legacy).metadata()).height ?? 0
        const trimmedHeight = (await sharp(trimmed).metadata()).height ?? 0

        expect(legacyHeight).toBe(4320)
        expect(trimmedHeight).toBeLessThan(3500)
        expect(trimmedHeight).toBeGreaterThan(3000)
        expect(await sampleRgb(trimmed, 200, 200)).not.toEqual([248, 245, 239])
        expect(await sampleRgb(trimmed, 220, 1120)).not.toEqual([255, 255, 255])
        expect(await sampleRgb(trimmed, 200, 1120)).not.toEqual([248, 245, 239])
        expect(await sampleRgb(trimmed, 1400, 2300)).not.toEqual([248, 245, 239])
    })

    it('trims a live-like canvas extract: wipe viewport, clean copy, then a 18px foot belt', async () => {
        const page = await liveLikeCanvasExtract()
        const started = Date.now()
        const trimmed = await trimRepeatedTailBand(page, WIDTH, { viewportTiles: true })
        const elapsed = Date.now() - started
        const trimmedHeight = (await sharp(trimmed).metadata()).height ?? 0

        expect(elapsed).toBeLessThan(8_000)
        expect(trimmedHeight).toBeLessThan(2300)
        expect(trimmedHeight).toBeGreaterThan(1900)
        expect(await sampleRgb(trimmed, 200, 200)).not.toEqual([255, 255, 255])
        expect(await sampleRgb(trimmed, 200, 200)).not.toEqual([248, 245, 239])
        expect(await sampleRgb(trimmed, 1400, 1200)).not.toEqual([248, 245, 239])
        expect(await sampleRgb(trimmed, 1400, trimmedHeight - 80)).toEqual([248, 245, 239])
    })

    it('trims an offset live-like wipe stack that aligned 1080 tiles miss', async () => {
        const page = await liveOffsetWipeStack()
        const sourceHeight = (await sharp(page).metadata()).height ?? 0
        const started = Date.now()
        const trimmed = await trimRepeatedTailBand(page, WIDTH, { viewportTiles: true })
        const elapsed = Date.now() - started
        const trimmedHeight = (await sharp(trimmed).metadata()).height ?? 0

        expect(sourceHeight).toBe(7062)
        expect(3822 % 1080).toBe(582)
        expect(elapsed).toBeLessThan(12_000)
        expect(trimmedHeight).toBeLessThan(6000)
        expect(trimmedHeight).toBeGreaterThan(4800)
        expect(await sampleRgb(page, 220, 3900)).toEqual([255, 255, 255])
        expect(await sampleRgb(trimmed, 220, 3900)).not.toEqual([255, 255, 255])
        expect(await sampleRgb(trimmed, 200, 3900)).not.toEqual([248, 245, 239])
        expect(await sampleRgb(trimmed, 200, trimmedHeight - 40)).toEqual([248, 245, 239])
    }, 20_000)

    it('trims a dense venetian wipe stack whose strict 0.012 no-wipe gate used to keep the wipe', async () => {
        const page = await liveVenetianOffsetStack()
        const sourceHeight = (await sharp(page).metadata()).height ?? 0
        const started = Date.now()
        const trimmed = await trimRepeatedTailBand(page, WIDTH, { viewportTiles: true })
        const elapsed = Date.now() - started
        const trimmedHeight = (await sharp(trimmed).metadata()).height ?? 0

        expect(sourceHeight).toBe(7062)
        expect(await legacyStrictWipeGateKeeps(page, 3822)).toBe(true)
        expect(elapsed).toBeLessThan(12_000)
        expect(trimmedHeight).toBeLessThan(6000)
        expect(trimmedHeight).toBeGreaterThan(5800)
        expect(await sampleRgb(page, 112, 3900)).toEqual([255, 255, 255])
        expect(await sampleRgb(page, 1400, 3600)).not.toEqual([248, 245, 239])
        expect(await sampleRgb(page, 1400, 3600)).not.toEqual([255, 255, 255])
        expect(await sampleRgb(trimmed, 1400, 3600)).not.toEqual([248, 245, 239])
        expect(await sampleRgb(trimmed, 1400, 3600)).not.toEqual([255, 255, 255])
        expect(await sampleRgb(trimmed, 112, 3900)).not.toEqual([255, 255, 255])
        expect(await sampleRgb(trimmed, 200, 3900)).not.toEqual([248, 245, 239])
        expect(await sampleRgb(trimmed, 200, 4300)).not.toEqual([248, 245, 239])
        expect(await sampleRgb(trimmed, 200, trimmedHeight - 40)).toEqual([248, 245, 239])
    }, 20_000)

    it('trims a live-like wide upper wipe whose top-right still has the previous fashion remnant', async () => {
        const page = await liveFashionRemnantWideWipeStack()
        const sourceHeight = (await sharp(page).metadata()).height ?? 0
        const trimmed = await trimRepeatedTailBand(page, WIDTH, { viewportTiles: true })
        const trimmedHeight = (await sharp(trimmed).metadata()).height ?? 0

        expect(sourceHeight).toBe(7062)
        expect(await sampleRgb(page, 150, 4000)).toEqual([255, 255, 255])
        expect(await sampleRgb(page, 1400, 3860)).not.toEqual([248, 245, 239])
        expect(trimmedHeight).toBeLessThan(6100)
        expect(trimmedHeight).toBeGreaterThan(5600)
        expect(await sampleRgb(trimmed, 1400, 3600)).not.toEqual([248, 245, 239])
        expect(await sampleRgb(trimmed, 150, 4000)).not.toEqual([255, 255, 255])
        expect(await sampleRgb(trimmed, 200, 4000)).not.toEqual([248, 245, 239])
        expect(await sampleRgb(trimmed, 200, trimmedHeight - 8)).toEqual([248, 245, 239])
    }, 20_000)

    it('trims a dark right-photo foot belt that strict above-luma skip would keep', async () => {
        const page = await darkRightPhotoFootBeltPage()
        const sourceHeight = (await sharp(page).metadata()).height ?? 0
        const trimmed = await trimRepeatedTailBand(page, WIDTH)
        const trimmedHeight = (await sharp(trimmed).metadata()).height ?? 0

        expect(sourceHeight).toBe(2160)
        expect(trimmedHeight).toBeLessThan(2150)
        expect(trimmedHeight).toBeGreaterThan(2000)
        expect(await sampleRgb(trimmed, 1400, 1200)).not.toEqual([248, 245, 239])
        expect(await sampleRgb(trimmed, 200, trimmedHeight - 8)).toEqual([248, 245, 239])
    })

    it('trims a left wallpaper 16px foot belt on a mid-page card', async () => {
        const page = await stackPngs([
            await solidPng('#f8f5ef', 1080),
            await leftWallpaperFootBelt(),
        ])
        const trimmed = await trimRepeatedTailBand(page, WIDTH)
        const trimmedHeight = (await sharp(trimmed).metadata()).height ?? 0

        expect(trimmedHeight).toBeLessThan(2150)
        expect(trimmedHeight).toBeGreaterThan(2000)
        expect(await sampleRgb(trimmed, 200, 1200)).not.toEqual([248, 245, 239])
        expect(await sampleRgb(trimmed, 200, trimmedHeight - 8)).toEqual([248, 245, 239])
    })

    it('trims a left-photo wipe stack that sits under another portfolio card', async () => {
        const page = await portfolioStackedWipeCard()
        const legacy = await legacyNarrowOffsetBeltTrim(page)
        const trimmed = await trimRepeatedTailBand(page, WIDTH)
        const legacyHeight = (await sharp(legacy).metadata()).height ?? 0
        const trimmedHeight = (await sharp(trimmed).metadata()).height ?? 0

        expect(legacyHeight).toBe(2560)
        expect(trimmedHeight).toBeLessThan(2100)
        expect(trimmedHeight).toBeGreaterThan(1700)
        expect(await sampleRgb(trimmed, 200, 200)).not.toEqual([248, 245, 239])
        expect(await sampleRgb(trimmed, 200, 1280)).not.toEqual([255, 255, 255])
        expect(await sampleRgb(trimmed, 200, 1280)).not.toEqual([248, 245, 239])
    })

    it('trims a right-photo 16px head/CTA foot belt on a mid-page canvas tile', async () => {
        const page = await midPageRightPhotoBelt()
        const trimmed = await trimRepeatedTailBand(page, WIDTH, { viewportTiles: true })
        const trimmedHeight = (await sharp(trimmed).metadata()).height ?? 0

        expect(trimmedHeight).toBeLessThan(2150)
        expect(trimmedHeight).toBeGreaterThan(2000)
        expect(await sampleRgb(trimmed, 1400, 1200)).not.toEqual([248, 245, 239])
        expect(await sampleRgb(trimmed, 1400, trimmedHeight - 40)).toEqual([248, 245, 239])
    })

    it('trims an 18px photo-foot belt whose orange CTA top edge is also repeated', async () => {
        const page = await photoFootBeltWithCta()
        const legacy = await legacyNarrowOffsetBeltTrim(page)
        const trimmed = await trimRepeatedTailBand(page, WIDTH)
        const legacyHeight = (await sharp(legacy).metadata()).height ?? 0
        const trimmedHeight = (await sharp(trimmed).metadata()).height ?? 0

        expect(legacyHeight).toBe(5760)
        expect(trimmedHeight).toBeLessThan(5748)
        expect(trimmedHeight).toBeGreaterThan(5600)
        expect(await sampleRgb(trimmed, 1400, 3800)).not.toEqual([248, 245, 239])
        expect(await sampleRgb(trimmed, 1400, 3700)).not.toEqual([255, 92, 56])
    }, 40_000)

    it('trims a 16px offset belt sitting under a full blue viewport', async () => {
        const page = await stackPngs([
            await solidPng('#315ceb', 1080),
            await thinOffsetBeltCard(),
        ])
        const trimmed = await trimRepeatedTailBand(page, WIDTH)
        const trimmedHeight = (await sharp(trimmed).metadata()).height ?? 0

        expect(trimmedHeight).toBeLessThan(2150)
        expect(trimmedHeight).toBeGreaterThan(2000)
    })

    it('trims a 16px offset belt that viewport-scale 48px scan misses', async () => {
        const page = await thinOffsetBeltCard()
        const legacy = await legacyNarrowOffsetBeltTrim(page)
        const trimmed = await trimRepeatedTailBand(page, WIDTH)
        const legacyHeight = (await sharp(legacy).metadata()).height ?? 0
        const trimmedHeight = (await sharp(trimmed).metadata()).height ?? 0

        expect(legacyHeight).toBe(1080)
        expect(trimmedHeight).toBeLessThan(1070)
        expect(trimmedHeight).toBeGreaterThan(1000)
        expect(await sampleRgb(trimmed, 1400, 200)).not.toEqual([248, 245, 239])
        expect(await sampleRgb(trimmed, 1400, trimmedHeight - 80)).toEqual([248, 245, 239])
    })

    it('does not trim a unique photo card that has no repeated belt', async () => {
        const card = await photoCardWithCaptionBelt({ repeatBelt: false })
        const trimmed = await trimRepeatedTailBand(card, WIDTH)

        expect((await sharp(trimmed).metadata()).height).toBe(1080)
        expect(await sampleRgb(trimmed, 1400, 700)).not.toEqual([248, 245, 239])
    })

    it('trims a repeated high-detail sticky band from the next segment', async () => {
        const band = await stripePng(400)
        const previous = await stackPngs([
            await solidPng('#315ceb', 680),
            band,
        ])
        const next = await stackPngs([
            band,
            await solidPng('#f8f5ef', 464),
        ])
        const trimmed = await trimDuplicateScenePrefix(previous, next, WIDTH)
        const metadata = await sharp(trimmed).metadata()
        const top = await sampleRgb(trimmed, 20, 10)

        expect(metadata.height).toBeLessThan(500)
        expect(top).toEqual([248, 245, 239])
    })

    it('detects held white wipe bars over mid-tone content', async () => {
        const signature = await createSettleSignature(await photoWithWipeBars())

        expect(looksLikeVerticalWipe(signature, SETTLE_WIDTH, SETTLE_HEIGHT)).toBe(true)
    })

    it('detects bright bars that only interrupt the top of a photo card', async () => {
        const signature = await createSettleSignature(await photoCardWithPartialWipeBars())

        expect(looksLikeFullColumnWipe(signature, SETTLE_WIDTH, SETTLE_HEIGHT)).toBe(false)
        expect(looksLikeVerticalWipe(signature, SETTLE_WIDTH, SETTLE_HEIGHT)).toBe(true)
    })

    it('does not treat a finished photo card on a white page as a wipe', async () => {
        const signature = await createSettleSignature(await photoCardWithPartialWipeBars({ bars: false }))

        expect(looksLikeVerticalWipe(signature, SETTLE_WIDTH, SETTLE_HEIGHT)).toBe(false)
        expect(looksLikeFullColumnWipe(signature, SETTLE_WIDTH, SETTLE_HEIGHT)).toBe(false)
    })

    it('detects wipe bars on a bright stage photo that mid-tone 45–175 neighbors miss', async () => {
        const signature = await createSettleSignature(await brightStageWithWipe())

        expect(countLegacyMidToneWipeSpikes(signature, SETTLE_WIDTH, SETTLE_HEIGHT)).toBeLessThan(3)
        expect(looksLikeVerticalWipe(signature, SETTLE_WIDTH, SETTLE_HEIGHT)).toBe(true)
    })

    it('still detects wipe bars on a dark wallpaper next to the page edge', async () => {
        const signature = await createSettleSignature(await darkWallpaperWithEdgeWipe())

        expect(looksLikeVerticalWipe(signature, SETTLE_WIDTH, SETTLE_HEIGHT)).toBe(true)
    })

    it('does not treat large dark type with page-color gaps as a wipe', async () => {
        const signature = await createSettleSignature(await headingOnCreamPng())

        expect(looksLikeVerticalWipe(signature, SETTLE_WIDTH, SETTLE_HEIGHT)).toBe(false)
    })

    it('does not treat a flat brand color or a light page grid as a wipe', async () => {
        const flat = await createSettleSignature(await solidPng('#22c55e', 1080))
        const grid = await createSettleSignature(await lightGridPng())

        expect(looksLikeVerticalWipe(flat, SETTLE_WIDTH, SETTLE_HEIGHT)).toBe(false)
        expect(looksLikeVerticalWipe(grid, SETTLE_WIDTH, SETTLE_HEIGHT)).toBe(false)
    })

    it('treats two pinned detailed tops as the same virtual-canvas scene', async () => {
        const top = await stripePng(400)
        const first = await stackPngs([top, await solidPng('#315ceb', 680)])
        const second = await stackPngs([top, await solidPng('#dc2626', 680)])

        await expect(isSamePinnedScene(first, second, WIDTH)).resolves.toBe(true)
        await expect(isSamePinnedScene(first, await solidPng('#22c55e', 1080), WIDTH)).resolves.toBe(false)
    })

    it('treats a wipe viewport and its clean copy as the same pinned scene', async () => {
        const wipe = await canvasViewportCard({ wipe: true })
        const clean = await canvasViewportCard({ wipe: false })
        const faint = await canvasViewportCard({ faintWipe: true })
        const venetian = await venetianFestivalViewport({ wipe: true })
        const venetianClean = await venetianFestivalViewport({ wipe: false })

        await expect(isSamePinnedScene(wipe, clean, WIDTH)).resolves.toBe(true)
        await expect(isSamePinnedScene(faint, clean, WIDTH)).resolves.toBe(true)
        await expect(isSamePinnedScene(venetian, venetianClean, WIDTH)).resolves.toBe(true)
        await expect(isSamePinnedScene(wipe, await nextPhotoCardOnCream(), WIDTH)).resolves.toBe(false)
    })

    it('does not collapse a panned canvas whose top has moved to new content', async () => {
        const first = await stackPngs([
            await stripePng(400),
            await solidPng('#315ceb', 680),
        ])
        const second = await stackPngs([
            await solidPng('#315ceb', 400),
            await stripePng(400),
            await solidPng('#102a43', 280),
        ])

        await expect(isSamePinnedScene(first, second, WIDTH)).resolves.toBe(false)
    })
})

/**
 * 舊實作把 R／G／B 通道差當成變異，飽和純色會被誤判成高細節。
 *
 * @param slice RGB 列資料。
 * @returns 通道混在一起的正規化標準差。
 */
function channelSpreadVariance(slice: Buffer): number
{
    let mean = 0

    for (const value of slice) mean += value

    mean /= slice.length

    let total = 0

    for (const value of slice) total += (value - mean) ** 2

    return Math.sqrt(total / slice.length) / 255
}

async function solidPng(color: string, height: number): Promise<Buffer>
{
    return sharp({
        create: {
            background: color,
            channels: 3,
            height,
            width: WIDTH,
        },
    }).png().toBuffer()
}

async function panelPng(color: string, height: number): Promise<Buffer>
{
    const raw = Buffer.alloc(WIDTH * height * 3)
    const fill = color === '#315ceb' ? [49, 92, 235] : [34, 197, 94]

    for (let row = 0; row < height; row += 1) {
        for (let column = 0; column < WIDTH; column += 1) {
            const index = (row * WIDTH + column) * 3
            const inset = column >= 120 && column < WIDTH - 120

            raw[index] = inset ? fill[0] : 242
            raw[index + 1] = inset ? fill[1] : 239
            raw[index + 2] = inset ? fill[2] : 232
        }
    }

    return sharp(raw, { raw: { channels: 3, height, width: WIDTH } }).png().toBuffer()
}

function carnivalStageTexel(row: number, column: number): [number, number, number]
{
    const blob = Math.hypot(row - 260, column - 480)
    const light = 172 + Math.min(48, Math.floor(blob / 9)) + ((row * 3 + column * 5) % 19)
    const tint = Math.floor(blob / 55) % 3

    if (tint === 0) return [Math.min(236, light + 28), Math.max(96, light - 36), 78]
    if (tint === 1) return [92, Math.min(236, light + 16), Math.min(238, light + 22)]

    return [Math.min(230, light + 10), Math.min(224, light), 198]
}

function uniquePhotoTexel(row: number, column: number): [number, number, number]
{
    const blob = Math.hypot(row - 220, column - 1480)
    const stripe = Math.floor((row + column) / 90) % 2

    return [
        48 + Math.min(90, Math.floor(blob / 8)) + stripe * 18,
        36 + Math.floor(column / WIDTH * 110),
        70 + Math.floor(row / 12) % 50,
    ]
}

function beltTexel(row: number, column: number): [number, number, number]
{
    const blob = Math.hypot(column - 1400, row - 70)
    const stripe = Math.floor(column / 50) % 2

    return [
        24 + (stripe ? 48 : 0) + Math.min(70, Math.floor(blob / 4)),
        90 + Math.floor(row / 2) + (stripe ? 24 : 0),
        40 + Math.floor(Math.abs(column - 1400) / 16) % 80,
    ]
}

async function flatPhotoCardOnCream(): Promise<Buffer>
{
    const raw = Buffer.alloc(WIDTH * 1080 * 3)

    for (let row = 0; row < 1080; row += 1) {
        for (let column = 0; column < WIDTH; column += 1) {
            const index = (row * WIDTH + column) * 3
            const inPhoto = column >= 80 && column < 900 && row >= 120 && row < 640

            if (inPhoto) {
                raw[index] = 34
                raw[index + 1] = 197
                raw[index + 2] = 94
                continue
            }

            raw[index] = 245
            raw[index + 1] = 245
            raw[index + 2] = 247
        }
    }

    return sharp(raw, { raw: { channels: 3, height: 1080, width: WIDTH } }).png().toBuffer()
}

async function uniquePhotoPng(height: number): Promise<Buffer>
{
    const raw = Buffer.alloc(WIDTH * height * 3)

    for (let row = 0; row < height; row += 1) {
        for (let column = 0; column < WIDTH; column += 1) {
            const index = (row * WIDTH + column) * 3
            const sample = uniquePhotoTexel(row, column)

            raw[index] = sample[0]
            raw[index + 1] = sample[1]
            raw[index + 2] = sample[2]
        }
    }

    return sharp(raw, { raw: { channels: 3, height, width: WIDTH } }).png().toBuffer()
}

async function photoBeltPng(height: number): Promise<Buffer>
{
    const raw = Buffer.alloc(WIDTH * height * 3)

    for (let row = 0; row < height; row += 1) {
        for (let column = 0; column < WIDTH; column += 1) {
            const index = (row * WIDTH + column) * 3
            const sample = beltTexel(row, column)

            raw[index] = sample[0]
            raw[index + 1] = sample[1]
            raw[index + 2] = sample[2]
        }
    }

    return sharp(raw, { raw: { channels: 3, height, width: WIDTH } }).png().toBuffer()
}

async function stripePng(height: number): Promise<Buffer>
{
    const raw = Buffer.alloc(WIDTH * height * 3)

    for (let row = 0; row < height; row += 1) {
        for (let column = 0; column < WIDTH; column += 1) {
            const dark = Math.floor(column / 40) % 2 === 1
            const index = (row * WIDTH + column) * 3

            raw[index] = dark ? 21 : 34
            raw[index + 1] = dark ? 128 : 197
            raw[index + 2] = dark ? 61 : 94
        }
    }

    return sharp(raw, { raw: { channels: 3, height, width: WIDTH } }).png().toBuffer()
}

async function photoCardWithPartialWipeBars(options: { bars?: boolean } = {}): Promise<Buffer>
{
    const withBars = options.bars !== false
    const raw = Buffer.alloc(WIDTH * 1080 * 3)

    for (let row = 0; row < 1080; row += 1) {
        for (let column = 0; column < WIDTH; column += 1) {
            const index = (row * WIDTH + column) * 3
            const inPhoto = column >= 80 && column < 900 && row >= 180 && row < 700
            const inBarBand = inPhoto && row < 320
            const bar = withBars
                && inBarBand
                && column >= 120
                && (column - 120) % 48 < 16
                && column < 120 + 8 * 48

            if (bar) {
                raw[index] = 255
                raw[index + 1] = 255
                raw[index + 2] = 255
                continue
            }

            if (inPhoto) {
                raw[index] = 50 + ((row + column) % 60)
                raw[index + 1] = 70 + ((row * 2 + column) % 70)
                raw[index + 2] = 90 + ((row * 3 + column * 2) % 80)
                continue
            }

            raw[index] = 245
            raw[index + 1] = 245
            raw[index + 2] = 247
        }
    }

    return sharp(raw, { raw: { channels: 3, height: 1080, width: WIDTH } }).png().toBuffer()
}

async function photoWithWipeBars(): Promise<Buffer>
{
    const raw = Buffer.alloc(WIDTH * 1080 * 3)

    for (let row = 0; row < 1080; row += 1) {
        for (let column = 0; column < WIDTH; column += 1) {
            const index = (row * WIDTH + column) * 3
            const bar = column >= 400 && (column - 400) % 48 < 20 && column < 400 + 8 * 48

            if (bar) {
                raw[index] = 255
                raw[index + 1] = 255
                raw[index + 2] = 255
                continue
            }

            raw[index] = 40 + ((row + column) % 70)
            raw[index + 1] = 55 + ((row * 3 + column) % 80)
            raw[index + 2] = 70 + ((row * 2 + column * 5) % 90)
        }
    }

    return sharp(raw, { raw: { channels: 3, height: 1080, width: WIDTH } }).png().toBuffer()
}

async function headingOnCreamPng(): Promise<Buffer>
{
    const raw = Buffer.alloc(WIDTH * 1080 * 3)

    for (let row = 0; row < 1080; row += 1) {
        for (let column = 0; column < WIDTH; column += 1) {
            const index = (row * WIDTH + column) * 3
            const inGlyph = row >= 200 && row < 360 && (column + 40) % 90 < 48

            raw[index] = inGlyph ? 24 : 242
            raw[index + 1] = inGlyph ? 33 : 239
            raw[index + 2] = inGlyph ? 43 : 232
        }
    }

    return sharp(raw, { raw: { channels: 3, height: 1080, width: WIDTH } }).png().toBuffer()
}

async function lightGridPng(): Promise<Buffer>
{
    const raw = Buffer.alloc(WIDTH * 1080 * 3)

    for (let row = 0; row < 1080; row += 1) {
        for (let column = 0; column < WIDTH; column += 1) {
            const index = (row * WIDTH + column) * 3
            const line = column % 80 === 0
            const tone = line ? 245 : 242

            raw[index] = tone
            raw[index + 1] = tone
            raw[index + 2] = tone - 2
        }
    }

    return sharp(raw, { raw: { channels: 3, height: 1080, width: WIDTH } }).png().toBuffer()
}

async function stackPngs(parts: Buffer[]): Promise<Buffer>
{
    let height = 0
    const overlays: sharp.OverlayOptions[] = []

    for (const part of parts) {
        const metadata = await sharp(part).metadata()
        const partHeight = metadata.height ?? 0

        overlays.push({ input: part, left: 0, top: height })
        height += partHeight
    }

    return sharp({
        create: {
            background: '#ffffff',
            channels: 3,
            height,
            width: WIDTH,
        },
    }).composite(overlays).png().toBuffer()
}

async function createSettleSignature(image: Buffer): Promise<Buffer>
{
    return sharp(image)
        .resize(SETTLE_WIDTH, SETTLE_HEIGHT, { fit: 'fill' })
        .removeAlpha()
        .raw()
        .toBuffer()
}

async function rawWindow(image: Buffer, height: number): Promise<Buffer>
{
    const rows = Math.max(1, Math.round(height * SETTLE_WIDTH / WIDTH))

    return sharp(image)
        .resize(SETTLE_WIDTH, rows, { fit: 'fill' })
        .removeAlpha()
        .raw()
        .toBuffer()
}

async function photoCardWithCaptionBelt(
    options: { beltGap?: number, beltHeight?: number, repeatBelt?: boolean } = {},
): Promise<Buffer>
{
    const repeatBelt = options.repeatBelt !== false
    const beltGap = options.beltGap ?? 0
    const beltHeight = options.beltHeight ?? 140
    const raw = Buffer.alloc(WIDTH * 1080 * 3)
    const firstBelt = 500
    const secondBelt = firstBelt + beltHeight + beltGap
    const photoBottom = secondBelt + beltHeight

    for (let row = 0; row < 1080; row += 1) {
        for (let column = 0; column < WIDTH; column += 1) {
            const index = (row * WIDTH + column) * 3
            const inPhoto = column >= 960 && column < 1860 && row >= 40 && row < photoBottom
            const inFirstBelt = repeatBelt && inPhoto && row >= firstBelt && row < firstBelt + beltHeight
            const inSecondBelt = repeatBelt && inPhoto && row >= secondBelt && row < secondBelt + beltHeight
            const inCta = inSecondBelt && column >= 700 && column < 1120 && row >= secondBelt + 36 && row < secondBelt + 88

            if (inCta) {
                raw[index] = 255
                raw[index + 1] = 92
                raw[index + 2] = 56
                continue
            }

            if (inFirstBelt || inSecondBelt) {
                const beltRow = row - (inSecondBelt ? secondBelt : firstBelt)
                const sample = beltTexel(beltRow, column)

                raw[index] = sample[0]
                raw[index + 1] = sample[1]
                raw[index + 2] = sample[2]
                continue
            }

            if (inPhoto) {
                const sample = uniquePhotoTexel(row, column)

                raw[index] = sample[0]
                raw[index + 1] = sample[1]
                raw[index + 2] = sample[2]
                continue
            }

            raw[index] = 248
            raw[index + 1] = 245
            raw[index + 2] = 239
        }
    }

    return sharp(raw, { raw: { channels: 3, height: 1080, width: WIDTH } }).png().toBuffer()
}

async function festivalCardPng(options: { wipe?: boolean } = {}): Promise<Buffer>
{
    const raw = Buffer.alloc(WIDTH * 640 * 3)

    for (let row = 0; row < 640; row += 1) {
        for (let column = 0; column < WIDTH; column += 1) {
            const index = (row * WIDTH + column) * 3
            const inPhoto = column >= 960 && column < 1860 && row >= 20 && row < 560
            const wipeColumn = options.wipe
                && inPhoto
                && row < 200
                && (column - 1000) % 48 < 16
                && column >= 1000
                && column < 1400

            if (wipeColumn) {
                raw[index] = 255
                raw[index + 1] = 255
                raw[index + 2] = 255
                continue
            }

            if (inPhoto) {
                const sample = uniquePhotoTexel(row, column)

                raw[index] = sample[0]
                raw[index + 1] = sample[1]
                raw[index + 2] = sample[2]
                continue
            }

            raw[index] = 248
            raw[index + 1] = 245
            raw[index + 2] = 239
        }
    }

    return sharp(raw, { raw: { channels: 3, height: 640, width: WIDTH } }).png().toBuffer()
}

async function leftFestivalCardPng(options: { faintWipe?: boolean, wipe?: boolean } = {}): Promise<Buffer>
{
    const raw = Buffer.alloc(WIDTH * 640 * 3)

    for (let row = 0; row < 640; row += 1) {
        for (let column = 0; column < WIDTH; column += 1) {
            const index = (row * WIDTH + column) * 3
            const inPhoto = column >= 80 && column < 980 && row >= 20 && row < 560
            const inCaption = column >= 1100 && column < 1700 && row >= 40 && row < 110
            const inCta = column >= 1100 && column < 1480 && row >= 470 && row < 520
            const faintWipe = options.faintWipe === true
                && inPhoto
                && row < 140
                && ((column >= 220 && column < 228) || (column >= 320 && column < 328))
            const wipeColumn = options.wipe
                && inPhoto
                && row < 220
                && (column - 160) % 48 < 16
                && column >= 160
                && column < 720

            if (wipeColumn || faintWipe) {
                raw[index] = 255
                raw[index + 1] = 255
                raw[index + 2] = 255
                continue
            }

            if (inCta) {
                raw[index] = 255
                raw[index + 1] = 92
                raw[index + 2] = 56
                continue
            }

            if (inCaption) {
                raw[index] = 36
                raw[index + 1] = 34
                raw[index + 2] = 32
                continue
            }

            if (inPhoto) {
                const sample = uniquePhotoTexel(row, column + 400)

                raw[index] = sample[0]
                raw[index + 1] = sample[1]
                raw[index + 2] = sample[2]
                continue
            }

            raw[index] = 248
            raw[index + 1] = 245
            raw[index + 2] = 239
        }
    }

    return sharp(raw, { raw: { channels: 3, height: 640, width: WIDTH } }).png().toBuffer()
}

async function canvasViewportCard(options: { faintWipe?: boolean, wipe?: boolean } = {}): Promise<Buffer>
{
    return stackPngs([
        await leftFestivalCardPng({
            faintWipe: options.faintWipe === true,
            wipe: options.wipe === true,
        }),
        await solidPng('#f8f5ef', 440),
    ])
}

async function midPageFaintWipeStack(): Promise<Buffer>
{
    return stackPngs([
        await nextPhotoCardOnCream(),
        await canvasViewportCard({ faintWipe: true }),
        await canvasViewportCard({ wipe: false }),
        await rightFitnessViewport(),
    ])
}

async function midPageRightPhotoBelt(): Promise<Buffer>
{
    return stackPngs([
        await nextPhotoCardOnCream(),
        await rightFitnessViewport({ repeatBelt: true }),
    ])
}

async function rightFitnessViewport(options: { repeatBelt?: boolean } = {}): Promise<Buffer>
{
    const raw = Buffer.alloc(WIDTH * 1080 * 3)
    const photoLeft = 960
    const photoRight = 1860
    const photoTop = 40
    const photoBottom = 720
    const beltHeight = 16
    const firstBelt = photoBottom - beltHeight * 2
    const secondBelt = photoBottom - beltHeight

    for (let row = 0; row < 1080; row += 1) {
        for (let column = 0; column < WIDTH; column += 1) {
            const index = (row * WIDTH + column) * 3
            const inPhoto = column >= photoLeft && column < photoRight && row >= photoTop && row < photoBottom
            const inFirstBelt = options.repeatBelt === true && inPhoto && row >= firstBelt && row < secondBelt
            const inSecondBelt = options.repeatBelt === true && inPhoto && row >= secondBelt && row < photoBottom
            const ctaTop = (inFirstBelt && row < firstBelt + 5) || (inSecondBelt && row < secondBelt + 5)

            if (ctaTop && column >= 1180 && column < 1580) {
                raw[index] = 255
                raw[index + 1] = 92
                raw[index + 2] = 56
                continue
            }

            if (inFirstBelt || inSecondBelt) {
                const beltRow = row - (inSecondBelt ? secondBelt : firstBelt)
                raw[index] = 40 + beltRow * 6
                raw[index + 1] = 28 + (column % 70)
                raw[index + 2] = 22 + Math.floor(column / 9) % 40
                continue
            }

            if (inPhoto) {
                const sample = uniquePhotoTexel(row, column)

                raw[index] = sample[0]
                raw[index + 1] = sample[1]
                raw[index + 2] = sample[2]
                continue
            }

            raw[index] = 248
            raw[index + 1] = 245
            raw[index + 2] = 239
        }
    }

    return sharp(raw, { raw: { channels: 3, height: 1080, width: WIDTH } }).png().toBuffer()
}

async function canvasWipeStackViewports(): Promise<Buffer>
{
    return stackPngs([
        await canvasViewportCard({ wipe: true }),
        await canvasViewportCard({ wipe: false }),
        await nextPhotoCardOnCream(),
    ])
}

async function tallCanvasWipeStack(): Promise<Buffer>
{
    return stackPngs([
        await solidPng('#f8f5ef', 4000),
        await canvasViewportCard({ wipe: true }),
        await canvasViewportCard({ wipe: false }),
        await nextPhotoCardOnCream(),
        await solidPng('#f8f5ef', 4000),
    ])
}

async function liveLikeCanvasExtract(): Promise<Buffer>
{
    return stackPngs([
        await canvasViewportCard({ wipe: true }),
        await canvasViewportCard({ wipe: false }),
        await thinOffsetBeltCard(),
    ])
}

async function liveOffsetWipeStack(): Promise<Buffer>
{
    return stackPngs([
        await solidPng('#f8f5ef', 2742),
        await altStudioCard(),
        await liveFestivalViewport({ wipe: true }),
        await liveFestivalViewport({ wipe: false }),
        await darkRightPhotoFootBelt(),
    ])
}

async function liveVenetianOffsetStack(): Promise<Buffer>
{
    return stackPngs([
        await solidPng('#f8f5ef', 2742),
        await rightFashionViewport(),
        await venetianFestivalViewport({ remnant: true, wipe: true }),
        await venetianFestivalViewport({ wipe: false }),
        await leftWallpaperFootBelt(),
    ])
}

async function liveFashionRemnantWideWipeStack(): Promise<Buffer>
{
    return stackPngs([
        await solidPng('#f8f5ef', 2742),
        await rightFashionViewport(),
        await venetianFestivalViewport({ remnant: true, wideWipe: true, wipe: true }),
        await venetianFestivalViewport({ wipe: false }),
        await darkRightPhotoFootBelt(),
    ])
}

async function darkRightPhotoFootBeltPage(): Promise<Buffer>
{
    return stackPngs([
        await solidPng('#f8f5ef', 1080),
        await darkRightPhotoFootBelt(),
    ])
}

async function liveFestivalViewport(options: { wipe?: boolean } = {}): Promise<Buffer>
{
    const raw = Buffer.alloc(WIDTH * 1080 * 3)

    for (let row = 0; row < 1080; row += 1) {
        for (let column = 0; column < WIDTH; column += 1) {
            const index = (row * WIDTH + column) * 3
            const inPhoto = column >= 80 && column < 980 && row >= 20 && row < 1020
            const inCaption = column >= 1100 && column < 1700 && row >= 40 && row < 110
            const inCta = column >= 1100 && column < 1480 && row >= 520 && row < 570
            const wipeColumn = options.wipe === true
                && inPhoto
                && row < 240
                && (column - 160) % 48 < 16
                && column >= 160
                && column < 720

            if (wipeColumn) {
                raw[index] = 255
                raw[index + 1] = 255
                raw[index + 2] = 255
                continue
            }

            if (inCta) {
                raw[index] = 255
                raw[index + 1] = 92
                raw[index + 2] = 56
                continue
            }

            if (inCaption) {
                raw[index] = 36
                raw[index + 1] = 34
                raw[index + 2] = 32
                continue
            }

            if (inPhoto) {
                const sample = uniquePhotoTexel(row, column + 400)

                raw[index] = sample[0]
                raw[index + 1] = sample[1]
                raw[index + 2] = sample[2]
                continue
            }

            raw[index] = 248
            raw[index + 1] = 245
            raw[index + 2] = 239
        }
    }

    return sharp(raw, { raw: { channels: 3, height: 1080, width: WIDTH } }).png().toBuffer()
}

async function rightFashionViewport(): Promise<Buffer>
{
    const raw = Buffer.alloc(WIDTH * 1080 * 3)

    for (let row = 0; row < 1080; row += 1) {
        for (let column = 0; column < WIDTH; column += 1) {
            const index = (row * WIDTH + column) * 3
            const inPhoto = column >= 960 && column < 1860 && row >= 40 && row < 980
            const inCaption = column >= 80 && column < 520 && row >= 40 && row < 100

            if (inCaption) {
                raw[index] = 36
                raw[index + 1] = 34
                raw[index + 2] = 32
                continue
            }

            if (inPhoto) {
                const fold = Math.abs(((column - 1400) % 70) - 35)

                raw[index] = 236 - fold
                raw[index + 1] = 232 - Math.floor(fold / 2)
                raw[index + 2] = 228 - Math.floor(row / 90)
                continue
            }

            raw[index] = 248
            raw[index + 1] = 245
            raw[index + 2] = 239
        }
    }

    return sharp(raw, { raw: { channels: 3, height: 1080, width: WIDTH } }).png().toBuffer()
}

async function venetianFestivalViewport(
    options: { remnant?: boolean, wideWipe?: boolean, wipe?: boolean } = {},
): Promise<Buffer>
{
    const raw = Buffer.alloc(WIDTH * 1080 * 3)
    const wipePeriod = options.wideWipe === true ? 52 : 12
    const wipeBar = options.wideWipe === true ? 20 : 3
    const wipeUntil = options.wideWipe === true ? 560 : 940
    const wipeStart = options.wideWipe === true ? 140 : 100
    const wipeEnd = options.wideWipe === true ? 900 : 940

    for (let row = 0; row < 1080; row += 1) {
        for (let column = 0; column < WIDTH; column += 1) {
            const index = (row * WIDTH + column) * 3
            const inRemnant = options.remnant === true
                && column >= 960
                && column < 1860
                && row < 160
            const inPhoto = column >= 80 && column < 980 && row >= 20 && row < 1020
            const inCaption = column >= 1100 && column < 1700 && row >= 40 && row < 110
            const inCta = column >= 1100 && column < 1480 && row >= 520 && row < 570
            const wipeColumn = options.wipe === true
                && inPhoto
                && row < wipeUntil
                && (column - wipeStart) % wipePeriod < wipeBar
                && column >= wipeStart
                && column < wipeEnd

            if (inRemnant) {
                const fold = Math.abs(((column - 1400) % 70) - 35)

                raw[index] = 236 - fold
                raw[index + 1] = 232 - Math.floor(fold / 2)
                raw[index + 2] = 228 - Math.floor(row / 90)
                continue
            }

            if (wipeColumn) {
                raw[index] = 255
                raw[index + 1] = 255
                raw[index + 2] = 255
                continue
            }

            if (inCta) {
                raw[index] = 255
                raw[index + 1] = 92
                raw[index + 2] = 56
                continue
            }

            if (inCaption) {
                raw[index] = 36
                raw[index + 1] = 34
                raw[index + 2] = 32
                continue
            }

            if (inPhoto) {
                const sample = carnivalStageTexel(row, column)

                raw[index] = sample[0]
                raw[index + 1] = sample[1]
                raw[index + 2] = sample[2]
                continue
            }

            raw[index] = 248
            raw[index + 1] = 245
            raw[index + 2] = 239
        }
    }

    return sharp(raw, { raw: { channels: 3, height: 1080, width: WIDTH } }).png().toBuffer()
}

async function leftWallpaperFootBelt(): Promise<Buffer>
{
    const raw = Buffer.alloc(WIDTH * 1080 * 3)
    const photoRight = 960
    const photoBottom = 1040
    const beltHeight = 16
    const firstBelt = photoBottom - beltHeight * 2
    const secondBelt = photoBottom - beltHeight

    for (let row = 0; row < 1080; row += 1) {
        for (let column = 0; column < WIDTH; column += 1) {
            const index = (row * WIDTH + column) * 3
            const inPhoto = column >= 80 && column < photoRight && row >= 40 && row < photoBottom
            const inFirstBelt = inPhoto && row >= firstBelt && row < secondBelt
            const inSecondBelt = inPhoto && row >= secondBelt && row < photoBottom

            if (inFirstBelt || inSecondBelt) {
                const beltRow = row - (inSecondBelt ? secondBelt : firstBelt)

                raw[index] = 42 + beltRow * 4
                raw[index + 1] = 28 + Math.floor(column / 8) % 30
                raw[index + 2] = 22 + (column % 18)
                continue
            }

            if (inPhoto) {
                const diamond = Math.abs((column % 70) - 35) + Math.abs((row % 70) - 35)

                raw[index] = 48 + (diamond < 18 ? 10 : 0)
                raw[index + 1] = 22 + Math.floor((column % 40) / 6)
                raw[index + 2] = 14
                continue
            }

            raw[index] = 248
            raw[index + 1] = 245
            raw[index + 2] = 239
        }
    }

    return sharp(raw, { raw: { channels: 3, height: 1080, width: WIDTH } }).png().toBuffer()
}

async function altStudioCard(): Promise<Buffer>
{
    const raw = Buffer.alloc(WIDTH * 1080 * 3)

    for (let row = 0; row < 1080; row += 1) {
        for (let column = 0; column < WIDTH; column += 1) {
            const index = (row * WIDTH + column) * 3
            const inPhoto = column >= 80 && column < 900 && row >= 20 && row < 1020

            if (inPhoto) {
                const stripe = Math.floor((row + column) / 28) % 2 === 1

                raw[index] = stripe ? 210 : 20
                raw[index + 1] = stripe ? 30 : 200
                raw[index + 2] = stripe ? 190 : 40
                continue
            }

            raw[index] = 248
            raw[index + 1] = 245
            raw[index + 2] = 239
        }
    }

    return sharp(raw, { raw: { channels: 3, height: 1080, width: WIDTH } }).png().toBuffer()
}

async function darkRightPhotoFootBelt(): Promise<Buffer>
{
    const raw = Buffer.alloc(WIDTH * 1080 * 3)
    const photoLeft = 960
    const photoBottom = 1062
    const beltHeight = 18
    const firstBelt = photoBottom - beltHeight * 2
    const secondBelt = photoBottom - beltHeight

    for (let row = 0; row < 1080; row += 1) {
        for (let column = 0; column < WIDTH; column += 1) {
            const index = (row * WIDTH + column) * 3
            const inPhoto = column >= photoLeft && row < photoBottom
            const inFirstBelt = inPhoto && row >= firstBelt && row < secondBelt
            const inSecondBelt = inPhoto && row >= secondBelt && row < photoBottom
            const inCaption = !inPhoto
                && column >= 1100
                && column < 1480
                && row >= photoBottom + 4
                && row < photoBottom + 14

            if (inCaption) {
                raw[index] = 28
                raw[index + 1] = 26
                raw[index + 2] = 24
                continue
            }

            if (inFirstBelt || inSecondBelt) {
                const floor = darkFloorTexel(0, column)

                raw[index] = floor[0]
                raw[index + 1] = floor[1]
                raw[index + 2] = floor[2]
                continue
            }

            if (inPhoto && row >= 946 && row < firstBelt) {
                const floor = darkFloorTexel(0, column)

                raw[index] = floor[0]
                raw[index + 1] = floor[1]
                raw[index + 2] = floor[2]
                continue
            }

            if (inPhoto) {
                const gym = darkGymTexel(row, column)

                raw[index] = gym[0]
                raw[index + 1] = gym[1]
                raw[index + 2] = gym[2]
                continue
            }

            raw[index] = 248
            raw[index + 1] = 245
            raw[index + 2] = 239
        }
    }

    return sharp(raw, { raw: { channels: 3, height: 1080, width: WIDTH } }).png().toBuffer()
}

function darkFloorTexel(row: number, column: number): [number, number, number]
{
    return [
        20 + (column % 7),
        16 + ((column + row) % 5),
        14 + (column % 4),
    ]
}

function darkGymTexel(row: number, column: number): [number, number, number]
{
    const body = Math.hypot(row - 380, column - 1380) < 90
    const body2 = Math.hypot(row - 560, column - 1620) < 80

    if (body) return [176, 42, 58]
    if (body2) return [28, 92, 48]

    return [
        18 + Math.min(50, Math.floor(Math.hypot(row - 420, column - 1420) / 10)),
        16 + Math.min(40, Math.floor(Math.hypot(row - 700, column - 1680) / 12)),
        14 + Math.min(30, Math.floor(row / 35)),
    ]
}

async function portfolioStackedWipeCard(): Promise<Buffer>
{
    return stackPngs([
        await nextPhotoCardOnCream(),
        await leftFestivalCardPng({ wipe: true }),
        await leftFestivalCardPng({ wipe: false }),
        await solidPng('#f8f5ef', 200),
    ])
}

async function photoFootBeltWithCta(): Promise<Buffer>
{
    const raw = Buffer.alloc(WIDTH * 1080 * 3)
    const photoLeft = 960
    const photoRight = 1860
    const photoTop = 40
    const photoBottom = 720
    const beltHeight = 18
    const firstBelt = photoBottom - beltHeight * 2
    const secondBelt = photoBottom - beltHeight

    for (let row = 0; row < 1080; row += 1) {
        for (let column = 0; column < WIDTH; column += 1) {
            const index = (row * WIDTH + column) * 3
            const inPhoto = column >= photoLeft && column < photoRight && row >= photoTop && row < photoBottom
            const inFirstBelt = inPhoto && row >= firstBelt && row < secondBelt
            const inSecondBelt = inPhoto && row >= secondBelt && row < photoBottom
            const ctaTop = (inFirstBelt && row < firstBelt + 6) || (inSecondBelt && row < secondBelt + 6)

            if (ctaTop && column >= 1180 && column < 1580) {
                raw[index] = 255
                raw[index + 1] = 92
                raw[index + 2] = 56
                continue
            }

            if (inFirstBelt || inSecondBelt) {
                const beltRow = row - (inSecondBelt ? secondBelt : firstBelt)
                const sample = beltTexel(beltRow, column)

                raw[index] = sample[0]
                raw[index + 1] = sample[1]
                raw[index + 2] = sample[2]
                continue
            }

            if (inPhoto) {
                const sample = uniquePhotoTexel(row, column)

                raw[index] = sample[0]
                raw[index + 1] = sample[1]
                raw[index + 2] = sample[2]
                continue
            }

            raw[index] = 248
            raw[index + 1] = 245
            raw[index + 2] = 239
        }
    }

    const card = await sharp(raw, { raw: { channels: 3, height: 1080, width: WIDTH } }).png().toBuffer()

    return stackPngs([
        await solidPng('#f8f5ef', 3600),
        card,
        await nextPhotoCardOnCream(),
    ])
}

async function brightStageWithWipe(): Promise<Buffer>
{
    const raw = Buffer.alloc(WIDTH * 1080 * 3)

    for (let row = 0; row < 1080; row += 1) {
        for (let column = 0; column < WIDTH; column += 1) {
            const index = (row * WIDTH + column) * 3
            const inPhoto = column >= 80 && column < 980 && row >= 80 && row < 860
            const wipe = inPhoto
                && row < 420
                && column >= 200
                && (column - 200) % 52 < 24
                && column < 200 + 5 * 52

            if (wipe) {
                raw[index] = 255
                raw[index + 1] = 255
                raw[index + 2] = 255
                continue
            }

            if (inPhoto) {
                raw[index] = 236
                raw[index + 1] = 186
                raw[index + 2] = 52
                continue
            }

            raw[index] = 248
            raw[index + 1] = 245
            raw[index + 2] = 239
        }
    }

    return sharp(raw, { raw: { channels: 3, height: 1080, width: WIDTH } }).png().toBuffer()
}

async function darkWallpaperWithEdgeWipe(): Promise<Buffer>
{
    const raw = Buffer.alloc(WIDTH * 1080 * 3)

    for (let row = 0; row < 1080; row += 1) {
        for (let column = 0; column < WIDTH; column += 1) {
            const index = (row * WIDTH + column) * 3
            const inPhoto = column >= 80 && column < 900 && row >= 80 && row < 900
            const wipe = inPhoto
                && column >= 700
                && (column - 700) % 48 < 20
                && column < 700 + 4 * 48
            const diamond = Math.abs((column % 70) - 35) + Math.abs((row % 70) - 35)

            if (wipe) {
                raw[index] = 255
                raw[index + 1] = 255
                raw[index + 2] = 255
                continue
            }

            if (inPhoto) {
                raw[index] = 48 + (diamond < 18 ? 10 : 0)
                raw[index + 1] = 22 + Math.floor((column % 40) / 6)
                raw[index + 2] = 14
                continue
            }

            raw[index] = 248
            raw[index + 1] = 245
            raw[index + 2] = 239
        }
    }

    return sharp(raw, { raw: { channels: 3, height: 1080, width: WIDTH } }).png().toBuffer()
}

async function stackedCardWithWipe(): Promise<Buffer>
{
    return stackPngs([
        await solidPng('#f8f5ef', 80),
        await festivalCardPng({ wipe: true }),
        await festivalCardPng({ wipe: false }),
        await solidPng('#f8f5ef', 200),
    ])
}

async function tallStackedCardWithWipe(): Promise<Buffer>
{
    return stackPngs([
        await solidPng('#f8f5ef', 4000),
        await festivalCardPng({ wipe: true }),
        await festivalCardPng({ wipe: false }),
        await nextPhotoCardOnCream(),
        await solidPng('#f8f5ef', 400),
    ])
}

async function thinOffsetBeltCard(): Promise<Buffer>
{
    return photoCardWithCaptionBelt({ beltGap: 8, beltHeight: 16 })
}

async function tallStitchCardBelt(): Promise<Buffer>
{
    return stackPngs([
        await solidPng('#f8f5ef', 4320),
        await photoCardWithCaptionBelt({ beltGap: 12 }),
        await nextPhotoCardOnCream(),
    ])
}

async function nextPhotoCardOnCream(): Promise<Buffer>
{
    const raw = Buffer.alloc(WIDTH * 1080 * 3)

    for (let row = 0; row < 1080; row += 1) {
        for (let column = 0; column < WIDTH; column += 1) {
            const index = (row * WIDTH + column) * 3
            const inPhoto = column >= 80 && column < 900 && row >= 40 && row < 560

            if (inPhoto) {
                const blob = Math.hypot(row - 220, column - 400)

                raw[index] = 90 + Math.min(80, Math.floor(blob / 6))
                raw[index + 1] = 40 + Math.floor((column % 220) / 3)
                raw[index + 2] = 30 + Math.floor(row / 8) % 70
                continue
            }

            raw[index] = 248
            raw[index + 1] = 245
            raw[index + 2] = 239
        }
    }

    return sharp(raw, { raw: { channels: 3, height: 1080, width: WIDTH } }).png().toBuffer()
}

/**
 * 舊掃描只允許 ±1 列指紋、較緊門檻，且雙方都近白才略過。
 * 長圖接縫上錯開約 12px、CTA 壓在留白上的腰帶會錯過。
 *
 * @param image 長圖 PNG。
 * @returns 舊邏輯處理後的圖。
 */
async function legacyNarrowOffsetBeltTrim(image: Buffer): Promise<Buffer>
{
    const height = (await sharp(image).metadata()).height ?? 0

    if (height < 160) return image

    const signatureHeight = Math.max(16, Math.round(height * 384 / WIDTH))
    const signature = await sharp(image)
        .resize(384, signatureHeight, { fit: 'fill' })
        .removeAlpha()
        .raw()
        .toBuffer()
    const scale = height / signatureHeight
    const rowBytes = 384 * 3
    const reference = Math.min(1080, height)

    for (const ratio of [0.22, 0.19, 0.16, 0.13, 0.1]) {
        const bandPx = Math.max(48, Math.round(reference * ratio))
        const bandRows = Math.max(4, Math.round(bandPx / scale))

        if (bandRows * 3 > signatureHeight) continue

        const minimumLower = bandRows * 2 + 1
        const maximumLower = signatureHeight - bandRows - 1
        const step = Math.max(1, Math.round(bandRows / 4))

        for (let lower = maximumLower; lower >= minimumLower; lower -= step) {
            for (const offset of [0, -1, 1]) {
                const upper = lower - bandRows + offset

                if (upper < 2) continue

                const upperSlice = signature.subarray(upper * rowBytes, (upper + bandRows) * rowBytes)
                const lowerSlice = signature.subarray(lower * rowBytes, (lower + bandRows) * rowBytes)
                let total = 0
                let count = 0

                for (let index = 0; index < lowerSlice.length; index += 3) {
                    const leftLuma = 0.299 * (upperSlice[index] ?? 0)
                        + 0.587 * (upperSlice[index + 1] ?? 0)
                        + 0.114 * (upperSlice[index + 2] ?? 0)
                    const rightLuma = 0.299 * (lowerSlice[index] ?? 0)
                        + 0.587 * (lowerSlice[index + 1] ?? 0)
                        + 0.114 * (lowerSlice[index + 2] ?? 0)

                    if (leftLuma > 230 && rightLuma > 230) continue

                    total += Math.abs((upperSlice[index] ?? 0) - (lowerSlice[index] ?? 0))
                    total += Math.abs((upperSlice[index + 1] ?? 0) - (lowerSlice[index + 1] ?? 0))
                    total += Math.abs((upperSlice[index + 2] ?? 0) - (lowerSlice[index + 2] ?? 0))
                    count += 1
                }

                if (count < lowerSlice.length / 3 * 0.08) continue

                const difference = total / count / 3 / 255

                if (difference > 0.02) continue

                const cutStart = Math.round(lower * scale)
                const cutHeight = Math.round(bandRows * scale)

                if (cutStart < 24 || cutHeight < 32 || cutStart + cutHeight > height) return image

                const top = await sharp(image)
                    .extract({ height: cutStart, left: 0, top: 0, width: WIDTH })
                    .toBuffer()
                const bottomHeight = height - cutStart - cutHeight

                if (bottomHeight <= 0) return top

                const bottom = await sharp(image)
                    .extract({
                        height: bottomHeight,
                        left: 0,
                        top: cutStart + cutHeight,
                        width: WIDTH,
                    })
                    .toBuffer()

                return sharp({
                    create: {
                        background: '#ffffff',
                        channels: 3,
                        height: cutStart + bottomHeight,
                        width: WIDTH,
                    },
                })
                    .composite([
                        { input: top, left: 0, top: 0 },
                        { input: bottom, left: 0, top: cutStart },
                    ])
                    .png()
                    .toBuffer()
            }
        }
    }

    return image
}

/**
 * 舊實作只比整段最後 22% 與正上方一截。照片卡底下若還有標題與留白，
 * 會把真正的腰帶錯過。
 *
 * @param image 完整視窗 PNG。
 * @returns 舊邏輯處理後的圖。
 */
async function legacyFullSegmentTailTrim(image: Buffer): Promise<Buffer>
{
    const height = (await sharp(image).metadata()).height ?? 0
    const band = Math.max(40, Math.round(height * 0.22))

    if (height < band * 2 + 40) return image

    const tail = await sharp(image)
        .extract({ height: band, left: 0, top: height - band, width: WIDTH })
        .toBuffer()
    const above = await sharp(image)
        .extract({ height: band, left: 0, top: height - band * 2, width: WIDTH })
        .toBuffer()
    const rows = Math.max(8, Math.round(band * SETTLE_WIDTH / WIDTH))
    const tailSignature = await sharp(tail)
        .resize(SETTLE_WIDTH, rows, { fit: 'fill' })
        .removeAlpha()
        .raw()
        .toBuffer()
    const aboveSignature = await sharp(above)
        .resize(SETTLE_WIDTH, rows, { fit: 'fill' })
        .removeAlpha()
        .raw()
        .toBuffer()
    const variance = rowSliceVariance(tailSignature)
    let difference = 0

    for (let index = 0; index < tailSignature.length; index += 1) {
        difference += Math.abs((tailSignature[index] ?? 0) - (aboveSignature[index] ?? 0))
    }

    difference = difference / tailSignature.length / 255

    if (variance < 0.02 || difference > 0.015) return image

    return image
}

/**
 * v11 滑動門檻：settle 式 wipe 偵測（200／+40）在 384 指紋上看不
 * 到淡化百葉窗，且 45–175 遮罩後的整磚差仍 > 0.012，整段拒絕。
 *
 * @param image 長圖 PNG。
 * @param wipeStart wipe 視窗的 y。
 * @returns 舊門檻會留下 wipe 磚時為 true。
 */
async function legacyStrictWipeGateKeeps(image: Buffer, wipeStart: number): Promise<boolean>
{
    const wipe = await sharp(image)
        .extract({ height: 1080, left: 0, top: wipeStart, width: WIDTH })
        .toBuffer()
    const clean = await sharp(image)
        .extract({ height: 1080, left: 0, top: wipeStart + 1080, width: WIDTH })
        .toBuffer()
    const rows = Math.max(16, Math.round(1080 * 384 / WIDTH))
    const wipeSignature = await sharp(wipe)
        .resize(384, rows, { fit: 'fill' })
        .removeAlpha()
        .raw()
        .toBuffer()
    const cleanSignature = await sharp(clean)
        .resize(384, rows, { fit: 'fill' })
        .removeAlpha()
        .raw()
        .toBuffer()
    const differences: number[] = []

    for (let index = 0; index < wipeSignature.length; index += 3) {
        const leftLuma = 0.299 * (wipeSignature[index] ?? 0)
            + 0.587 * (wipeSignature[index + 1] ?? 0)
            + 0.114 * (wipeSignature[index + 2] ?? 0)
        const rightLuma = 0.299 * (cleanSignature[index] ?? 0)
            + 0.587 * (cleanSignature[index + 1] ?? 0)
            + 0.114 * (cleanSignature[index + 2] ?? 0)

        if (leftLuma > 230 || rightLuma > 230) continue

        const wipeVsPhoto = (
            leftLuma > 200
            && rightLuma > 45
            && rightLuma < 175
        ) || (
            rightLuma > 200
            && leftLuma > 45
            && leftLuma < 175
        )

        if (wipeVsPhoto) continue

        differences.push((
            Math.abs((wipeSignature[index] ?? 0) - (cleanSignature[index] ?? 0))
            + Math.abs((wipeSignature[index + 1] ?? 0) - (cleanSignature[index + 1] ?? 0))
            + Math.abs((wipeSignature[index + 2] ?? 0) - (cleanSignature[index + 2] ?? 0))
        ) / 3)
    }

    if (differences.length < 8) return true

    differences.sort((leftValue, rightValue) => leftValue - rightValue)
    const kept = differences.slice(0, Math.max(1, Math.floor(differences.length * 0.85)))
    let total = 0

    for (const value of kept) total += value

    const difference = total / kept.length / 255

    return !looksLikeVerticalWipe(wipeSignature, 384, rows) && difference > 0.012
}

function countLegacyMidToneWipeSpikes(image: Buffer, width: number, height: number): number
{
    const columnMean = new Float64Array(width)

    for (let column = 0; column < width; column += 1) {
        let total = 0

        for (let row = 0; row < height; row += 1) {
            const index = (row * width + column) * 3

            total += 0.299 * (image[index] ?? 0)
                + 0.587 * (image[index + 1] ?? 0)
                + 0.114 * (image[index + 2] ?? 0)
        }

        columnMean[column] = total / height
    }

    let spikes = 0

    for (let column = 2; column < width - 2; column += 1) {
        const left = ((columnMean[column - 2] ?? 0) + (columnMean[column - 1] ?? 0)) / 2
        const right = ((columnMean[column + 1] ?? 0) + (columnMean[column + 2] ?? 0)) / 2
        const current = columnMean[column] ?? 0
        const sitsInside = left > 45 && left < 175 && right > 45 && right < 175

        if (sitsInside && current > (left + right) / 2 + 40 && current > 200) spikes += 1
    }

    return spikes
}

async function sampleRgb(image: Buffer, left: number, top: number): Promise<number[]>
{
    const pixel = await sharp(image)
        .extract({ height: 1, left, top, width: 1 })
        .removeAlpha()
        .raw()
        .toBuffer()

    return [...pixel]
}
