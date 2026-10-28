# Security

## Reporting a problem

Please email security reports to **support@leadsync.me** (subject starting "Security:") rather than opening a public issue. Include what you found, how to reproduce it, and the package and version (`@leadsync/mcp` or `@leadsync/skills`). We will confirm we have it and keep you posted while we fix it.

## How keys are handled

- LeadSync stores API keys hashed. A key is shown once when you create it, and `npx @leadsync/skills login` receives it once.
- `login` saves the key to `~/.leadsync/.env` (folder mode 700, file mode 600) and prints only the file path and your account email, never the key.
- The MCP server sends the key only to the LeadSync API, never prints it, and redacts it from tool output.
- The installer does not put the key in any assistant's config file.

## If a key leaks

Revoke it in LeadSync under **Account, Settings, API keys** (https://leadsync.me/account/settings#api-keys), then create a new one or run `npx @leadsync/skills login` again.

## Supported versions

Security fixes go into the latest 0.1.x release of both packages.
