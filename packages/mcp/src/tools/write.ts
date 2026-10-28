import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { accountIdField, toToolResult, type ApiLike } from './shared.js'

const digits = (what: string) => z.string().regex(/^\d+$/, 'must be a digit string').describe(what)
const pageId = digits('LeadSync page id or Facebook page id (digit string; send it as a string, Meta ids exceed JavaScript safe integers)')
const leadSyncPageId = z.number().int().min(1).describe('LeadSync page id: sources[].page.id from get_connections (not page.page_fb_id)')
const listId = z.number().int().min(1).describe('LeadSync list id from list_leads or attach_form')
const connectionId = z.number().int().min(1).describe('Connection id from get_connections')

const mapping = z
  .record(z.string(), z.union([z.string(), z.array(z.string())]))
  .describe('Lead field key to destination field, e.g. {"first_name":"First name","phone_number":"Phone"}. Keys are lead keys as delivered (first_name, last_name, full_name, email, phone_number, custom question keys (forms[].questions[].key from refresh_forms), created_at, leadgen_id, platform, form_id, form_name, page_id, page_name, ad_account_id, ad_account_name; Google Sheets also leadsync:campaign_name, leadsync:adset_name, leadsync:ad_name). Values are destination field names exactly as get_destination_fields returns them. Replaces any existing mapping')

const settings = z
  .object({
    tags: z.union([z.string(), z.array(z.string())]).optional(),
    existed: z.enum(['', 'ignore', 'update']).optional().describe('What to do when the contact already exists in the destination'),
    send_csv: z.boolean().optional(),
    lead_scoring: z.boolean().optional(),
    call_summary_to: z.string().optional(),
    call_summary_bcc: z.string().optional(),
    call_summary_email: z.string().optional(),
    sheet_id: z.string().optional().describe('Google Sheets only: the exact TAB NAME inside the spreadsheet, not the spreadsheet id. Ask the human for it (new Google Sheets often use "Sheet1", but a sheet created another way may be "Untitled")'),
  })
  .strict()
  .describe('Per-list destination settings')

export function registerWriteTools(server: McpServer, client: ApiLike): void {
  server.registerTool(
    'refresh_forms',
    {
      description: 'Re-reads the page\'s lead forms from Meta so newly created forms appear and attached ones are marked; each form\'s leads_count shows whether it is live, and forms[].questions[] lists its questions (key, label and type): use each key as the form field key when mapping. Takes the LeadSync page id (sources[].page.id from get_connections).',
      inputSchema: { page_id: leadSyncPageId, account_id: accountIdField },
    },
    async ({ page_id, account_id }) =>
      toToolResult(await client.request('POST', `/api/v1/pages/${page_id}/forms/refresh`, { accountId: account_id })),
  )

  server.registerTool(
    'attach_form',
    {
      description:
        'Attaches a lead form to a destination connection by creating a list. Send mapping AND settings in this same call: a NEW list immediately replays up to 7 days of that form\'s leads using the mapping given here, so mapping afterwards delivers the replay unmapped. Idempotent on page, form and connection (an existing list comes back with created false, mapping_applied false and a hint; its mapping is untouched). form_id "catch_all" catches every form on the page; Google Sheets needs settings.sheet_id, the TAB NAME. Gated: on another account, or a live form, wait for the human\'s yes first. override_limits is admin-only and audited.',
      inputSchema: {
        page_id: pageId,
        form_id: z.union([digits('Meta lead form id (digit string)'), z.literal('catch_all')]).describe('Meta lead form id as a digit string, or "catch_all" for every form on the page'),
        form_name: z.string().optional().describe('Required unless form_id is catch_all'),
        connection_id: connectionId,
        mapping: mapping.optional(),
        settings: settings.optional(),
        override_limits: z.boolean().optional().describe('Admin keys with write access only: skip account and plan limits (audited)'),
        account_id: accountIdField,
      },
    },
    async ({ page_id, form_id, form_name, connection_id, mapping, settings, override_limits, account_id }) =>
      toToolResult(
        await client.request('POST', '/api/v1/lists', {
          body: { page_id, form_id, form_name, connection_id, mapping, settings, override_limits },
          accountId: account_id,
        }),
      ),
  )

  server.registerTool(
    'set_list_active',
    {
      description: 'Pauses or resumes delivery for one list. Resuming can use a source slot and is refused if another active list covers the same form and connection.',
      inputSchema: {
        list_id: listId,
        active: z.boolean().describe('true to resume delivery, false to pause it'),
        override_limits: z.boolean().optional().describe('Admin keys with write access only: skip account and plan limits'),
        account_id: accountIdField,
      },
    },
    async ({ list_id, active, override_limits, account_id }) =>
      toToolResult(await client.request('PATCH', `/api/v1/lists/${list_id}`, { body: { active, override_limits }, accountId: account_id })),
  )

  server.registerTool(
    'set_mapping',
    {
      description:
        'Sets an EXISTING list\'s field mapping and/or per-list settings. Replaces the whole mapping with what you send; settings keys are merged. Send `settings` alone to leave the mapping untouched. An empty mapping object clears it. No tool can read the current mapping, so on a list with mapping_set true never send `mapping` unless the human has given the complete mapping; otherwise the change is made in the LeadSync UI. Send at least one of mapping or settings. For a new list, put the mapping in attach_form instead.',
      inputSchema: { list_id: listId, mapping: mapping.optional(), settings: settings.optional(), account_id: accountIdField },
    },
    async ({ list_id, mapping, settings, account_id }) =>
      toToolResult(await client.request('PUT', `/api/v1/lists/${list_id}/mapping`, { body: { mapping, settings }, accountId: account_id })),
  )

  server.registerTool(
    'create_autoresponder',
    {
      description:
        'Creates an email autoresponder on a connection. A gated write on another account: it starts emailing the customer\'s prospects, so wait for the human\'s yes (on another account there may be no 409 warning). Every lead through the connection receives every autoresponder on it; a 409 lists what is already attached, ask the human before acknowledging.',
      inputSchema: {
        connection_id: connectionId,
        name: z.string().min(1).max(80).regex(/^[^\r\n]*$/, 'single line').describe('Single line, up to 80 characters'),
        subject: z.string().min(1).max(255).regex(/^[^\r\n]*$/, 'single line').describe('Single line, up to 255 characters'),
        content: z.string().min(1).describe('Plain text (blank-line paragraphs become paragraphs) or HTML per content_format. Tokens like #first_name pass through'),
        content_format: z.enum(['text', 'html']).optional().describe('Defaults to text'),
        from_name: z.string().max(80).regex(/^[^\r\n]*$/, 'single line').optional().describe('Defaults to LeadSync'),
        reply_email: z.string().email().optional().describe('Defaults to the account email'),
        acknowledge_shared_connection: z.boolean().optional().describe('Set true only after the human has seen the existing autoresponders from a 409 and agreed they will stack'),
        override_limits: z.boolean().optional().describe('Admin keys with write access only: skip plan and quantity limits, never the shared-connection guard'),
        account_id: accountIdField,
      },
    },
    async ({ account_id, ...body }) => toToolResult(await client.request('POST', '/api/v1/autoresponders', { body, accountId: account_id })),
  )

  server.registerTool(
    'resend_lead',
    {
      description:
        'Requeues a Meta lead\'s failed or held deliveries. Meta leads only, only failed or held legs, refused while the lead is still in flight; duplicates are irreversible so check list_leads first. Delivery is asynchronous (about a minute); poll list_leads.',
      inputSchema: {
        leadgen_id: z.string().regex(/^[A-Za-z0-9_.:-]{1,255}$/, 'invalid leadgen id').describe('Lead id (leadgen_id) exactly as returned by list_leads'),
        list_id: listId.optional().describe('Only resend this list\'s delivery'),
        account_id: accountIdField,
      },
    },
    async ({ leadgen_id, list_id, account_id }) =>
      toToolResult(await client.request('POST', `/api/v1/leads/${encodeURIComponent(leadgen_id)}/resend`, { body: { list_id }, accountId: account_id })),
  )

  server.registerTool(
    'send_test_lead',
    {
      description:
        'Asks Meta to create a test lead for a list\'s form. The test lead goes to the list\'s real destinations; on another account it may email the customer, so ask the human before setting acknowledge_customer_impact. Without it on another account the API answers 400 customer_impact_not_acknowledged.',
      inputSchema: {
        list_id: listId,
        acknowledge_customer_impact: z.boolean().optional().describe('Set true only after the human confirmed the customer may be emailed. Required when acting on another account'),
        account_id: accountIdField,
      },
    },
    async ({ list_id, acknowledge_customer_impact, account_id }) =>
      toToolResult(await client.request('POST', `/api/v1/lists/${list_id}/test-lead`, { body: { acknowledge_customer_impact }, accountId: account_id })),
  )
}
