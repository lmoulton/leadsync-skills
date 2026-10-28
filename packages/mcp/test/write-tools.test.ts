import { describe, it, expect } from 'vitest'
import { connect, fake, json, text } from './helpers.js'

const env = { LEADSYNC_API_KEY: 'k', LEADSYNC_API_BASE: 'https://x.test' }

describe('write tools', () => {
  it('registers the seven write tools, and they error naming the key when it is missing', async () => {
    const c = await connect({})
    const names = (await c.listTools()).tools.map(t => t.name)
    for (const n of ['refresh_forms', 'attach_form', 'set_list_active', 'set_mapping', 'create_autoresponder', 'resend_lead', 'send_test_lead']) {
      expect(names).toContain(n)
    }
    const r: any = await c.callTool({ name: 'set_list_active', arguments: { list_id: 1, active: false } })
    expect(r.isError).toBe(true)
    expect(text(r)).toContain('LEADSYNC_API_KEY')
  })

  it('attachFormSendsBody: POST /api/v1/lists with string ids and only provided fields', async () => {
    const { f, calls } = fake(json({ list: { id: 3 }, destination: { dls_id: 4 }, backfill: null }, 201))
    const c = await connect(env, f)
    const r: any = await c.callTool({
      name: 'attach_form',
      arguments: {
        page_id: '123456789012345678', form_id: '987654321098765432', form_name: 'Quote form', connection_id: 7,
        mapping: { full_name: 'name', phone: ['phone', 'mobile'] }, settings: { sheet_id: 'Sheet1' },
      },
    })
    expect(r.isError).toBeUndefined()
    expect(calls[0].url).toBe('https://x.test/api/v1/lists')
    expect(calls[0].init.method).toBe('POST')
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      page_id: '123456789012345678', form_id: '987654321098765432', form_name: 'Quote form', connection_id: 7,
      mapping: { full_name: 'name', phone: ['phone', 'mobile'] }, settings: { sheet_id: 'Sheet1' },
    })
    expect(typeof JSON.parse(calls[0].init.body as string).page_id).toBe('string')
  })

  it('attach_form accepts catch_all and omits unset fields', async () => {
    const { f, calls } = fake(json({ list: { id: 3 } }, 201))
    const c = await connect(env, f)
    await c.callTool({ name: 'attach_form', arguments: { page_id: '55', form_id: 'catch_all', connection_id: 2 } })
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ page_id: '55', form_id: 'catch_all', connection_id: 2 })
  })

  it('actAsForbiddenPassesThrough: account_id with an account-scope key surfaces the 403 unchanged', async () => {
    const { f, calls } = fake(json({ type: 't', title: 'Forbidden', status: 403, code: 'act_as_forbidden', detail: 'Only admin keys may act on another account' }, 403))
    const c = await connect(env, f)
    const r: any = await c.callTool({ name: 'set_list_active', arguments: { list_id: 9, active: true, account_id: '42' } })
    expect(r.isError).toBe(true)
    expect(text(r)).toBe('act_as_forbidden: Only admin keys may act on another account')
    expect(calls[0].url).toBe('https://x.test/api/v1/lists/9')
    expect(calls[0].init.method).toBe('PATCH')
    expect((calls[0].init.headers as Record<string, string>)['X-LeadSync-Account']).toBe('42')
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ active: true })
  })

  it('sharedConnectionConflictIncludesExisting: 409 returns the existing autoresponders', async () => {
    const existing = [{ id: 11, name: 'Welcome' }]
    const { f, calls } = fake(json({
      type: 't', title: 'Conflict', status: 409, code: 'shared_connection_autoresponder',
      detail: 'This connection already has autoresponders', existing, message: 'Every lead gets every autoresponder',
    }, 409))
    const c = await connect(env, f)
    const r: any = await c.callTool({
      name: 'create_autoresponder',
      arguments: { connection_id: 7, name: 'Hi', subject: 'Thanks', content: 'Hello #first_name' },
    })
    expect(r.isError).toBe(true)
    expect(text(r)).toContain('shared_connection_autoresponder: This connection already has autoresponders')
    expect(text(r)).toContain(JSON.stringify(existing))
    expect(calls[0].url).toBe('https://x.test/api/v1/autoresponders')
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ connection_id: 7, name: 'Hi', subject: 'Thanks', content: 'Hello #first_name' })
  })

  it('sendTestLeadWithoutAcknowledgeSurfaces400', async () => {
    const { f, calls } = fake(json({ type: 't', title: 'Bad Request', status: 400, code: 'customer_impact_not_acknowledged', detail: 'Acting on another account: set acknowledge_customer_impact' }, 400))
    const c = await connect(env, f)
    const r: any = await c.callTool({ name: 'send_test_lead', arguments: { list_id: 5, account_id: '42' } })
    expect(r.isError).toBe(true)
    expect(text(r)).toMatch(/^customer_impact_not_acknowledged: /)
    expect(calls[0].url).toBe('https://x.test/api/v1/lists/5/test-lead')
    expect(calls[0].init.method).toBe('POST')
    const tool = (await c.listTools()).tools.find(t => t.name === 'send_test_lead')!
    expect(tool.description).toMatch(/ask the human/i)
  })

  it('points the agent at the form question keys from refresh_forms', async () => {
    const c = await connect(env)
    const tools = (await c.listTools()).tools
    const refresh = tools.find(t => t.name === 'refresh_forms')!
    expect(refresh.description).toMatch(/forms\[\]\.questions\[\]/)
    expect(refresh.description).toMatch(/key, label and type/)
    for (const name of ['attach_form', 'set_mapping']) {
      const mapping = (tools.find(t => t.name === name)!.inputSchema.properties as any).mapping
      expect(mapping.description).toMatch(/custom question keys \(forms\[\]\.questions\[\]\.key from refresh_forms\)/)
    }
  })

  it('maps the remaining tools to their paths, verbs and bodies', async () => {
    const { f, calls } = fake(json({ ok: true }))
    const c = await connect(env, f)
    await c.callTool({ name: 'refresh_forms', arguments: { page_id: 111 } })
    await c.callTool({ name: 'set_mapping', arguments: { list_id: 4, mapping: {} } })
    await c.callTool({ name: 'resend_lead', arguments: { leadgen_id: 'abc:7.7_x-1', list_id: 4 } })
    await c.callTool({ name: 'send_test_lead', arguments: { list_id: 4, acknowledge_customer_impact: true } })
    expect(calls.map(x => [x.init.method, x.url])).toEqual([
      ['POST', 'https://x.test/api/v1/pages/111/forms/refresh'],
      ['PUT', 'https://x.test/api/v1/lists/4/mapping'],
      ['POST', 'https://x.test/api/v1/leads/abc%3A7.7_x-1/resend'],
      ['POST', 'https://x.test/api/v1/lists/4/test-lead'],
    ])
    expect(JSON.parse(calls[1].init.body as string)).toEqual({ mapping: {} })
    expect(JSON.parse(calls[2].init.body as string)).toEqual({ list_id: 4 })
    expect(JSON.parse(calls[3].init.body as string)).toEqual({ acknowledge_customer_impact: true })
  })

  it('passes override_limits and acknowledge_shared_connection through in the body', async () => {
    const { f, calls } = fake(json({ ok: true }, 201))
    const c = await connect(env, f)
    await c.callTool({ name: 'create_autoresponder', arguments: { connection_id: 7, name: 'Hi', subject: 'S', content: 'C', acknowledge_shared_connection: true, override_limits: true } })
    await c.callTool({ name: 'attach_form', arguments: { page_id: '55', form_id: 'catch_all', connection_id: 2, override_limits: true } })
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({ acknowledge_shared_connection: true, override_limits: true })
    expect(JSON.parse(calls[1].init.body as string)).toMatchObject({ override_limits: true })
  })

  it('accepts an integer account_id and sends it as the string header', async () => {
    const { f, calls } = fake(json({ ok: true }))
    const c = await connect(env, f)
    const r: any = await c.callTool({ name: 'set_list_active', arguments: { list_id: 9, active: true, account_id: 42 } })
    expect(r.isError).toBeUndefined()
    expect((calls[0].init.headers as Record<string, string>)['X-LeadSync-Account']).toBe('42')
    const r2: any = await c.callTool({ name: 'set_list_active', arguments: { list_id: 9, active: true, account_id: 'abc' } })
    expect(r2.isError).toBe(true)
  })

  it('never prints the API key, on success or error paths, even when a problem body echoes it', async () => {
    const key = 'ls_live_SECRETKEY123'
    const echo = json({ type: 't', title: 'Unauthorized', status: 401, code: 'unauthorized', detail: `Bad header Bearer ${key}`, received: { Authorization: `Bearer ${key}` } }, 401)
    const c1 = await connect({ ...env, LEADSYNC_API_KEY: key }, fake(echo).f)
    const r1: any = await c1.callTool({ name: 'get_me', arguments: {} })
    expect(r1.isError).toBe(true)
    expect(text(r1)).not.toContain(key)
    const c2 = await connect({ ...env, LEADSYNC_API_KEY: key }, fake(json({ account: { id: 1 }, echo: `Bearer ${key}` })).f)
    const r2: any = await c2.callTool({ name: 'get_me', arguments: {} })
    expect(text(r2)).not.toContain(key)
    const c3 = await connect({ ...env, LEADSYNC_API_KEY: key }, (async () => { throw new Error(`connect failed with ${key}`) }) as unknown as typeof fetch)
    const r3: any = await c3.callTool({ name: 'get_me', arguments: {} })
    expect(text(r3)).not.toContain(key)
  })
})
