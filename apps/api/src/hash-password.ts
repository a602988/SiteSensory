import { hashPassword } from './password.js'

/**
 * 從環境變數產生本機登入使用的密碼雜湊，避免把原始密碼寫進檔案。
 *
 * @returns 完成時不回傳內容。
 */
async function main(): Promise<void>
{
    const password = process.env.LOCAL_ADMIN_PASSWORD

    if (!password) throw new Error('請先設定 LOCAL_ADMIN_PASSWORD')

    process.stdout.write(`${await hashPassword(password)}\n`)
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : '無法產生密碼雜湊'
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
})
