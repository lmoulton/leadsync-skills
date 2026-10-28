# Releasing

`@leadsync/mcp` (the server, `packages/mcp`), `@leadsync/skills` (the installer, the repository root) and the Claude Code plugin share one version and are released together. Releases publish from GitHub Actions (`.github/workflows/publish.yml`) with npm trusted publishing and provenance, so no npm token is stored anywhere.

## First publish (once, by hand)

npm trusted publishing is set up in a package's settings on npmjs.com, so the package has to exist first and 0.1.0 goes out by hand. This is the only time an npm login or a 2FA code is involved.

Before you start: on npmjs.com, check that the organisation `leadsync` exists and that your npm user is an owner of it (your avatar, Organizations). If it does not exist, create it at https://www.npmjs.com/org/create (the free plan covers public packages). Without it, step 2 fails with "Scope not found".

1. In a terminal at the root of your leadsync-skills clone, on an up-to-date `main` (`git checkout main && git pull`), run `npm login` (browser sign-in as the npm user that owns the `leadsync` organisation).
2. `cd packages/mcp && npm ci && npm run build && npm publish --access public` (enter the 2FA code when asked).
3. `cd ../.. && npm publish --access public` (2FA again).
4. On npmjs.com: open `@leadsync/mcp`, Settings, "Trusted Publisher", choose GitHub Actions, organisation or user `lmoulton`, repository `leadsync-skills`, workflow filename `publish.yml`, environment blank, and under allowed actions tick `npm publish`. Save. Repeat for `@leadsync/skills`. npm expires a trusted publisher that has not published within 2 days of being saved: if you will not cut the next release (below) within 2 days, skip this step now and do it on the day of that release.
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
   Then set the same version by hand in `SERVER_VERSION` (`packages/mcp/src/server.ts`), `.claude-plugin/plugin.json` (`version`) and `.claude-plugin/marketplace.json` (`metadata.version`). Also set the exact version in `.mcp.json` (`@leadsync/mcp@0.1.1`): Anthropic's plugin directory blocks an npx launcher without an exact version, and the publish workflow checks it matches the tag.
2. Run `npm test` at the root and `npm test && npm run build` in `packages/mcp`, commit (`Update: release 0.1.1`), and merge to `main`.
3. Tag and release from `main`:
   ```bash
   git tag v0.1.1 && git push origin v0.1.1
   gh release create v0.1.1 --title v0.1.1 --generate-notes
   ```
   Publishing the release starts `publish.yml`. It refuses to publish if the tag does not match every version above, then tests, builds and publishes `@leadsync/mcp` first and `@leadsync/skills` second.
4. Watch it with `gh run watch`, then check `npx -y @leadsync/skills@0.1.1 --help`.

If the workflow fails after `@leadsync/mcp` was published, fix the cause and re-run it: each publish step skips a version that is already on npm.
