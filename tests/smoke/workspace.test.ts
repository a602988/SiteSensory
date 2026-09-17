import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import {
    DESKTOP_CAPTURE_PROFILE,
    loadEnvironment,
} from '../../packages/config/src/index.js'

const projectRoot = resolve(import.meta.dirname, '../..')

describe('workspace baseline', () => {
    it('uses the confirmed desktop capture size', () => {
        expect(DESKTOP_CAPTURE_PROFILE).toEqual({
            deviceScaleFactor: 1,
            height: 1080,
            key: 'desktop-1920',
            width: 1920,
        })
    })

    it('accepts loopback hosts', () => {
        const environment = loadEnvironment({
            DATABASE_URL: 'postgresql://user:password@127.0.0.1:5432/sitesensory',
        })

        expect(environment.API_HOST).toBe('127.0.0.1')
        expect(environment.WEB_HOST).toBe('127.0.0.1')
    })

    it('rejects non-loopback hosts', () => {
        expect(() => loadEnvironment({
            API_HOST: '0.0.0.0',
            DATABASE_URL: 'postgresql://user:password@127.0.0.1:5432/sitesensory',
        })).toThrow()
    })

    it('pins the database image and publishes it only on loopback', () => {
        const composeText = readFileSync(resolve(projectRoot, 'compose.yaml'), 'utf8')
        const compose = parse(composeText)
        const database = compose.services.database

        expect(database.image).toBe('pgvector/pgvector:0.8.6-pg18-bookworm')
        expect(database.ports).toEqual(['127.0.0.1:${POSTGRES_PORT:-55432}:5432'])
        expect(database.volumes).toEqual(['database-data:/var/lib/postgresql'])
    })
})
