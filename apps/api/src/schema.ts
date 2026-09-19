import type { FastifySchema } from 'fastify'
import { z } from 'zod'

/**
 * 將 Zod 契約轉成 Fastify 與 OpenAPI 共用的 JSON Schema。
 *
 * @param schema Zod 資料契約。
 * @returns 可交給 Fastify 的 JSON Schema。
 */
export function toJsonSchema(schema: z.ZodType): FastifySchema
{
    return z.toJSONSchema(schema, { target: 'draft-7' }) as FastifySchema
}
