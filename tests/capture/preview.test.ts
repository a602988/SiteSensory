import {
    describe,
    expect,
    it,
} from 'vitest'

import {
    createSavedViewPreview,
    createThumbnail,
} from '../../packages/image/src/index.js'

describe('list image previews', () => {
    const source = Buffer.from('<svg width="1200" height="1200" xmlns="http://www.w3.org/2000/svg"><rect width="1200" height="1200" fill="#369"/></svg>')

    it('converts a source screenshot to the list WebP format', async () => {
        const preview = await createThumbnail(source)

        expect(preview.subarray(0, 4).toString()).toBe('RIFF')
        expect(preview.subarray(8, 12).toString()).toBe('WEBP')
    })

    it('crops the saved region before reducing its resolution', async () => {
        const preview = await createSavedViewPreview(source, {
            height: 0.5,
            width: 0.5,
            x: 0.5,
            y: 0.5,
        })

        expect(preview.subarray(0, 4).toString()).toBe('RIFF')
        expect(preview.subarray(8, 12).toString()).toBe('WEBP')
    })
})
