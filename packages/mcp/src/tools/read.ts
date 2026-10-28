import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { accountIdField, toToolResult, type ApiLike } from './shared.js'

const since = z.string().optional().describe('Only items after this time, ISO 8601 with offset or Z, e.g. 2026-10-27T00:00:00Z')
const limit = z.number().int().min(1).max(200).optional().describe('Max rows to return (1 to 200)')
const listId = z.number().int().min(1).optional().describe('Filter to one LeadSync list id')

export function registerReadTools(server: McpServer, client: ApiLike): void {
  server.registerTool(
    'get_me',
    {
      description: 'Returns the account (id, email, username, plan level, subscription), the key (name, scope, can_write_accounts, can_test_lead), acting_on_other_account and limits; no balance. Use it first to confirm which account you are working on.',
      inputSchema: { account_id: accountIdField },
    },
    async ({ account_id }) => toToolResult(await client.request('GET', '/api/v1/me', { accountId: account_id })),
  )

  server.registerTool(
    'find_accounts',
    {
      description: 'Admin keys only. Matches email, username or page name, up to 20 accounts, so you can pick an account_id to act on.',
      inputSchema: { q: z.string().min(1).describe('Search text: email, username or page name'), account_id: accountIdField },
    },
    async ({ q, account_id }) => toToolResult(await client.request('GET', '/api/v1/accounts', { query: { q }, accountId: account_id })),
  )

  server.registerTool(
    'get_connections',
    {
      description: 'Returns the sources (pages) -> lists graph (each list with `active`, `mapping_set` and its destinations) plus the account\'s connections with their autoresponders. A source\'s LeadSync page id is `page.id`; its Facebook id is `page.page_fb_id`. Use it to find a page_id, list_id or connection_id. It cannot show a list\'s current mapping, only whether one is set.',
      inputSchema: { account_id: accountIdField },
    },
    async ({ account_id }) => toToolResult(await client.request('GET', '/api/v1/connections', { accountId: account_id })),
  )

  server.registerTool(
    'get_destination_fields',
    {
      description: 'Returns the fields a destination connection accepts, for building a field mapping. For Google Sheets pass sheet_id, the exact TAB NAME inside the spreadsheet, not the spreadsheet id. Ask the human for it (new Google Sheets often use "Sheet1", but a sheet created another way may be "Untitled"); a destination_error with a sheet_id usually means the tab name is wrong, check that before suggesting a reconnect.',
      inputSchema: {
        connection_id: z.number().int().min(1).describe('Connection id from get_connections'),
        sheet_id: z.string().optional().describe('Google Sheets only: the exact TAB NAME inside the spreadsheet, not the spreadsheet id. Ask the human for it (new Google Sheets often use "Sheet1", but a sheet created another way may be "Untitled")'),
        account_id: accountIdField,
      },
    },
    async ({ connection_id, sheet_id, account_id }) =>
      toToolResult(await client.request('GET', `/api/v1/destinations/${connection_id}/fields`, { query: { sheet_id }, accountId: account_id })),
  )

  server.registerTool(
    'list_autoresponders',
    {
      description: 'Lists the account\'s autoresponders and the connection each is attached to. Every lead through a connection gets every autoresponder on it.',
      inputSchema: { account_id: accountIdField },
    },
    async ({ account_id }) => toToolResult(await client.request('GET', '/api/v1/autoresponders', { accountId: account_id })),
  )

  server.registerTool(
    'list_leads',
    {
      description: 'Lists recent leads, newest activity first, with the delivery status for each destination. The first stop for "why didn\'t my lead arrive": check for failed, pending or held deliveries. `since` defaults to 7 days ago and the response echoes the value used as `since_used`; `limit` defaults to 50 (max 200). A lead counts as "never reached LeadSync" only when the window covered its time (pass `since` earlier than the lead\'s time) and fewer than `limit` rows came back; otherwise narrow with list_id, status or since, or escalate.',
      inputSchema: {
        list_id: listId,
        since,
        status: z.enum(['success', 'failed', 'pending', 'held']).optional().describe('Filter by delivery status'),
        limit,
        account_id: accountIdField,
      },
    },
    async ({ list_id, since, status, limit, account_id }) =>
      toToolResult(await client.request('GET', '/api/v1/leads', { query: { list_id, since, status, limit }, accountId: account_id })),
  )

  server.registerTool(
    'list_email_log',
    {
      description: 'Lists emails LeadSync sent (lead notifications, autoresponders, system mail). The first stop for "why didn\'t my lead arrive" when the destination is an email address, or to check an autoresponder fired.',
      inputSchema: {
        list_id: listId,
        type: z.enum(['lead_notification', 'autoresponder', 'system', 'test_autoresponder']).optional().describe('Filter by email type'),
        since,
        limit,
        account_id: accountIdField,
      },
    },
    async ({ list_id, type, since, limit, account_id }) =>
      toToolResult(await client.request('GET', '/api/v1/email-log', { query: { list_id, type, since, limit }, accountId: account_id })),
  )
}
