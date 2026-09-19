import {
    randomBytes,
    scrypt as scryptCallback,
    timingSafeEqual,
} from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)
const KEY_LENGTH = 64

/**
 * 產生只供本機帳號使用的 scrypt 密碼雜湊。
 *
 * @param password 使用者輸入的原始密碼。
 * @returns 可存入環境設定的版本化密碼雜湊。
 */
export async function hashPassword(password: string): Promise<string>
{
    if (password.length < 8) throw new Error('本機密碼至少需要 8 個字元')

    const salt = randomBytes(16)
    const derivedKey = await scrypt(password, salt, KEY_LENGTH) as Buffer

    return `scrypt-v1$${salt.toString('hex')}$${derivedKey.toString('hex')}`
}

/**
 * 使用固定時間比較本機密碼與已保存的 scrypt 雜湊。
 *
 * @param password 使用者輸入的原始密碼。
 * @param encodedHash 環境設定中的版本化密碼雜湊。
 * @returns 密碼是否相符。
 */
export async function verifyPassword(password: string, encodedHash: string): Promise<boolean>
{
    const [version, saltHex, hashHex] = encodedHash.split('$')

    if (version !== 'scrypt-v1' || !saltHex || !hashHex) return false

    const expected = Buffer.from(hashHex, 'hex')

    if (expected.length !== KEY_LENGTH) return false

    const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), KEY_LENGTH) as Buffer

    return timingSafeEqual(actual, expected)
}
