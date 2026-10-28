import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

export function connectFormText(a: { account_id?: string; page_id: string; form_name: string; connection_name: string }): string {
  const lines = [
    `Connect the Meta lead form "${a.form_name}" (page id ${a.page_id}, either the LeadSync page id or the Facebook page id) to the destination connection "${a.connection_name}" in LeadSync, then prove it works. Do the steps in order and stop to ask the human whenever a step says so.`,
  ]
  if (a.account_id) {
    lines.push(`This work is for account ${a.account_id}. Pass account_id "${a.account_id}" on every tool call.`)
  }
  lines.push(
    '',
    'Asking first: before attach_form on a form that is receiving live leads (leads_count above 0 from refresh_forms, or recent rows in list_leads), and before EVERY write on another account (attach_form, set_mapping, set_list_active, create_autoresponder, send_test_lead, resend_lead), state exactly what you will do and wait for the human\'s yes. Do not go on until they have said yes. The flags acknowledge_customer_impact, acknowledge_shared_connection and override_limits are never sent without the human\'s yes.',
    '',
    `1. Call get_connections. Find the source (page) whose page.id or page.page_fb_id equals ${a.page_id}; from then on use that source's page.id (the LeadSync page id) as page_id, including for refresh_forms (which accepts only the LeadSync page id) and attach_form. Find the form named "${a.form_name}" and the connection named "${a.connection_name}". If any of them is missing or more than one matches, ask the human to confirm the ids. If the form is not listed, call refresh_forms with that LeadSync page id and look again; its leads_count also shows whether the form is live. Confirm the three ids (page_id, form_id, connection_id) with the human before going on if anything is ambiguous.`,
    '2. Call get_destination_fields with the connection_id. For Google Sheets also pass sheet_id, the exact TAB NAME inside the spreadsheet (not the spreadsheet id); this also proves the tab exists. Ask the human for the exact tab name (new Google Sheets often use "Sheet1", but a sheet created another way may be "Untitled"). A destination_error with a sheet_id usually means the tab name is wrong: check that before suggesting a reconnect.',
    '3. Build the mapping {form_field_key: destination_field}. Keys are lead field keys as delivered to destinations: Meta standard fields first_name, last_name, full_name, email, phone_number (list_leads shows "phone", but the mapping key is phone_number), custom question keys: call refresh_forms for the page if you have not yet, and use forms[].questions[].key for this form (ask the human only if the form is not listed), and metadata keys created_time, created_at (m/d/Y date), leadgen_id, platform, form_id, form_name, page_id, page_name, ad_account_id, ad_account_name. Google Sheets also supports leadsync:campaign_name, leadsync:adset_name and leadsync:ad_name. Values are destination field names exactly as get_destination_fields returned them.',
    '4. Call attach_form with page_id, form_id, form_name, connection_id, mapping AND settings (settings.sheet_id for Google Sheets) in ONE call. Attaching a form to a NEW list replays up to 7 days of that form\'s leads to the destination using the mapping given in this call, which is why the mapping must be in it. Note the list_id in the result. If an existing list comes back (created false, mapping_applied false, a hint), tell the human and do not touch its mapping unless step 4a allows it.',
    '4a. set_mapping is only for an existing list, and it REPLACES the whole mapping with what you send (settings keys are merged; send settings alone to leave the mapping untouched; an empty mapping object clears it). On a list with mapping_set true, never send mapping unless the human has given the complete mapping; otherwise the change is made in the LeadSync UI.',
    '5. Optional: if the human wants an autoresponder, call create_autoresponder with the connection_id (autoresponders attach to the connection, not the list). It is a gated write on another account: it would start emailing the customer\'s prospects. Every lead through that connection receives every autoresponder on it. If the API answers 409, show the human the `existing` autoresponders and ask the human before sending acknowledge_shared_connection. Never set it without their agreement.',
    '6. Call send_test_lead with the list_id. The test lead goes to the real destinations. When working on another account it may email the customer, so ask the human before sending acknowledge_customer_impact. Never set it without their agreement.',
    '7. Call list_leads for the list_id and confirm the test lead was delivered (status success), then call list_email_log for the list_id to confirm the autoresponder or the lead notification email went out. Delivery is asynchronous, so wait about a minute and check again before calling it a failure.',
    '',
    'Finish with a short summary for the human: the ids used, the mapping set, and what the test lead and the email log showed.',
  )
  return lines.join('\n')
}

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    'connect_form_to_destination',
    {
      description: 'Guided setup: attach a Meta lead form to a destination connection, map fields, optionally add an autoresponder, then send a test lead and verify delivery',
      argsSchema: {
        account_id: z.string().optional().describe('Customer account id; leave out to use the key\'s own account (or the default account)'),
        page_id: z.string().describe('LeadSync page id or Facebook page id'),
        form_name: z.string().describe('Name of the lead form to connect'),
        connection_name: z.string().describe('Name of the destination connection, as shown in get_connections'),
      },
    },
    (args) => ({ messages: [{ role: 'user', content: { type: 'text', text: connectFormText(args) } }] }),
  )
}
