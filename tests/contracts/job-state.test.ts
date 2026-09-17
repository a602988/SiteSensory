import { describe, expect, it } from 'vitest'

import {
    assertJobTransition,
    canTransitionJob,
} from '../../packages/contracts/src/index.js'

describe('job state contract', () => {
    it('allows the expected collection path', () => {
        expect(canTransitionJob('queued', 'resolving')).toBe(true)
        expect(canTransitionJob('quality_check', 'published')).toBe(true)
    })

    it('blocks transitions from terminal states', () => {
        expect(canTransitionJob('published', 'capturing')).toBe(false)
        expect(() => assertJobTransition('unchanged', 'published')).toThrow(
            '不允許工作從 unchanged 轉換成 published',
        )
    })
})
