import sharp from 'sharp'

export type VisualDifference = {
    decision: 'new_version' | 'review_required' | 'unchanged'
    imageDifference: number
    ruleVersion: 'fixture-v1-uncalibrated'
}

/**
 * 以固定尺寸灰階像素估算兩張頁面圖片的視覺差異。
 *
 * @param baseline 目前公開版本圖片。
 * @param candidate 新擷取圖片。
 * @returns 僅供 fixture 驗證的差異分數與暫定決定。
 */
export async function comparePageImages(baseline: Buffer, candidate: Buffer): Promise<VisualDifference>
{
    const [baselinePixels, candidatePixels] = await Promise.all([
        normalizeImage(baseline),
        normalizeImage(candidate),
    ])
    let difference = 0

    for (let index = 0; index < baselinePixels.length; index += 1) {
        difference += Math.abs((baselinePixels[index] ?? 0) - (candidatePixels[index] ?? 0))
    }

    const imageDifference = difference / baselinePixels.length / 255
    const decision = imageDifference <= 0.02
        ? 'unchanged'
        : imageDifference >= 0.12
            ? 'new_version'
            : 'review_required'

    return { decision, imageDifference, ruleVersion: 'fixture-v1-uncalibrated' }
}

/**
 * 將不同尺寸與格式的圖片轉成可逐像素比較的資料。
 *
 * @param input 原始圖片。
 * @returns 64 × 64 灰階像素。
 */
async function normalizeImage(input: Buffer): Promise<Buffer>
{
    return sharp(input).resize(64, 64, { fit: 'fill' }).greyscale().raw().toBuffer()
}
