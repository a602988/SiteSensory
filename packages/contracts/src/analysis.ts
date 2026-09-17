import { z } from 'zod'

import { PAGE_TYPE_KEYS } from './taxonomy.js'

const confidenceSchema = z.number().min(0).max(1)

const evidenceSchema = z.object({
    confidence: confidenceSchema,
    evidence: z.string().trim().min(1).max(1000),
})

const languageSchema = evidenceSchema.extend({
    code: z.string().trim().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/),
    role: z.enum(['primary', 'supported']),
})

const taxonomyTagSchema = evidenceSchema.extend({
    group: z.enum(['industry', 'style', 'layout', 'color', 'motion']),
    key: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
})

const pendingTagSchema = evidenceSchema.extend({
    group: z.enum(['industry', 'style', 'layout', 'color', 'motion']),
    suggestedName: z.string().trim().min(1).max(80),
})

const regionSchema = z.object({
    height: z.number().positive().max(1),
    label: z.string().trim().min(1).max(80),
    width: z.number().positive().max(1),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
}).refine(region => region.x + region.width <= 1, {
    message: '區域寬度超出圖片範圍',
}).refine(region => region.y + region.height <= 1, {
    message: '區域高度超出圖片範圍',
})

const aestheticScoreSchema = z.object({
    color: z.number().min(1).max(5),
    completion: z.number().min(1).max(5),
    consistency: z.number().min(1).max(5),
    hierarchy: z.number().min(1).max(5),
    rationale: z.string().trim().min(1).max(2000),
    typography: z.number().min(1).max(5),
})

export const analysisResultSchema = z.object({
    aestheticScores: aestheticScoreSchema,
    analysisSummary: z.string().trim().min(1).max(1000),
    languages: z.array(languageSchema).min(1),
    motionLevel: z.enum(['static', 'light', 'moderate', 'high']),
    pageType: evidenceSchema.extend({
        key: z.enum(PAGE_TYPE_KEYS),
    }),
    pendingTags: z.array(pendingTagSchema),
    schemaVersion: z.literal('1.0.0'),
    secondaryPageTypes: z.array(z.enum(PAGE_TYPE_KEYS)),
    suggestedRegions: z.array(regionSchema),
    tags: z.array(taxonomyTagSchema),
})

export type AnalysisResult = z.infer<typeof analysisResultSchema>
