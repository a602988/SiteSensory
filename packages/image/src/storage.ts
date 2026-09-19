import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'

export type StoredObject = {
    byteSize: number
    objectKey: string
    sha256: string
}

export interface ObjectStorage {
    /**
     * 讀取 object key 對應的檔案。
     *
     * @param objectKey 儲存介面產生的物件鍵。
     * @returns 完整檔案內容。
     */
    get(objectKey: string): Promise<Buffer>

    /**
     * 以不可預測 object key 保存檔案。
     *
     * @param content 檔案內容。
     * @param extension 不含路徑的副檔名。
     * @returns 內容雜湊、大小與 object key。
     */
    put(content: Buffer, extension: string): Promise<StoredObject>
}

/**
 * 建立限制在指定根目錄內的本機檔案儲存介面。
 *
 * @param root 資產根目錄。
 * @returns 不接受呼叫端路徑的檔案儲存介面。
 */
export function createLocalObjectStorage(root: string): ObjectStorage
{
    const absoluteRoot = resolve(root)

    return {
        async get(objectKey)
        {
            return readFile(resolveObjectPath(absoluteRoot, objectKey))
        },
        async put(content, extension)
        {
            const safeExtension = normalizeExtension(extension)
            const sha256 = createHash('sha256').update(content).digest('hex')
            const objectKey = `${sha256.slice(0, 2)}/${randomUUID()}-${sha256}${safeExtension}`
            const target = resolveObjectPath(absoluteRoot, objectKey)
            const directory = target.slice(0, target.lastIndexOf(sep))

            await mkdir(directory, { recursive: true })
            await writeFile(target, content, { flag: 'wx' })

            return { byteSize: content.byteLength, objectKey, sha256 }
        },
    }
}

/**
 * 限制 object key 只能解析到資產根目錄內。
 *
 * @param root 絕對資產根目錄。
 * @param objectKey 程式保存的物件鍵。
 * @returns 安全的絕對檔案路徑。
 */
function resolveObjectPath(root: string, objectKey: string): string
{
    if (!objectKey || objectKey.includes('\\')) throw new Error('無效的 object key')

    const target = resolve(root, objectKey)

    if (!target.startsWith(`${root}${sep}`)) throw new Error('object key 超出資產根目錄')

    return target
}

/**
 * 限制副檔名只能包含短小的英數內容。
 *
 * @param extension 呼叫端提供的副檔名。
 * @returns 以句點開頭的安全副檔名。
 */
function normalizeExtension(extension: string): string
{
    const value = extension.startsWith('.') ? extension : `.${extension}`

    if (!/^\.[a-z0-9]{1,8}$/i.test(value)) throw new Error('無效的檔案副檔名')

    return value.toLowerCase()
}
