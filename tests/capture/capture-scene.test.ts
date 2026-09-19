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

describe('capture scene heuristics', () => {
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
        const belt = await stripePng(200)
        const stacked = await stackPngs([
            await solidPng('#f8f5ef', 400),
            belt,
            belt,
        ])
        const trimmed = await trimRepeatedTailBand(stacked, WIDTH)
        const metadata = await sharp(trimmed).metadata()

        expect(metadata.height).toBeLessThan(750)
        expect(metadata.height).toBeGreaterThan(500)
        expect(await sampleRgb(trimmed, 20, 500)).toEqual([34, 197, 94])
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

async function photoCardWithCaptionBelt(options: { repeatBelt?: boolean } = {}): Promise<Buffer>
{
    const repeatBelt = options.repeatBelt !== false
    const raw = Buffer.alloc(WIDTH * 1080 * 3)
    const belt = await stripePng(140)
    const beltRaw = await sharp(belt).removeAlpha().raw().toBuffer()

    for (let row = 0; row < 1080; row += 1) {
        for (let column = 0; column < WIDTH; column += 1) {
            const index = (row * WIDTH + column) * 3
            const inPhoto = column >= 960 && column < 1860 && row >= 40 && row < 780
            const inFirstBelt = repeatBelt && inPhoto && row >= 500 && row < 640
            const inSecondBelt = repeatBelt && inPhoto && row >= 640 && row < 780
            const inCta = inSecondBelt && column >= 1000 && column < 1240 && row >= 690 && row < 730

            if (inCta) {
                raw[index] = 255
                raw[index + 1] = 92
                raw[index + 2] = 56
                continue
            }

            if (inFirstBelt || inSecondBelt) {
                const beltRow = row - (inSecondBelt ? 640 : 500)
                const beltIndex = (beltRow * WIDTH + (column - 960)) * 3

                raw[index] = beltRaw[beltIndex] ?? 34
                raw[index + 1] = beltRaw[beltIndex + 1] ?? 197
                raw[index + 2] = beltRaw[beltIndex + 2] ?? 94
                continue
            }

            if (inPhoto) {
                raw[index] = 50 + ((row + column) % 70)
                raw[index + 1] = 80 + ((row * 2 + column) % 60)
                raw[index + 2] = 110 + ((row * 3 + column * 2) % 50)
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

async function sampleRgb(image: Buffer, left: number, top: number): Promise<number[]>
{
    const pixel = await sharp(image)
        .extract({ height: 1, left, top, width: 1 })
        .removeAlpha()
        .raw()
        .toBuffer()

    return [...pixel]
}
