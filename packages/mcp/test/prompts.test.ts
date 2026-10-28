import { describe, expect, it } from 'vitest'
import { connect } from './helpers.js'

const args = { page_id: '123456789012345678', form_name: 'Spring Promo', connection_name: 'Demo Sheet' }
const env = { LEADSYNC_API_KEY: 'ls_live_test' }

async function promptText(extra: Record<string, string> = {}) {
  const client = await connect(env)
  const r = await client.getPrompt({ name: 'connect_form_to_destination', arguments: { ...args, ...extra } })
  const m = r.messages[0].content as { type: string; text: string }
  return m.text
}

describe('connect_form_to_destination prompt', () => {
  it('is listed with four arguments, only account_id optional', async () => {
    const client = await connect(env)
    const { prompts } = await client.listPrompts()
    const p = prompts.find((x) => x.name === 'connect_form_to_destination')!
    expect(p).toBeDefined()
    const byName = Object.fromEntries((p.arguments ?? []).map((a) => [a.name, a.required ?? false]))
    expect(byName).toEqual({ account_id: false, page_id: true, form_name: true, connection_name: true })
  })

  it('names the tools in order and includes the inputs', async () => {
    const t = await promptText()
    const order = ['get_connections', 'get_destination_fields', 'attach_form', 'create_autoresponder', 'send_test_lead', 'list_leads', 'list_email_log']
    let at = -1
    for (const name of order) {
      const i = t.indexOf(name, at + 1)
      expect(i, name).toBeGreaterThan(at)
      at = i
    }
    expect(t).toContain('Spring Promo')
    const step = (n: number) => t.split('\n').find((l) => l.startsWith(`${n}. `)) ?? ''
    expect(step(4)).toMatch(/attach_form[^\n]*mapping[^\n]*settings[^\n]*ONE call/)
    for (let n = 1; n <= 7; n++) expect(step(n), `step ${n}`).not.toMatch(/Call set_mapping/)
    expect(t).toMatch(/phone_number/)
    expect(t).toMatch(/page\.id/)
    expect(t).not.toMatch(/sources\[\]\.id/)
    expect(t).toContain('Demo Sheet')
    expect(t).toContain(args.page_id)
  })

  it('includes the account line only when account_id is given', async () => {
    expect(await promptText()).not.toContain('This work is for account')
    const t = await promptText({ account_id: '42' })
    expect(t).toContain('42')
    expect(t).toMatch(/account_id/)
  })

  it('tells the agent to ask the human before both acknowledgements', async () => {
    const t = await promptText()
    expect(t).toMatch(/ask the human[^\n]*acknowledge_shared_connection/i)
    expect(t).toMatch(/ask the human[^\n]*acknowledge_customer_impact/i)
    expect(t).toContain('7 days')
    expect(t).toContain('TAB NAME')
    expect(t).toMatch(/get_destination_fields with the connection_id[^\n]*sheet_id/)
    expect(t).toMatch(/create_autoresponder with the connection_id/)
    expect(t).not.toMatch(/create_autoresponder for the list/)
    expect(t).toMatch(/page\.id or page\.page_fb_id/)
    expect(t).toMatch(/refresh_forms[^\n]*LeadSync page id/)
    expect(t).toMatch(/custom question keys: call refresh_forms for the page if you have not yet, and use forms\[\]\.questions\[\]\.key for this form \(ask the human only if the form is not listed\)/)
  })

  it('stops and waits for the human before gated writes', async () => {
    const t = await promptText()
    expect(t).toMatch(/wait for the human's yes/i)
    expect(t).not.toMatch(/Warn the human first/)
    expect(t).toMatch(/leads_count/)
    expect(t).toMatch(/replaces the whole mapping/i)
  })
})
