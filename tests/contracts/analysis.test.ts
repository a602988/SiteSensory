import { describe, expect, it } from 'vitest'

import { analysisResultSchema } from '../../packages/contracts/src/index.js'

const validResult = {
    aestheticScores: {
        color: 4,
        completion: 4,
        consistency: 5,
        hierarchy: 4,
        rationale: '資訊層級清楚，標題與內容具有穩定對比。',
        typography: 4,
    },
    analysisSummary: '以大型影像和簡潔文字建立品牌敘事。',
    languages: [{
        code: 'zh-TW',
        confidence: 0.98,
        evidence: '主要導覽與內容使用繁體中文。',
        role: 'primary',
    }],
    motionLevel: 'light',
    pageType: {
        confidence: 0.95,
        evidence: '內容介紹品牌歷史與團隊。',
        key: 'about',
    },
    pendingTags: [],
    schemaVersion: '1.0.0',
    secondaryPageTypes: [],
    suggestedRegions: [{
        height: 0.4,
        label: '品牌故事首屏',
        width: 0.8,
        x: 0.1,
        y: 0.1,
    }],
    tags: [{
        confidence: 0.9,
        evidence: '版面使用單一內容欄。',
        group: 'layout',
        key: 'single-column',
    }],
}

describe('analysis result contract', () => {
    it('accepts a complete versioned analysis', () => {
        expect(analysisResultSchema.parse(validResult)).toEqual(validResult)
    })

    it('rejects a region outside the source image', () => {
        const invalidResult = structuredClone(validResult)
        invalidResult.suggestedRegions[0] = {
            height: 0.4,
            label: '超出範圍',
            width: 0.8,
            x: 0.4,
            y: 0.1,
        }

        expect(() => analysisResultSchema.parse(invalidResult)).toThrow(
            '區域寬度超出圖片範圍',
        )
    })
})
