# LeadSync for Claude and other AI assistants

An MCP server and a set of skills that let Claude (and Cursor, Codex or any MCP client) set up and troubleshoot your [LeadSync](https://leadsync.me) account: connect Meta lead forms to Google Sheets, CRMs and email, map the fields, add autoresponders, send test leads and find out what happened to a lead. More at [leadsync.me/mcp](https://leadsync.me/mcp).

## Install

You need Node.js 20 or later and a LeadSync account (a free trial works).

**Claude Code** (the server plus the skills):

```bash
npx @leadsync/skills --claude
npx @leadsync/skills login
```

**Cursor:** `npx @leadsync/skills --cursor`, then `npx @leadsync/skills login`.

**Codex:** `npx @leadsync/skills --codex`, then `npx @leadsync/skills login`.

`--all` installs into every one of these that is set up on your computer. `--project-dir <dir>` puts Cursor's `mcp.json` and the skills in a project folder instead of your home folder (Claude Code and Codex still register the server for your user). `--uninstall` removes the server and the skills again.

**Claude Code plugin** (an alternative to `--claude`; use one or the other, not both):

```bash
claude plugin marketplace add lmoulton/leadsync-skills
claude plugin install leadsync@leadsync-skills
npx @leadsync/skills login
```

**Claude Desktop, Cursor or any MCP client:** add this to the client's MCP config:

```json
{
  "mcpServers": {
    "leadsync": {
      "command": "npx",
      "args": ["-y", "@leadsync/mcp"],
      "env": { "LEADSYNC_API_KEY": "ls_live_your_key_here" }
    }
  }
}
```

Claude Desktop: Settings, Developer, Edit Config. Cursor: `~/.cursor/mcp.json`. Either put your key in the `env` line or run `npx @leadsync/skills login` and delete the `env` line: a key in `env` always wins over the one `login` saves, including the placeholder.

Restart the assistant after installing or signing in, then try: *"Show me every page and form in my LeadSync account and where their leads go."*

## Getting a key

Either:

- run `npx @leadsync/skills login`: it opens LeadSync in your browser, you approve the device, and the key is saved for you; or
- create a key in LeadSync under **Account, Settings, API keys** (https://leadsync.me/account/settings#api-keys) and paste it into `~/.leadsync/.env` as one line: `LEADSYNC_API_KEY=ls_live_...`.

The key file is `~/.leadsync/.env` (folder mode 700, file mode 600). The server reads each setting from its environment first, then from that file, so no assistant config needs to hold the key. One key covers every page and client in that LeadSync account; an account can have up to 10 active keys. Revoke a key under Account, Settings, API keys.

Keep the key private, like a password. The server never prints it, and the skills tell Claude never to ask for it in chat.

## What Claude can do

| Tool | What it does |
| --- | --- |
| `get_me` | Shows who the key belongs to and its scopes. |
| `find_accounts` | Finds accounts by email, username or page name (LeadSync staff keys only). |
| `get_connections` | Shows the sources (pages) to lists graph (each list with `active`, `mapping_set` and destinations) plus the account's connections with their autoresponders. |
| `refresh_forms` | Re-reads a page's lead forms from Meta, with each form's question keys (`forms[].questions[].key`) to use when mapping. |
| `attach_form` | Connects a form to a destination by creating a list. Send mapping and settings in the same call: a new list replays up to 7 days of leads immediately. |
| `set_list_active` | Pauses or resumes delivery for a list. |
| `set_mapping` | For an existing list: replaces the whole mapping with what you send; settings keys are merged. Send `settings` alone to leave the mapping untouched. |
| `get_destination_fields` | Shows the fields a destination connection accepts. |
| `list_autoresponders` | Lists the account's autoresponders and the connection each is attached to (no filter; autoresponders are never per list). |
| `create_autoresponder` | Adds an autoresponder to a connection. |
| `list_leads` | Lists recent leads and their delivery status. Defaults to the last 7 days and 50 rows; absence is proof only if the window covered the lead's time. |
| `resend_lead` | Requeues a lead's failed or held deliveries. |
| `send_test_lead` | Asks Meta to create a test lead for a list. |
| `list_email_log` | Lists emails sent for a list (notifications and autoresponders). |

One prompt, `connect_form_to_destination`, walks the assistant through attaching a form, mapping fields, adding an autoresponder, sending a test lead and checking it arrived.

The skills (Claude Code and Codex):

- `leadsync-setup`: checks the key with `get_me`, explains scopes, and where keys come from.
- `connecting-lead-forms`: maps fields, attaches a form to a destination with the mapping in the same call, adds an autoresponder, tests and verifies.
- `troubleshooting-lead-delivery`: classifies a missing lead, then decides whether to resend or escalate.

The API itself is documented at [leadsync.me/developers](https://leadsync.me/developers); `docs/openapi.yaml` here is a copy.

## Safety rules

- On a customer account, state what you will do and wait for the human's yes before any write (attach, mapping, pause or resume, autoresponder, test lead, resend). Reads need no yes. The flags `acknowledge_customer_impact`, `acknowledge_shared_connection` and `override_limits` are never sent without the human's yes.
- Test leads go to the list's real destinations, and on a customer account they can email the customer. Ask before sending one.
- Creating an autoresponder on a customer account starts emailing that customer's prospects, so it is gated like any other write.
- Map before you attach: attaching a form to a new list replays up to 7 days of that form's leads to the destination.
- `set_mapping` replaces the whole mapping and no tool can read the current one, so never send a partial mapping to a list that already has one.
- Autoresponders belong to a connection: every lead through that connection gets every autoresponder on it.
- Resending a lead can create duplicates in the destination, and that cannot be undone.

## Settings

| Variable | What it does |
| --- | --- |
| `LEADSYNC_API_KEY` | Required. Your API key. Never written to logs or output. |
| `LEADSYNC_API_BASE` | Optional. Defaults to `https://leadsync.me`. |
| `LEADSYNC_ACCOUNT` | Optional. LeadSync staff only. |

Each is read from the environment first, then from `~/.leadsync/.env`.

## Development

```bash
npm test                     # the installer (node --test)
cd packages/mcp
npm ci
npm test                     # the server (vitest)
npm run build
```

The installer (`installer/`, published as `@leadsync/skills`) has no dependencies and no build step. The server (`packages/mcp`, published as `@leadsync/mcp`) is TypeScript. Release steps are in [RELEASING.md](RELEASING.md); security reports go to the address in [SECURITY.md](SECURITY.md).

## Licence

MIT. See [LICENSE](LICENSE).

LeadSync is an independent product of Plankton Digital Pty Ltd and is not affiliated with, sponsored or endorsed by Meta. Facebook, Instagram and Meta are trademarks of Meta Platforms, Inc.
