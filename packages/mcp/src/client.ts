import type { Config } from './config.js'

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; detail: string; extra?: Record<string, unknown>; retryAfter?: number }

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH'
type RequestOpts = { query?: Record<string, string | number | undefined>; body?: unknown; accountId?: string }

const PROBLEM_KEYS = new Set(['type', 'title', 'status', 'code', 'detail'])

function stripNulls(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripNulls)
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v)) if (val !== null) out[k] = stripNulls(val)
    return out
  }
  return v
}

export class ApiClient {
  constructor(private cfg: Config, private fetchImpl: typeof fetch = fetch) {}

  /** Defence in depth: the key must never reach tool output, even if the API or a proxy echoes it. */
  async request<T>(method: Method, path: string, opts: RequestOpts = {}): Promise<ApiResult<T>> {
    const r = await this.send<T>(method, path, opts)
    const key = this.cfg.apiKey
    if (key.length < 8) return r
    const json = JSON.stringify(r)
    return json.includes(key) ? (JSON.parse(json.split(key).join('[redacted]')) as ApiResult<T>) : r
  }

  private async send<T>(method: Method, path: string, opts: RequestOpts): Promise<ApiResult<T>> {
    const url = new URL(this.cfg.apiBase.replace(/\/+$/, '') + path)
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v))

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.cfg.apiKey}`,
      Accept: 'application/json',
    }
    const account = opts.accountId ?? this.cfg.account
    if (account) headers['X-LeadSync-Account'] = account
    const hasBody = opts.body !== undefined
    if (hasBody) headers['Content-Type'] = 'application/json'

    let res: Response
    try {
      res = await this.fetchImpl(url.toString(), { method, headers, body: hasBody ? JSON.stringify(opts.body) : undefined })
    } catch (e) {
      return { ok: false, status: 0, code: 'network_error', detail: e instanceof Error ? e.message : 'Network request failed' }
    }

    const text = await res.text().catch(() => '')
    let parsed: unknown
    try { parsed = text ? JSON.parse(text) : undefined } catch { parsed = undefined }

    if (res.ok) return { ok: true, data: stripNulls(parsed) as T }

    const body = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
    const extra: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(body)) if (!PROBLEM_KEYS.has(k)) extra[k] = v
    const failure: Extract<ApiResult<T>, { ok: false }> = {
      ok: false,
      status: res.status,
      code: typeof body.code === 'string' ? body.code : `http_${res.status}`,
      detail: typeof body.detail === 'string' ? body.detail : res.statusText || `HTTP ${res.status}`,
    }
    if (Object.keys(extra).length) failure.extra = extra
    const ra = res.headers.get('Retry-After')
    if (ra !== null && ra !== '' && Number.isFinite(Number(ra))) failure.retryAfter = Number(ra)
    return failure
  }
}
