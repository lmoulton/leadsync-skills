# Releasing

`@leadsync/mcp` (the server, `packages/mcp`), `@leadsync/skills` (the installer, the repository root) and the Claude Code plugin share one version and are released together. Releases publish from GitHub Actions (`.github/workflows/publish.yml`) with npm trusted publishing and provenance, so no npm token is stored anywhere.

## First publish (once, by hand)

npm trusted publishing is set up in a package's settings on npmjs.com, so the package has to exist first and 0.1.0 goes out by hand. This is the only time an npm login or a 2FA code is involved.

Before you start: on npmjs.com, check that the organisation `leadsync` exists and that your npm user is an owner of it (your avatar, Organizations). If it does not exist, create it at https://www.npmjs.com/org/create (the free plan covers public packages). Without it, step 2 fails with "Scope not found".

1. In a terminal at the root of your leadsync-skills clone, on an up-to-date `main` (`git checkout main && git pull`), run `npm login` (browser sign-in as the npm user that owns the `leadsync` organisation).
2. `cd packages/mcp && npm ci && npm run build && npm publish --access public` (enter the 2FA code when asked).
3. `cd ../.. && npm publish --access public` (2FA again).
4. On npmjs.com: open `@leadsync/mcp`, Settings, "Trusted Publisher", choose GitHub Actions, organisation or user `lmoulton`, repository `leadsync-skills`, workflow filename `publish.yml`, environment blank, and leave **Allow npm publish** and **Allow npm dist-tag** unticked, so the workflow can only stage versions for you to approve. Save. Repeat for `@leadsync/skills`. npm expires a trusted publisher that has not published within 2 days of being saved: if you will not cut the next release (below) within 2 days, skip this step now and do it on the day of that release.
5. Make the code public with a fresh history. Do not switch the existing private repository to public: its earlier commits are not for publication, and a visibility change cannot be taken back. From the root of your clone, on an up-to-date `main`:
   ```bash
   gh repo rename leadsync-skills-private -R lmoulton/leadsync-skills --yes
   git checkout --orphan public-main
   git commit -m "LeadSync skills and MCP server 0.1.0"
   gh repo create lmoulton/leadsync-skills --public --description "LeadSync MCP server and skills for Claude Code, Cursor and Codex"
   git push origin public-main:main
   git fetch origin && git checkout -B main origin/main && git branch -D public-main
   ```
   The private repository stays as `leadsync-skills-private` with its history. Every other clone then needs `git fetch origin && git reset --hard origin/main` once. Provenance needs a public repository, so this must happen before the first release from GitHub.
6. Check the publish worked: `npx -y @leadsync/skills@0.1.0 --help` prints the usage text.

After the first release from GitHub succeeds, lock token publishing off on both packages: Settings, Publishing access, "Require two-factor authentication and disallow tokens".

## Every later release

1. Bump the version everywhere (example: 0.1.1):
   ```bash
   npm version 0.1.1 --no-git-tag-version
   (cd packages/mcp && npm version 0.1.1 --no-git-tag-version)
   ```
   Then set the same version by hand in `SERVER_VERSION` (`packages/mcp/src/server.ts`), `.claude-plugin/plugin.json` (`version`) and `.claude-plugin/marketplace.json` (`metadata.version`). Also set the exact version in `.mcp.json` (`@leadsync/mcp@0.1.1`): Anthropic's plugin directory blocks an npx launcher without an exact version, and the publish workflow checks it matches the tag. And set `version` and `packages[0].version` in `server.json` (the official MCP Registry entry); the workflow checks those too.
2. Run `npm test` at the root and `npm test && npm run build` in `packages/mcp`, commit (`Update: release 0.1.1`), and merge to `main`.
3. Tag and release from `main`:
   ```bash
   git tag v0.1.1 && git push origin v0.1.1
   gh release create v0.1.1 --title v0.1.1 --generate-notes
   ```
   Publishing the release starts `publish.yml`. It refuses to publish if the tag does not match every version above, then tests, builds and stages `@leadsync/mcp` first and `@leadsync/skills` second.
4. Approve both staged versions with your 2FA code: on npmjs.com open each package and its **Staged** tab, or run `npm stage list @leadsync/mcp` and `npm stage approve <id>` (npm 11.21 or later). The trusted publishers allow staging only, so nothing reaches npm without this step.
5. Watch it with `gh run watch`, then check `npx -y @leadsync/skills@0.1.1 --help` once both are approved.

If the workflow fails after `@leadsync/mcp` was published, fix the cause and re-run it: each publish step skips a version that is already on npm.

## Official MCP Registry

The registry entry is `server.json` at the repository root. Its `name`, `me.leadsync/mcp`, must match `mcpName` in `packages/mcp/package.json`, and the registry only lists a version that is already on npm with that `mcpName`. PulseMCP, GitHub's MCP registry and VS Code read from the registry, so one publish reaches all of them.

The `me.leadsync` namespace is proven with a DNS record, signed by an Ed25519 key kept outside the repository at `~/.config/leadsync/mcp-registry-ed25519.pem` (mode 600) on the release machine.

**Once:** add a TXT record on the apex of `leadsync.me` (DigitalOcean DNS) with the value printed by:

```bash
OPENSSL=/opt/homebrew/opt/openssl@3/bin/openssl   # macOS's LibreSSL has no Ed25519
echo "v=MCPv1; k=ed25519; p=$($OPENSSL pkey -in ~/.config/leadsync/mcp-registry-ed25519.pem -pubout -outform DER | tail -c 32 | base64)"
```

**Each release, after npm has the new version:**

```bash
brew install mcp-publisher   # first time only
PRIVATE_KEY="$(/opt/homebrew/opt/openssl@3/bin/openssl pkey -in ~/.config/leadsync/mcp-registry-ed25519.pem -noout -text | grep -A3 'priv:' | tail -n +2 | tr -d ' :\n')"
mcp-publisher login dns --domain leadsync.me --private-key "$PRIVATE_KEY"
mcp-publisher publish
```

Run `mcp-publisher publish` from the repository root so it reads `server.json`. Never paste the private key anywhere else.
