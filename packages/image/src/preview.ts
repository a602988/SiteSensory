import sharp from 'sharp'

const PREVIEW_WIDTH = 640

export type CropRegion = {
    height: number
    width: number
    x: number
    y: number
}

export type ImageSize = {
    height: number
    width: number
}

/**
 * 讀取上傳截圖的像素尺寸，並拒絕無法辨識的圖片內容。
 *
 * @param input 使用者上傳的 PNG 內容。
 * @returns 圖片的原始寬高。
 */
export async function inspectImage(input: Buffer): Promise<ImageSize>
{
    const metadata = await sharp(input).metadata()

    if (metadata.format !== 'png' || !metadata.width || !metadata.height) {
        throw new Error('只接受有效的 PNG 截圖')
    }

    return {
        height: metadata.height,
        width: metadata.width,
    }
}

/**
 * 為列表產生固定寬度的 WebP 預覽，避免瀏覽器下載 1920px 原圖。
 *
 * @param input 原始截圖內容。
 * @returns 最長邊不超過列表需求的 WebP 圖片。
 */
export async function createThumbnail(input: Buffer): Promise<Buffer>
{
    return sharp(input)
        .resize({ width: PREVIEW_WIDTH, withoutEnlargement: true })
        .webp({ quality: 76 })
        .toBuffer()
}

/**
 * 依正規化座標裁切收藏視角，再縮成列表使用的 WebP 預覽。
 *
 * @param input 完整頁面原始截圖。
 * @param region 使用者保存的正規化裁切範圍。
 * @returns 只包含收藏視角的低解析預覽。
 */
export async function createSavedViewPreview(input: Buffer, region: CropRegion): Promise<Buffer>
{
    const image = sharp(input)
    const metadata = await image.metadata()

    if (!metadata.width || !metadata.height) throw new Error('圖片缺少可裁切尺寸')

    const left = Math.min(Math.floor(region.x * metadata.width), metadata.width - 1)
    const top = Math.min(Math.floor(region.y * metadata.height), metadata.height - 1)
    const width = Math.max(1, Math.min(Math.round(region.width * metadata.width), metadata.width - left))
    const height = Math.max(1, Math.min(Math.round(region.height * metadata.height), metadata.height - top))

    return image
        .extract({ height, left, top, width })
        .resize({ width: PREVIEW_WIDTH, withoutEnlargement: true })
        .webp({ quality: 78 })
        .toBuffer()
}
