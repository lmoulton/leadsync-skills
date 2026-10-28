import { z } from 'zod'
import type { ApiResult } from '../client.js'

export type ToolResult = { isError?: true; content: { type: 'text'; text: string }[] }

/** Anything with ApiClient's request() shape; lets the missing-key stub stand in. */
export type ApiLike = {
  request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH',
    path: string,
    opts?: { query?: Record<string, string | number | undefined>; body?: unknown; accountId?: string },
  ): Promise<ApiResult<T>>
}

/** Format an ApiResult as an MCP tool result. Errors never throw. */
export function toToolResult<T>(r: ApiResult<T>): ToolResult {
  if (r.ok) return { content: [{ type: 'text', text: JSON.stringify(r.data, null, 2) }] }
  let text = `${r.code}: ${r.detail}`
  if (r.extra) text += '\n' + JSON.stringify(r.extra)
  if (r.retryAfter !== undefined) text += `\nRetry after ${r.retryAfter} seconds.`
  return { isError: true, content: [{ type: 'text', text }] }
}

/** Optional on every tool. Admin keys only. Integer ids (as get_me and find_accounts return them) are coerced to the digit string the header needs. */
export const accountIdField = z
  .union([z.number().int().positive(), z.string().regex(/^\d+$/, 'must be a digit string')])
  .transform((v) => String(v))
  .optional()
  .describe('Admin keys only: the LeadSync account (user id, integer or digit string) to act on; overrides LEADSYNC_ACCOUNT')
