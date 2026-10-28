# Installing the LeadSync MCP server (instructions for AI agents)

These steps are for an AI coding agent (such as Cline) setting up the LeadSync MCP server for a user. The server is published on npm as `@leadsync/mcp` and runs locally over stdio. It needs Node.js 20 or later.

## 1. Add the server

Add this entry to the MCP settings file (for Cline: `cline_mcp_settings.json`):

```json
{
  "mcpServers": {
    "leadsync": {
      "command": "npx",
      "args": ["-y", "@leadsync/mcp@0.1.0"]
    }
  }
}
```

Do not put the API key in this file unless the user asks you to (see step 2).

## 2. Give the server an API key

The user needs a LeadSync account (a free trial works: https://leadsync.me/account/registration). Then ask the user to do one of these:

- **Recommended:** run `npx @leadsync/skills login` in a terminal. It opens LeadSync in the browser; the user checks the code matches and clicks Approve, and the key is saved to `~/.leadsync/.env`. The server reads it from there. Never read or print that file.
- Or create a key in LeadSync under Account, Settings, API keys (https://leadsync.me/account/settings#api-keys) and either save it as one line `LEADSYNC_API_KEY=ls_live_...` in `~/.leadsync/.env`, or add `"env": { "LEADSYNC_API_KEY": "ls_live_..." }` to the entry above.

Never ask the user to paste the key into the chat.

## 3. Check it works

Restart the MCP server, then call the `get_me` tool. It returns the account and the key's scope. If it returns `config_error: LEADSYNC_API_KEY is not set`, step 2 isn't done yet. If it returns `unauthorized`, the key was copied wrong; create a new one.

## 4. First thing to try

Call `get_connections` to see the account's pages, lead forms and destinations, then help the user connect a form. Map fields before attaching a form (attaching replays up to 7 days of leads). Ask the user before any change: attaching forms, changing mappings, adding autoresponders, sending test leads or resending leads.

More detail: README.md in this repository and https://leadsync.me/mcp
