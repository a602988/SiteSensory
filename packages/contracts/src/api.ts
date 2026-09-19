import { z } from 'zod'

import { JOB_STATES } from './job-state.js'
import { PAGE_TYPE_KEYS } from './taxonomy.js'

const normalizedCoordinateSchema = z.number().min(0).max(1)

export const apiErrorSchema = z.object({
    code: z.string().min(1),
    details: z.unknown().nullable(),
    message: z.string().min(1),
    request_id: z.string().min(1),
})

export const pageIdParamsSchema = z.object({
    pageId: z.uuid(),
})

export const resourceIdParamsSchema = z.object({
    id: z.uuid(),
})

export const pageSearchQuerySchema = z.object({
    domain: z.string().trim().min(1).max(253).optional(),
    language: z.string().trim().min(2).max(35).optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageType: z.string().trim().min(1).max(80).optional(),
    query: z.string().trim().max(200).optional(),
    tag: z.string().trim().min(1).max(80).optional(),
})

export const manualPageUploadQuerySchema = z.object({
    sourceUrl: z.url(),
    title: z.string().trim().min(1).max(300),
}).refine(input => {
    const protocol = new URL(input.sourceUrl).protocol

    return protocol === 'http:' || protocol === 'https:'
}, {
    message: '網址只允許 http 或 https。',
    path: ['sourceUrl'],
})

export const pageSummarySchema = z.object({
    createdAt: z.iso.datetime(),
    domain: z.string(),
    fullPageAssetUrl: z.string(),
    id: z.uuid(),
    language: z.string().nullable(),
    pageType: z.string().nullable(),
    pageVersionId: z.uuid(),
    publishedAt: z.iso.datetime().nullable(),
    sourceUrl: z.string(),
    summary: z.string().nullable(),
    thumbnailAssetUrl: z.string(),
    title: z.string(),
    viewportAssetUrl: z.string(),
})

export const pageListSchema = z.object({
    hasMore: z.boolean(),
    items: z.array(pageSummarySchema),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    total: z.number().int().nonnegative(),
})

export const searchTagSchema = z.object({
    group: z.enum(['industry', 'style', 'layout', 'color', 'motion']),
    key: z.string().min(1),
    name: z.string().min(1),
})

export const pageDetailSchema = pageSummarySchema.extend({
    height: z.number().nullable(),
    tags: z.array(searchTagSchema),
    width: z.number().nullable(),
})

export const similarSearchInputSchema = z.object({
    height: z.number().positive().max(1),
    pageVersionId: z.uuid(),
    width: z.number().positive().max(1),
    x: normalizedCoordinateSchema,
    y: normalizedCoordinateSchema,
}).refine(region => region.x + region.width <= 1, {
    message: '框選範圍超出圖片寬度。',
    path: ['width'],
}).refine(region => region.y + region.height <= 1, {
    message: '框選範圍超出圖片高度。',
    path: ['height'],
})

export const similarPageSchema = pageSummarySchema.extend({
    reasons: z.array(z.string().min(1)),
    score: z.number().min(0).max(1),
})

export const similarPageListSchema = z.object({
    items: z.array(similarPageSchema),
})

export const savedViewInputSchema = similarSearchInputSchema.extend({
    reason: z.string().trim().max(2000).nullable().optional(),
    tagIds: z.array(z.uuid()).max(20).default([]),
})

export const savedViewUpdateSchema = z.object({
    reason: z.string().trim().max(2000).nullable(),
    tagIds: z.array(z.uuid()).max(20),
}).partial().refine(value => Object.keys(value).length > 0, {
    message: '至少需要提供一個要更新的欄位。',
})

export const savedViewSchema = z.object({
    createdAt: z.iso.datetime(),
    domain: z.string(),
    height: z.number(),
    id: z.uuid(),
    pageId: z.uuid(),
    pageVersionId: z.uuid(),
    previewAssetUrl: z.string(),
    reason: z.string().nullable(),
    sourceUrl: z.string(),
    tagIds: z.array(z.uuid()),
    title: z.string(),
    updatedAt: z.iso.datetime(),
    width: z.number(),
    x: z.number(),
    y: z.number(),
})

export const savedViewListSchema = z.object({
    hasMore: z.boolean(),
    items: z.array(savedViewSchema),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    total: z.number().int().nonnegative(),
})

export const savedViewListQuerySchema = z.object({
    page: z.coerce.number().int().min(1).max(10_000).default(1),
})

export const userTagInputSchema = z.object({
    name: z.string().trim().min(1).max(80),
})

export const userTagSchema = z.object({
    createdAt: z.iso.datetime(),
    id: z.uuid(),
    name: z.string(),
    updatedAt: z.iso.datetime(),
})

export const userTagListSchema = z.object({
    items: z.array(userTagSchema),
})

export const ingestionInputSchema = z.object({
    idempotencyKey: z.string().trim().min(8).max(200),
    url: z.url(),
}).refine(input => {
    const protocol = new URL(input.url).protocol

    return protocol === 'http:' || protocol === 'https:'
}, {
    message: '網址只允許 http 或 https。',
    path: ['url'],
})

export const ingestionJobSchema = z.object({
    createdAt: z.iso.datetime(),
    currentStage: z.string().nullable(),
    id: z.uuid(),
    inputUrl: z.string(),
    lastErrorCode: z.string().nullable(),
    normalizedUrl: z.string().nullable(),
    retryCount: z.number().int().nonnegative(),
    state: z.enum(JOB_STATES),
})

export const capturedPageInputSchema = z.object({
    contentFingerprint: z.string().trim().min(8).max(128),
    finalUrl: z.url(),
    fullPageAsset: z.object({
        byteSize: z.number().int().nonnegative(),
        height: z.number().int().positive(),
        objectKey: z.string().trim().min(1).max(500),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        width: z.number().int().positive(),
    }),
    language: z.string().trim().min(2).max(35).nullable(),
    pageType: z.enum(PAGE_TYPE_KEYS).optional(),
    sourceName: z.string().trim().min(1).max(200),
    sourceUrl: z.url(),
    summary: z.string().trim().max(2000).nullable(),
    title: z.string().trim().min(1).max(300),
    viewportAsset: z.object({
        byteSize: z.number().int().nonnegative(),
        height: z.number().int().positive(),
        objectKey: z.string().trim().min(1).max(500),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        width: z.number().int().positive(),
    }),
})

export type SavedView = z.infer<typeof savedViewSchema>
export type IngestionJob = z.infer<typeof ingestionJobSchema>
export type ManualPageUploadQuery = z.infer<typeof manualPageUploadQuerySchema>
export type CapturedPageInput = z.infer<typeof capturedPageInputSchema>
export type PageDetail = z.infer<typeof pageDetailSchema>
export type PageList = z.infer<typeof pageListSchema>
export type PageSummary = z.infer<typeof pageSummarySchema>
export type SearchTag = z.infer<typeof searchTagSchema>
export type SimilarPage = z.infer<typeof similarPageSchema>
export type SavedViewList = z.infer<typeof savedViewListSchema>
export type SavedViewInput = z.infer<typeof savedViewInputSchema>
export type SavedViewUpdate = z.infer<typeof savedViewUpdateSchema>
export type UserTag = z.infer<typeof userTagSchema>
export type UserTagInput = z.infer<typeof userTagInputSchema>
export type SimilarSearchInput = z.infer<typeof similarSearchInputSchema>
