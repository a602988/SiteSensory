import { describe, expect, it } from 'vitest'

import {
    assertPublicUrl,
    followSafeRedirects,
    normalizeUrl,
    UrlSafetyError,
    type AddressLookup,
} from '../../packages/ingestion/src/index.js'

const publicLookup: AddressLookup = async () => [{ address: '93.184.216.34', family: 4 }]

describe('ingestion URL safety', () => {
    it('normalizes equivalent URL variants without deleting content parameters', () => {
        expect(normalizeUrl('HTTPS://Example.COM:443/news/?utm_source=test&id=42#top'))
            .toBe('https://example.com/news?id=42')
        expect(normalizeUrl('https://例子.测试/')).toBe('https://xn--fsqu00a.xn--0zwm56d/')
    })

    it('rejects credentials and unsupported protocols', () => {
        expect(() => normalizeUrl('ftp://example.com')).toThrow(UrlSafetyError)
        expect(() => normalizeUrl('https://user:secret@example.com')).toThrow('網址不能包含帳號或密碼')
    })

    it.each([
        ['127.0.0.1', 4],
        ['10.1.2.3', 4],
        ['169.254.169.254', 4],
        ['192.168.1.1', 4],
        ['::1', 6],
        ['fe80::1', 6],
    ] as const)('rejects blocked destination %s', async (address, family) => {
        const lookup: AddressLookup = async () => [{ address, family }]

        await expect(assertPublicUrl('https://example.com', lookup)).rejects.toMatchObject({
            code: 'PRIVATE_DESTINATION',
        })
    })

    it('rejects a redirect from a public host to a private destination', async () => {
        const lookup: AddressLookup = async hostname => hostname === 'example.com'
            ? [{ address: '93.184.216.34', family: 4 }]
            : [{ address: '127.0.0.1', family: 4 }]
        const requester = async () => ({
            headers: { get: () => 'http://internal.example/admin' },
            status: 302,
        })

        await expect(followSafeRedirects('https://example.com', requester, lookup)).rejects.toMatchObject({
            code: 'PRIVATE_DESTINATION',
        })
    })

    it('returns the final public URL after safe redirects', async () => {
        const requester = async (url: string) => url.endsWith('/')
            ? { headers: { get: () => '/about' }, status: 301 }
            : { headers: { get: () => null }, status: 200 }

        await expect(followSafeRedirects('https://example.com', requester, publicLookup))
            .resolves.toBe('https://example.com/about')
    })
})
