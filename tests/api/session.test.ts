import {
    afterAll,
    beforeAll,
    describe,
    expect,
    it,
} from 'vitest'

import {
    buildApp,
    type AppOptions,
} from '../../apps/api/src/app.js'
import { hashPassword } from '../../apps/api/src/password.js'

let app: Awaited<ReturnType<typeof buildApp>>

describe('local session API', () => {
    beforeAll(async () => {
        const options: AppOptions = {
            authStore: {
                async getOrCreate(displayName)
                {
                    return {
                        displayName,
                        id: '00000000-0000-0000-0000-000000000001',
                    }
                },
            },
            localAdminName: '本機管理者',
            localPasswordHash: await hashPassword('a-secure-local-password'),
            sessionKey: Buffer.alloc(32, 1),
        }

        app = await buildApp(options)
    })

    afterAll(async () => {
        await app.close()
    })

    it('rejects an incorrect password', async () => {
        const response = await app.inject({
            method: 'POST',
            payload: { password: 'incorrect' },
            url: '/api/v1/session',
        })

        expect(response.statusCode).toBe(401)
        expect(response.json().code).toBe('INVALID_CREDENTIALS')
    })

    it('creates and clears a secure local session', async () => {
        const login = await app.inject({
            method: 'POST',
            payload: { password: 'a-secure-local-password' },
            url: '/api/v1/session',
        })
        const cookie = login.cookies[0]

        expect(login.statusCode).toBe(200)
        expect(cookie?.httpOnly).toBe(true)
        expect(cookie?.sameSite).toBe('Strict')

        const session = await app.inject({
            cookies: { [cookie?.name as string]: cookie?.value as string },
            method: 'GET',
            url: '/api/v1/session',
        })

        expect(session.statusCode).toBe(200)
        expect(session.json().user.displayName).toBe('本機管理者')

        const logout = await app.inject({
            cookies: { [cookie?.name as string]: cookie?.value as string },
            method: 'DELETE',
            url: '/api/v1/session',
        })

        expect(logout.statusCode).toBe(204)
    })
})
