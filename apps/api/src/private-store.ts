import { sql, type Kysely, type Transaction } from 'kysely'

import type {
    SavedView,
    SavedViewInput,
    SavedViewList,
    SavedViewUpdate,
    UserTag,
    UserTagInput,
} from '@sitesensory/contracts'
import type { DB } from '@sitesensory/database'

export interface PrivateStore {
    /**
     * 建立只屬於指定使用者的收藏視角。
     *
     * @param userId session 內的使用者識別碼。
     * @param input 已驗證的收藏內容。
     * @returns 新建立的收藏視角；標籤不屬於使用者時回傳 null。
     */
    createSavedView(userId: string, input: SavedViewInput): Promise<SavedView | null>

    /**
     * 建立只屬於指定使用者的私人標籤。
     *
     * @param userId session 內的使用者識別碼。
     * @param input 已驗證的標籤名稱。
     * @returns 新建立的私人標籤。
     */
    createTag(userId: string, input: UserTagInput): Promise<UserTag>

    /**
     * 刪除指定使用者自己的收藏視角。
     *
     * @param userId session 內的使用者識別碼。
     * @param id 收藏視角識別碼。
     * @returns 是否找到並刪除資料。
     */
    deleteSavedView(userId: string, id: string): Promise<boolean>

    /**
     * 刪除指定使用者自己的私人標籤。
     *
     * @param userId session 內的使用者識別碼。
     * @param id 私人標籤識別碼。
     * @returns 是否找到並刪除資料。
     */
    deleteTag(userId: string, id: string): Promise<boolean>

    /**
     * 列出指定使用者的收藏視角。
     *
     * @param userId session 內的使用者識別碼。
     * @returns 依建立時間由新到舊排列的收藏視角。
     */
    listSavedViews(userId: string, page: number): Promise<SavedViewList>

    /**
     * 取得指定使用者收藏視角的原圖與裁切範圍。
     *
     * @param userId session 內的使用者識別碼。
     * @param id 收藏視角識別碼。
     * @returns 產生私人預覽需要的來源；找不到時回傳 null。
     */
    getSavedViewPreviewSource(userId: string, id: string): Promise<SavedViewPreviewSource | null>

    /**
     * 列出指定使用者的私人標籤。
     *
     * @param userId session 內的使用者識別碼。
     * @returns 依名稱排列的私人標籤。
     */
    listTags(userId: string): Promise<UserTag[]>

    /**
     * 更新指定使用者自己的收藏視角。
     *
     * @param userId session 內的使用者識別碼。
     * @param id 收藏視角識別碼。
     * @param input 已驗證的更新內容。
     * @returns 更新後資料；資料不存在或標籤不屬於使用者時回傳 null。
     */
    updateSavedView(userId: string, id: string, input: SavedViewUpdate): Promise<SavedView | null>

    /**
     * 重新命名指定使用者自己的私人標籤。
     *
     * @param userId session 內的使用者識別碼。
     * @param id 私人標籤識別碼。
     * @param input 已驗證的標籤名稱。
     * @returns 更新後資料；找不到資料時回傳 null。
     */
    updateTag(userId: string, id: string, input: UserTagInput): Promise<UserTag | null>
}

type SavedViewRow = {
    createdAt: Date
    domain: string
    height: number
    id: string
    pageId: string
    pageVersionId: string
    reason: string | null
    sourceUrl: string
    title: string | null
    updatedAt: Date
    width: number
    x: number
    y: number
}

export type SavedViewPreviewSource = {
    height: number
    objectKey: string
    width: number
    x: number
    y: number
}

const SAVED_VIEW_PAGE_SIZE = 18

/**
 * 建立以 PostgreSQL 保存私人收藏與標籤的存取介面。
 *
 * @param database SiteSensory 資料庫連線。
 * @returns 所有查詢都強制套用使用者範圍的私人資料存取介面。
 */
export function createPrivateStore(database: Kysely<DB>): PrivateStore
{
    return {
        async createSavedView(userId, input)
        {
            return database.transaction().execute(async transaction => {
                if (!await ownsEveryTag(transaction, userId, input.tagIds)) return null

                const row = await transaction
                    .insertInto('saved_views')
                    .values({
                        height: input.height,
                        page_version_id: input.pageVersionId,
                        reason: input.reason ?? null,
                        user_id: userId,
                        width: input.width,
                        x: input.x,
                        y: input.y,
                    })
                    .returning('id')
                    .executeTakeFirstOrThrow()

                await replaceSavedViewTags(transaction, row.id, input.tagIds)
                await touchTags(transaction, userId, input.tagIds)
                const savedView = await selectSavedView(transaction)
                    .where('saved_views.id', '=', row.id)
                    .where('saved_views.user_id', '=', userId)
                    .executeTakeFirstOrThrow()

                return toSavedView(savedView, input.tagIds)
            })
        },
        async createTag(userId, input)
        {
            const row = await database
                .insertInto('user_tags')
                .values({
                    name: input.name,
                    normalized_name: normalizeTagName(input.name),
                    user_id: userId,
                })
                .returning(tagSelection)
                .executeTakeFirstOrThrow()

            return toUserTag(row)
        },
        async deleteSavedView(userId, id)
        {
            const result = await database
                .deleteFrom('saved_views')
                .where('id', '=', id)
                .where('user_id', '=', userId)
                .executeTakeFirst()

            return result.numDeletedRows > 0n
        },
        async deleteTag(userId, id)
        {
            const result = await database
                .deleteFrom('user_tags')
                .where('id', '=', id)
                .where('user_id', '=', userId)
                .executeTakeFirst()

            return result.numDeletedRows > 0n
        },
        async getSavedViewPreviewSource(userId, id)
        {
            const row = await database
                .selectFrom('saved_views')
                .innerJoin('page_versions', 'page_versions.id', 'saved_views.page_version_id')
                .innerJoin('assets', 'assets.id', 'page_versions.full_page_asset_id')
                .select([
                    'assets.object_key as objectKey',
                    'saved_views.height',
                    'saved_views.width',
                    'saved_views.x',
                    'saved_views.y',
                ])
                .where('saved_views.id', '=', id)
                .where('saved_views.user_id', '=', userId)
                .executeTakeFirst()

            return row ?? null
        },
        async listSavedViews(userId, page)
        {
            const [rows, count] = await Promise.all([
                selectSavedView(database)
                    .where('saved_views.user_id', '=', userId)
                    .orderBy('saved_views.created_at', 'desc')
                    .limit(SAVED_VIEW_PAGE_SIZE)
                    .offset((page - 1) * SAVED_VIEW_PAGE_SIZE)
                    .execute(),
                database
                    .selectFrom('saved_views')
                    .select(sql<number>`count(*)::integer`.as('total'))
                    .where('user_id', '=', userId)
                    .executeTakeFirstOrThrow(),
            ])
            const tagRows = rows.length === 0
                ? []
                : await database
                    .selectFrom('saved_view_tags')
                    .select([
                        'saved_view_id as savedViewId',
                        'tag_id as tagId',
                    ])
                    .where('saved_view_id', 'in', rows.map(row => row.id))
                    .execute()
            const tagsByView = new Map<string, string[]>()

            for (const tag of tagRows) {
                const ids = tagsByView.get(tag.savedViewId) ?? []
                ids.push(tag.tagId)
                tagsByView.set(tag.savedViewId, ids)
            }

            const total = count.total

            return {
                hasMore: page * SAVED_VIEW_PAGE_SIZE < total,
                items: rows.map(row => toSavedView(row, tagsByView.get(row.id) ?? [])),
                page,
                pageSize: SAVED_VIEW_PAGE_SIZE,
                total,
            }
        },
        async listTags(userId)
        {
            const rows = await database
                .selectFrom('user_tags')
                .select(tagSelection)
                .where('user_id', '=', userId)
                .orderBy('updated_at', 'desc')
                .orderBy('normalized_name')
                .execute()

            return rows.map(toUserTag)
        },
        async updateSavedView(userId, id, input)
        {
            return database.transaction().execute(async transaction => {
                if (input.tagIds && !await ownsEveryTag(transaction, userId, input.tagIds)) return null

                const existing = await transaction
                    .selectFrom('saved_views')
                    .select('id')
                    .where('id', '=', id)
                    .where('user_id', '=', userId)
                    .executeTakeFirst()

                if (!existing) return null

                if (input.reason !== undefined) {
                    await transaction
                        .updateTable('saved_views')
                        .set({
                            reason: input.reason,
                            updated_at: new Date(),
                        })
                        .where('id', '=', id)
                        .where('user_id', '=', userId)
                        .executeTakeFirstOrThrow()
                }

                if (input.tagIds) {
                    await replaceSavedViewTags(transaction, id, input.tagIds)
                    await touchTags(transaction, userId, input.tagIds)
                }

                const row = await selectSavedView(transaction)
                    .where('saved_views.id', '=', id)
                    .where('saved_views.user_id', '=', userId)
                    .executeTakeFirstOrThrow()
                const tagIds = input.tagIds ?? await getSavedViewTagIds(transaction, id)

                return toSavedView(row, tagIds)
            })
        },
        async updateTag(userId, id, input)
        {
            const row = await database
                .updateTable('user_tags')
                .set({
                    name: input.name,
                    normalized_name: normalizeTagName(input.name),
                    updated_at: new Date(),
                })
                .where('id', '=', id)
                .where('user_id', '=', userId)
                .returning(tagSelection)
                .executeTakeFirst()

            return row ? toUserTag(row) : null
        },
    }
}

const tagSelection = [
    'created_at as createdAt',
    'id',
    'name',
    'updated_at as updatedAt',
] as const

/**
 * 建立包含頁面資訊的收藏視角查詢，讓新增、列表與更新共用同一份欄位契約。
 *
 * @param database 資料庫連線或目前的 transaction。
 * @returns 可繼續加入使用者與分頁條件的查詢。
 */
function selectSavedView(database: Kysely<DB> | Transaction<DB>)
{
    return database
        .selectFrom('saved_views')
        .innerJoin('page_versions', 'page_versions.id', 'saved_views.page_version_id')
        .innerJoin('pages', 'pages.id', 'page_versions.page_id')
        .innerJoin('sites', 'sites.id', 'pages.site_id')
        .select([
            'page_versions.final_url as sourceUrl',
            'page_versions.title',
            'pages.id as pageId',
            'saved_views.created_at as createdAt',
            'saved_views.height',
            'saved_views.id',
            'saved_views.page_version_id as pageVersionId',
            'saved_views.reason',
            'saved_views.updated_at as updatedAt',
            'saved_views.width',
            'saved_views.x',
            'saved_views.y',
            'sites.registrable_domain as domain',
        ])
}

/**
 * 將私人標籤名稱轉成使用者範圍內的唯一比較值。
 *
 * @param name 已驗證的標籤名稱。
 * @returns Unicode 正規化且不分大小寫的名稱。
 */
function normalizeTagName(name: string): string
{
    return name.normalize('NFKC').toLocaleLowerCase()
}

/**
 * 確認指定標籤全部屬於同一名使用者。
 *
 * @param transaction 目前的資料庫 transaction。
 * @param userId session 內的使用者識別碼。
 * @param tagIds 待套用的私人標籤識別碼。
 * @returns 所有標籤是否都屬於指定使用者。
 */
async function ownsEveryTag(
    transaction: Transaction<DB>,
    userId: string,
    tagIds: string[],
): Promise<boolean>
{
    const uniqueIds = [...new Set(tagIds)]

    if (uniqueIds.length !== tagIds.length) return false
    if (uniqueIds.length === 0) return true

    const rows = await transaction
        .selectFrom('user_tags')
        .select('id')
        .where('user_id', '=', userId)
        .where('id', 'in', uniqueIds)
        .execute()

    return rows.length === uniqueIds.length
}

/**
 * 以單一 transaction 取代收藏視角的私人標籤關聯。
 *
 * @param transaction 目前的資料庫 transaction。
 * @param savedViewId 收藏視角識別碼。
 * @param tagIds 新的私人標籤識別碼。
 * @returns 完成時不回傳內容。
 */
async function replaceSavedViewTags(
    transaction: Transaction<DB>,
    savedViewId: string,
    tagIds: string[],
): Promise<void>
{
    await transaction
        .deleteFrom('saved_view_tags')
        .where('saved_view_id', '=', savedViewId)
        .execute()

    if (tagIds.length === 0) return

    await transaction
        .insertInto('saved_view_tags')
        .values(tagIds.map(tagId => ({
            saved_view_id: savedViewId,
            tag_id: tagId,
        })))
        .execute()
}

/**
 * 版圖最近使用時間用既有標籤的 updated_at 表示，避免另建一份易失同步的排序狀態。
 *
 * @param transaction 目前收藏交易。
 * @param userId 擁有這些版圖的使用者。
 * @param tagIds 本次收藏套用的版圖識別碼。
 * @returns 更新完成時不回傳內容。
 */
async function touchTags(
    transaction: Transaction<DB>,
    userId: string,
    tagIds: string[],
): Promise<void>
{
    if (tagIds.length === 0) return

    await transaction
        .updateTable('user_tags')
        .set({ updated_at: new Date() })
        .where('user_id', '=', userId)
        .where('id', 'in', tagIds)
        .execute()
}

/**
 * 取得收藏視角目前套用的私人標籤。
 *
 * @param transaction 目前的資料庫 transaction。
 * @param savedViewId 收藏視角識別碼。
 * @returns 私人標籤識別碼。
 */
async function getSavedViewTagIds(
    transaction: Transaction<DB>,
    savedViewId: string,
): Promise<string[]>
{
    const rows = await transaction
        .selectFrom('saved_view_tags')
        .select('tag_id as tagId')
        .where('saved_view_id', '=', savedViewId)
        .execute()

    return rows.map(row => row.tagId)
}

/**
 * 將資料庫收藏資料轉成穩定的 API 格式。
 *
 * @param row 資料庫查詢結果。
 * @param tagIds 收藏視角套用的私人標籤。
 * @returns 可序列化的收藏視角。
 */
function toSavedView(row: SavedViewRow, tagIds: string[]): SavedView
{
    return {
        createdAt: row.createdAt.toISOString(),
        domain: row.domain,
        height: row.height,
        id: row.id,
        pageId: row.pageId,
        pageVersionId: row.pageVersionId,
        previewAssetUrl: `/api/v1/saved-views/${row.id}/preview`,
        reason: row.reason,
        sourceUrl: row.sourceUrl,
        tagIds,
        title: row.title || row.domain,
        updatedAt: row.updatedAt.toISOString(),
        width: row.width,
        x: row.x,
        y: row.y,
    }
}

/**
 * 將資料庫標籤資料轉成穩定的 API 格式。
 *
 * @param row 資料庫查詢結果。
 * @returns 可序列化的私人標籤。
 */
function toUserTag(row: {
    createdAt: Date
    id: string
    name: string
    updatedAt: Date
}): UserTag
{
    return {
        createdAt: row.createdAt.toISOString(),
        id: row.id,
        name: row.name,
        updatedAt: row.updatedAt.toISOString(),
    }
}
