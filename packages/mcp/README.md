# @leadsync/mcp

The MCP server for the [LeadSync](https://leadsync.me) API. It lets Claude and other MCP clients set up and troubleshoot LeadSync lead delivery: connect Meta lead forms to destinations, map fields, add autoresponders, send test leads and check what happened to a lead.

Most people install it with the installer, which also adds the LeadSync skills:

```bash
npx @leadsync/skills --claude    # or --cursor, --codex
npx @leadsync/skills login
```

To run it by hand in any MCP client, use the command `npx -y @leadsync/mcp`. The full guide, the tools list and the safety rules are in the [repository README](https://github.com/lmoulton/leadsync-skills#readme).

## Settings

The server reads each setting from the environment first, then from `~/.leadsync/.env` (one `KEY=value` per line, written by `npx @leadsync/skills login`).

| Variable | What it does |
| --- | --- |
| `LEADSYNC_API_KEY` | Required. Your API key, from Account, Settings, API keys in LeadSync. Never written to logs or tool output. |
| `LEADSYNC_API_BASE` | Optional. Defaults to `https://leadsync.me`. |
| `LEADSYNC_ACCOUNT` | Optional. LeadSync staff only. |

Licence: MIT.
