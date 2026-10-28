import { describe, it, expect } from 'vitest'
import { connect, fake, json, text } from './helpers.js'

describe('read tools', () => {
  it('unreadableKeyFile: server still starts and get_me returns config_error naming the file', async () => {
    const io = { home: () => '/h', readFile: () => { throw Object.assign(new Error("EACCES: permission denied, open '/h/.leadsync/.env'"), { code: 'EACCES' }) } }
    const c = await connect({}, undefined, io)
    const r: any = await c.callTool({ name: 'get_me', arguments: {} })
    expect(r.isError).toBe(true)
    expect(text(r)).toMatch(/^config_error: .*\.leadsync.*\.env could not be read: EACCES: permission denied$/)
  })

  it('apiKeyMissing: server starts and get_me returns an error naming LEADSYNC_API_KEY', async () => {
    const c = await connect({})
    const { tools } = await c.listTools()
    expect(tools.map(t => t.name)).toEqual(expect.arrayContaining(
      ['find_accounts', 'get_connections', 'get_destination_fields', 'get_me', 'list_autoresponders', 'list_email_log', 'list_leads']))
    const r: any = await c.callTool({ name: 'get_me', arguments: {} })
    expect(r.isError).toBe(true)
    expect(text(r)).toBe('config_error: LEADSYNC_API_KEY is not set. Run: npx @leadsync/skills login')
  })

  it('get_connections maps to GET /api/v1/connections', async () => {
    const { f, calls } = fake(json({ connections: [{ id: 1, note: null }] }))
    const c = await connect({ LEADSYNC_API_KEY: 'k', LEADSYNC_API_BASE: 'https://x.test' }, f)
    const r: any = await c.callTool({ name: 'get_connections', arguments: {} })
    expect(calls[0].url).toBe('https://x.test/api/v1/connections')
    expect(calls[0].init.method).toBe('GET')
    expect(JSON.parse(text(r))).toEqual({ connections: [{ id: 1 }] })
  })

  it('list_leads passes query params and account_id header', async () => {
    const { f, calls } = fake(json({ leads: [] }))
    const c = await connect({ LEADSYNC_API_KEY: 'k', LEADSYNC_API_BASE: 'https://x.test', LEADSYNC_ACCOUNT: '5' }, f)
    await c.callTool({ name: 'list_leads', arguments: { list_id: 12, status: 'failed', limit: 10, since: '2026-10-27T00:00:00Z', account_id: '99' } })
    const u = new URL(calls[0].url)
    expect(u.pathname).toBe('/api/v1/leads')
    expect(Object.fromEntries(u.searchParams)).toEqual({ list_id: '12', status: 'failed', limit: '10', since: '2026-10-27T00:00:00Z' })
    expect((calls[0].init.headers as Record<string, string>)['X-LeadSync-Account']).toBe('99')
  })

  it('get_destination_fields maps path and sheet_id', async () => {
    const { f, calls } = fake(json({ fields: [] }))
    const c = await connect({ LEADSYNC_API_KEY: 'k', LEADSYNC_API_BASE: 'https://x.test' }, f)
    await c.callTool({ name: 'get_destination_fields', arguments: { connection_id: 7, sheet_id: 'Sheet1' } })
    expect(calls[0].url).toBe('https://x.test/api/v1/destinations/7/fields?sheet_id=Sheet1')
  })

  it('tool error text starts with the problem code', async () => {
    const { f } = fake(json({ code: 'forbidden', detail: 'Admin keys only', hint: 'x' }, 403))
    const c = await connect({ LEADSYNC_API_KEY: 'k', LEADSYNC_API_BASE: 'https://x.test' }, f)
    const r: any = await c.callTool({ name: 'find_accounts', arguments: { q: 'bob' } })
    expect(r.isError).toBe(true)
    expect(text(r)).toBe('forbidden: Admin keys only\n{"hint":"x"}')
  })

  it('rateLimitedSurfacesRetryAfter', async () => {
    const { f } = fake(json({ code: 'rate_limited', detail: 'Slow down' }, 429, { 'Retry-After': '40' }))
    const c = await connect({ LEADSYNC_API_KEY: 'k', LEADSYNC_API_BASE: 'https://x.test' }, f)
    const r: any = await c.callTool({ name: 'get_me', arguments: {} })
    expect(r.isError).toBe(true)
    expect(text(r)).toContain('Retry after 40 seconds.')
  })

  it('rejects a non-digit account_id and an out-of-range limit', async () => {
    const { f, calls } = fake(json({}))
    const c = await connect({ LEADSYNC_API_KEY: 'k' }, f)
    const r1: any = await c.callTool({ name: 'get_me', arguments: { account_id: 'abc' } }).catch(e => ({ isError: true, e }))
    const r2: any = await c.callTool({ name: 'list_leads', arguments: { limit: 500 } }).catch(e => ({ isError: true, e }))
    expect(r1.isError).toBe(true)
    expect(r2.isError).toBe(true)
    expect(calls.length).toBe(0)
  })
})
