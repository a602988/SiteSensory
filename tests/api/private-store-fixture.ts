import { randomUUID } from 'node:crypto'

import type { PrivateStore } from '../../apps/api/src/private-store.js'
import type {
    SavedView,
    UserTag,
} from '../../packages/contracts/src/api.js'

type OwnedSavedView = SavedView & { userId: string }
type OwnedTag = UserTag & { userId: string }

/**
 * 建立不接觸資料庫的私人資料存取介面，供 API 權限測試使用。
 *
 * @returns 依使用者隔離收藏與標籤的記憶體實作。
 */
export function createMemoryPrivateStore(): PrivateStore
{
    const savedViews = new Map<string, OwnedSavedView>()
    const tags = new Map<string, OwnedTag>()

    return {
        async createSavedView(userId, input)
        {
            const ownsTags = input.tagIds.every(tagId => tags.get(tagId)?.userId === userId)

            if (!ownsTags) return null

            const timestamp = new Date().toISOString()
            const savedView: OwnedSavedView = {
                createdAt: timestamp,
                domain: 'example.com',
                height: input.height,
                id: randomUUID(),
                pageId: '00000000-0000-4000-8000-000000000101',
                pageVersionId: input.pageVersionId,
                previewAssetUrl: '',
                reason: input.reason ?? null,
                sourceUrl: 'https://example.com/',
                tagIds: input.tagIds,
                title: 'Example',
                updatedAt: timestamp,
                userId,
                width: input.width,
                x: input.x,
                y: input.y,
            }
            savedView.previewAssetUrl = `/api/v1/saved-views/${savedView.id}/preview`
            savedViews.set(savedView.id, savedView)

            for (const tagId of input.tagIds) {
                const tag = tags.get(tagId)

                if (tag) tags.set(tagId, { ...tag, updatedAt: timestamp })
            }

            return savedView
        },
        async createTag(userId, input)
        {
            const timestamp = new Date().toISOString()
            const tag: OwnedTag = {
                createdAt: timestamp,
                id: randomUUID(),
                name: input.name,
                updatedAt: timestamp,
                userId,
            }
            tags.set(tag.id, tag)

            return tag
        },
        async deleteSavedView(userId, id)
        {
            if (savedViews.get(id)?.userId !== userId) return false

            return savedViews.delete(id)
        },
        async deleteTag(userId, id)
        {
            if (tags.get(id)?.userId !== userId) return false

            return tags.delete(id)
        },
        async getSavedViewPreviewSource(userId, id)
        {
            if (savedViews.get(id)?.userId !== userId) return null

            const view = savedViews.get(id) as OwnedSavedView

            return {
                height: view.height,
                objectKey: 'test.png',
                width: view.width,
                x: view.x,
                y: view.y,
            }
        },
        async listSavedViews(userId, page)
        {
            const items = [...savedViews.values()].filter(item => item.userId === userId)

            return {
                hasMore: false,
                items,
                page,
                pageSize: 18,
                total: items.length,
            }
        },
        async listTags(userId)
        {
            return [...tags.values()]
                .filter(item => item.userId === userId)
                .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        },
        async updateSavedView(userId, id, input)
        {
            const current = savedViews.get(id)

            if (!current || current.userId !== userId) return null
            if (input.tagIds?.some(tagId => tags.get(tagId)?.userId !== userId)) return null

            const updated: OwnedSavedView = {
                ...current,
                reason: input.reason === undefined ? current.reason : input.reason,
                tagIds: input.tagIds ?? current.tagIds,
                updatedAt: new Date().toISOString(),
            }
            savedViews.set(id, updated)

            return updated
        },
        async updateTag(userId, id, input)
        {
            const current = tags.get(id)

            if (!current || current.userId !== userId) return null

            const updated: OwnedTag = {
                ...current,
                name: input.name,
                updatedAt: new Date().toISOString(),
            }
            tags.set(id, updated)

            return updated
        },
    }
}
