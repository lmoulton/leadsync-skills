import { describe, it, expect } from 'vitest'
import { ApiClient } from '../src/client.js'

type Call = { url: string; init: RequestInit }
function fake(res: Response | Error) {
  const calls: Call[] = []
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    if (res instanceof Error) throw res
    return res
  }) as unknown as typeof fetch
  return { f, calls }
}
const cfg = { apiKey: 'k', apiBase: 'https://x.test/' }
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

describe('ApiClient', () => {
  it('sends bearer and act-as headers', async () => {
    const { f, calls } = fake(json({ ok: 1 }))
    await new ApiClient({ ...cfg, account: '1' }, f).request('GET', '/api/v1/me', { accountId: '42' })
    const h = calls[0].init.headers as Record<string, string>
    expect(calls[0].url).toBe('https://x.test/api/v1/me')
    expect(h['Authorization']).toBe('Bearer k')
    expect(h['X-LeadSync-Account']).toBe('42')
    expect(h['Accept']).toBe('application/json')
    expect(h['Content-Type']).toBeUndefined()
  })
  it('falls back to configured account, omits query undefined, sends JSON body', async () => {
    const { f, calls } = fake(json({}))
    await new ApiClient({ ...cfg, account: '1' }, f).request('POST', '/api/v1/x', { query: { a: 1, b: undefined }, body: { z: 1 } })
    const h = calls[0].init.headers as Record<string, string>
    expect(calls[0].url).toBe('https://x.test/api/v1/x?a=1')
    expect(h['X-LeadSync-Account']).toBe('1')
    expect(h['Content-Type']).toBe('application/json')
    expect(calls[0].init.body).toBe('{"z":1}')
  })
  it('maps problem+json to ok:false with code', async () => {
    const { f } = fake(json({ type: 'about:blank', title: 'Conflict', status: 409, code: 'shared_connection_autoresponder', detail: 'x', existing: [{ id: 1 }] }, 409))
    const r = await new ApiClient(cfg, f).request('GET', '/api/v1/x')
    expect(r).toEqual({ ok: false, status: 409, code: 'shared_connection_autoresponder', detail: 'x', extra: { existing: [{ id: 1 }] } })
  })
  it('uses a fallback code for non-JSON errors', async () => {
    const { f } = fake(new Response('<html>', { status: 502, statusText: 'Bad Gateway' }))
    const r = await new ApiClient(cfg, f).request('GET', '/api/v1/x')
    expect(r).toMatchObject({ ok: false, status: 502, code: 'http_502', detail: 'Bad Gateway' })
  })
  it('returns network failures as ok:false', async () => {
    const { f } = fake(new Error('boom'))
    const r = await new ApiClient(cfg, f).request('GET', '/api/v1/x')
    expect(r).toMatchObject({ ok: false, status: 0, code: 'network_error' })
  })
  it('rateLimitedSurfacesRetryAfter', async () => {
    const { f } = fake(json({ type: 'about:blank', title: 'T', status: 429, code: 'rate_limited', detail: 'slow' }, 429, { 'Retry-After': '40' }))
    const r = await new ApiClient(cfg, f).request('GET', '/api/v1/x')
    expect(r).toMatchObject({ ok: false, code: 'rate_limited', retryAfter: 40 })
  })
  it('strips nulls from data', async () => {
    const { f } = fake(json({ a: null, b: { c: null, d: 1 }, e: [{ f: null, g: 2 }, null] }))
    const r = await new ApiClient(cfg, f).request('GET', '/api/v1/x')
    expect(r).toEqual({ ok: true, data: { b: { d: 1 }, e: [{ g: 2 }, null] } })
  })
})
