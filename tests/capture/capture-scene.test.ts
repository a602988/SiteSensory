import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import {
    isSamePinnedScene,
    looksLikeVerticalWipe,
    rowSliceVariance,
    trimDuplicateScenePrefix,
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

async function sampleRgb(image: Buffer, left: number, top: number): Promise<number[]>
{
    const pixel = await sharp(image)
        .extract({ height: 1, left, top, width: 1 })
        .removeAlpha()
        .raw()
        .toBuffer()

    return [...pixel]
}
