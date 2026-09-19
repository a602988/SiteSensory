import { lookup as dnsLookup } from 'node:dns/promises'
import {
    BlockList,
    isIP,
} from 'node:net'

const TRACKING_PARAMETERS = new Set([
    'fbclid',
    'gclid',
    'mc_cid',
    'mc_eid',
    'utm_campaign',
    'utm_content',
    'utm_medium',
    'utm_source',
    'utm_term',
])

const blockedAddresses = new BlockList()

for (const [network, prefix] of [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
] as const) {
    blockedAddresses.addSubnet(network, prefix, 'ipv4')
}

for (const [network, prefix] of [
    ['::', 128],
    ['::1', 128],
    ['2001:db8::', 32],
    ['fc00::', 7],
    ['fe80::', 10],
    ['ff00::', 8],
] as const) {
    blockedAddresses.addSubnet(network, prefix, 'ipv6')
}

export type AddressLookup = (hostname: string) => Promise<Array<{
    address: string
    family: 4 | 6
}>>

export type RedirectRequester = (
    url: string,
) => Promise<{
    headers: { get(name: string): string | null }
    status: number
}>

export class UrlSafetyError extends Error
{
    readonly code: string

    /**
     * 建立可安全回傳給內部呼叫端的網址錯誤。
     *
     * @param code 穩定錯誤碼。
     * @param message 不含主機內部資訊的錯誤說明。
     */
    constructor(code: string, message: string)
    {
        super(message)
        this.code = code
        this.name = 'UrlSafetyError'
    }
}

/**
 * 將可收錄網址轉成穩定比較格式。
 *
 * @param input 呼叫端提供的網址。
 * @returns 可用於去重的正規網址。
 */
export function normalizeUrl(input: string): string
{
    let url: URL

    try {
        url = new URL(input)
    }
    catch {
        throw new UrlSafetyError('INVALID_URL', '網址格式不正確。')
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new UrlSafetyError('UNSUPPORTED_PROTOCOL', '網址只允許 http 或 https。')
    }

    if (url.username || url.password) {
        throw new UrlSafetyError('URL_CREDENTIALS_FORBIDDEN', '網址不能包含帳號或密碼。')
    }

    url.hash = ''
    url.hostname = url.hostname.toLowerCase()

    if ((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')) {
        url.port = ''
    }

    for (const key of [...url.searchParams.keys()]) {
        if (TRACKING_PARAMETERS.has(key.toLowerCase())) url.searchParams.delete(key)
    }

    url.searchParams.sort()

    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '') || '/'

    return url.toString()
}

/**
 * 確認網址目前解析出的所有位址都可供公開網站擷取。
 *
 * @param input 已正規化或原始網址。
 * @param lookup 可注入測試結果的 DNS 查詢函式。
 * @returns 驗證通過時不回傳內容。
 */
export async function assertPublicUrl(
    input: string,
    lookup: AddressLookup = lookupAddresses,
): Promise<void>
{
    const url = new URL(normalizeUrl(input))
    const hostname = url.hostname.replace(/^\[|\]$/g, '')

    if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
        throw new UrlSafetyError('PRIVATE_DESTINATION', '網址不能指向本機或私人網路。')
    }

    let addresses: Awaited<ReturnType<AddressLookup>>

    try {
        addresses = await lookup(hostname)
    }
    catch {
        throw new UrlSafetyError('DNS_LOOKUP_FAILED', '無法解析網址主機。')
    }

    if (addresses.length === 0) throw new UrlSafetyError('DNS_LOOKUP_FAILED', '網址主機沒有可用位址。')

    for (const result of addresses) {
        const family = isIP(result.address)

        if (family === 0 || family !== result.family) {
            throw new UrlSafetyError('INVALID_DNS_RESULT', '網址主機回傳無效位址。')
        }

        const type = family === 4 ? 'ipv4' : 'ipv6'

        if (blockedAddresses.check(result.address, type)) {
            throw new UrlSafetyError('PRIVATE_DESTINATION', '網址不能指向本機或私人網路。')
        }
    }
}

/**
 * 逐段驗證 redirect，避免公開網址轉向內部服務。
 *
 * @param input 起始網址。
 * @param requester 只讀取狀態與 Location 的請求函式。
 * @param lookup 可注入測試結果的 DNS 查詢函式。
 * @param maxRedirects 允許的 redirect 上限。
 * @returns 最後通過安全檢查的正規網址。
 */
export async function followSafeRedirects(
    input: string,
    requester: RedirectRequester = requestRedirect,
    lookup: AddressLookup = lookupAddresses,
    maxRedirects = 10,
): Promise<string>
{
    let current = normalizeUrl(input)

    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
        await assertPublicUrl(current, lookup)

        const response = await requester(current)

        if (![301, 302, 303, 307, 308].includes(response.status)) return current

        const location = response.headers.get('location')

        if (!location) throw new UrlSafetyError('INVALID_REDIRECT', '重新導向缺少目標網址。')
        if (redirectCount === maxRedirects) throw new UrlSafetyError('TOO_MANY_REDIRECTS', '重新導向次數超過限制。')

        current = normalizeUrl(new URL(location, current).toString())
    }

    throw new UrlSafetyError('TOO_MANY_REDIRECTS', '重新導向次數超過限制。')
}

/**
 * 使用系統 DNS 取得主機的所有 IPv4 與 IPv6 位址。
 *
 * @param hostname 目標主機名稱。
 * @returns DNS 位址與 family。
 */
async function lookupAddresses(hostname: string): ReturnType<AddressLookup>
{
    const results = await dnsLookup(hostname, { all: true, verbatim: true })

    return results.map(result => {
        if (result.family !== 4 && result.family !== 6) {
            throw new UrlSafetyError('INVALID_DNS_RESULT', '網址主機回傳無效位址。')
        }

        return {
            address: result.address,
            family: result.family,
        }
    })
}

/**
 * 以不自動跟隨 redirect 的 HEAD 請求取得下一個位置。
 *
 * @param url 已通過安全檢查的網址。
 * @returns HTTP 狀態與 response header。
 */
async function requestRedirect(url: string): ReturnType<RedirectRequester>
{
    return fetch(url, {
        method: 'HEAD',
        redirect: 'manual',
        signal: AbortSignal.timeout(15_000),
    })
}
