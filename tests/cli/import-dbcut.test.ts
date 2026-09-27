import { describe, expect, it } from 'vitest'

import { readPositiveInt } from '../../tools/cli/src/import-dbcut.js'

describe('dbcut import limits', () => {
    it('uses SITE_COUNT when it is a positive integer and otherwise falls back', () => {
        expect(readPositiveInt('2', 6)).toBe(2)
        expect(readPositiveInt('0', 6)).toBe(6)
        expect(readPositiveInt('nope', 6)).toBe(6)
        expect(readPositiveInt(undefined, 6)).toBe(6)
        expect(readPositiveInt('  ', 6)).toBe(6)
    })
})
