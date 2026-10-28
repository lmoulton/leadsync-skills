# Design: customer access to the LeadSync API and MCP server

This is the design behind the public release of `@leadsync/mcp` and `@leadsync/skills`: how customers get a key, how the assistant finds it, and what is not included yet. The API reference lives at [leadsync.me/developers](https://leadsync.me/developers), rendered from the OpenAPI document copied in `openapi.yaml`.

## What a customer does

1. Creates a key under **Account, Settings, API keys** in LeadSync, or skips that and runs `npx @leadsync/skills login`.
2. Installs with `npx @leadsync/skills --claude` (or `--cursor`, `--codex`), or pastes a JSON snippet that runs `npx -y @leadsync/mcp` into Claude Desktop, Cursor or another MCP client.

The MCP server works on every plan, including the trial. Plan limits still apply.

## Decisions

**Who can create keys.** Any logged-in account, trial or paid, cancelled included; the API refuses writes on an inactive account with `account_inactive`. Team members can create or revoke keys only with the all-access role, the same rule as the Profile link in the account menu.

**Account keys.** Customer keys have scope `account`. They can write and can send test leads on their own account, with no acknowledgement flag needed there. An account can have at most 10 active keys, each named by the customer (1 to 80 characters).

**Device-code login.** `login` follows RFC 8628, like `gh auth login`:

- `POST /api/v1/device/code` (no auth, optional `client_name` up to 80 characters) returns a `device_code`, a `user_code` shown as `XXXX-XXXX`, `verification_uri` (`/account/device`), `verification_uri_complete`, `expires_in` (900) and `interval` (5).
- The customer signs in and approves on `/account/device`, which creates an account key named after the device.
- The CLI polls `POST /api/v1/device/token` with the `device_code` every `interval` seconds (5 more after `slow_down`) and receives `{api_key, key_name, account: {id, email}}` exactly once. The server keeps the plaintext key only between approval and that first successful poll, then clears it.
- Errors are RFC 7807 problem documents; the CLI reads their `code`: `authorization_pending`, `slow_down`, `expired_token`, `access_denied`, `invalid_grant`. Starts are limited to 20 per IP address per 10 minutes.

**Key file.** `login` writes `LEADSYNC_API_KEY` to `~/.leadsync/.env` (folder mode 700, file mode 600, `KEY=value` lines). The MCP server reads each setting from its environment first, then from that file, so host configs never carry the key. Nothing prints the key: `login` prints the file path and the account email, and the server redacts the key from tool output.

**Form questions.** `POST /api/v1/pages/{id}/forms/refresh` returns each form's questions as `questions: [{key, label, type}]`, so an assistant can map custom questions without guessing their keys.

**Installer.** `@leadsync/skills` has no dependencies. It registers `npx -y @leadsync/mcp@<version>` under the name `leadsync` through each host's own CLI (`claude mcp add`, `codex mcp add`) or a JSON merge into Cursor's `mcp.json` that keeps every other server and will not replace a different `leadsync` entry without `--force`. It copies the skills for Claude Code and Codex.

**Packaging.** `@leadsync/mcp` (the server, from `packages/mcp`) and `@leadsync/skills` (the installer and `login`, from the repository root) are published to npm under the MIT licence, with provenance, from GitHub Actions. The Claude Code plugin's `.mcp.json` runs `npx -y @leadsync/mcp@0.1`, so a plugin installed from this repository needs no build.

## Not included yet

- A skill for building Meta lead ad campaigns.
- OAuth sign-in for MCP clients and listings in MCP directories.
- Reading a list's current mapping.
- Writes for Google, LinkedIn and TikTok lead forms (the tools cover Meta lead forms).
- Renewing an expired Facebook page token through the API: it returns `reconnect_required`, and the customer reconnects in the LeadSync app.
