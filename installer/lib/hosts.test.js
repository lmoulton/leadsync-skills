'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { HOSTS, cliInvocation } = require('./hosts')
const { SERVER_SPEC } = require('./config')

const tempHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'leadsync-home-'))
const want = { command: 'npx', args: ['-y', SERVER_SPEC] }
const cursorFile = (dir) => path.join(dir, '.cursor', 'mcp.json')
const writeJson = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 4))
}
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))

/** Records CLI calls and answers each with the next scripted result (default: success). */
function fakeCli(...results) {
  const calls = []
  const runCli = (cmd, args) => {
    calls.push([cmd, ...args])
    return results.shift() ?? { status: 0, stdout: '', stderr: '' }
  }
  return { runCli, calls }
}
const enoent = () => ({ error: Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }), status: null, stdout: '', stderr: '' })

test('cursorCreatesTheFileWhenMissing', () => {
  const home = tempHome()
  const r = HOSTS.cursor.install({ home })
  assert.deepEqual(r, { ok: true, file: cursorFile(home) })
  assert.equal(fs.readFileSync(cursorFile(home), 'utf8'), JSON.stringify({ mcpServers: { leadsync: want } }, null, 2) + '\n')
})

test('cursorMergeKeepsOtherServers', () => {
  const home = tempHome()
  const original = { theme: 'dark', mcpServers: { other: { command: 'x', args: ['1'], env: { A: 'b' } }, more: { url: 'https://m.test' } } }
  writeJson(cursorFile(home), original)
  assert.equal(HOSTS.cursor.install({ home }).ok, true)
  const text = fs.readFileSync(cursorFile(home), 'utf8')
  const expected = { theme: 'dark', mcpServers: { ...original.mcpServers, leadsync: want } }
  assert.deepEqual(JSON.parse(text), expected)
  assert.equal(text, JSON.stringify(expected, null, 2) + '\n')
})

test('cursorRefusesDifferentEntryWithoutForce', () => {
  const home = tempHome()
  writeJson(cursorFile(home), { mcpServers: { leadsync: { command: 'node', args: ['/old/index.js'] } } })
  const before = fs.readFileSync(cursorFile(home), 'utf8')
  assert.deepEqual(HOSTS.cursor.install({ home }), { ok: false, error: 'a different leadsync entry exists; re-run with --force' })
  assert.equal(fs.readFileSync(cursorFile(home), 'utf8'), before)
})

test('cursorAcceptsTheSameEntryInAnotherKeyOrder', () => {
  const home = tempHome()
  writeJson(cursorFile(home), { mcpServers: { leadsync: { args: ['-y', SERVER_SPEC], command: 'npx' } } })
  const before = fs.readFileSync(cursorFile(home), 'utf8')
  assert.deepEqual(HOSTS.cursor.install({ home }), { ok: true, file: cursorFile(home), unchanged: true })
  assert.equal(fs.readFileSync(cursorFile(home), 'utf8'), before)
})

test('cursorForceOverwrites', () => {
  const home = tempHome()
  writeJson(cursorFile(home), { mcpServers: { a: { command: 'a' }, leadsync: { command: 'node', args: ['x'] }, z: { command: 'z' } } })
  assert.equal(HOSTS.cursor.install({ home, force: true }).ok, true)
  const data = readJson(cursorFile(home))
  assert.deepEqual(data.mcpServers.leadsync, want)
  assert.deepEqual(Object.keys(data.mcpServers), ['a', 'leadsync', 'z'])
})

test('cursorRefusesInvalidJsonWithoutTouchingIt', () => {
  const home = tempHome()
  fs.mkdirSync(path.join(home, '.cursor'))
  fs.writeFileSync(cursorFile(home), '{ "mcpServers": { , }')
  const r = HOSTS.cursor.install({ home, force: true })
  assert.equal(r.ok, false)
  assert.match(r.error, /is not valid JSON/)
  assert.ok(r.error.includes(cursorFile(home)))
  assert.equal(fs.readFileSync(cursorFile(home), 'utf8'), '{ "mcpServers": { , }')
})

test('cursorRefusesANonObjectMcpServers', () => {
  const home = tempHome()
  writeJson(cursorFile(home), { mcpServers: ['x'] })
  const r = HOSTS.cursor.install({ home })
  assert.equal(r.ok, false)
  assert.match(r.error, /mcpServers/)
})

test('cursorKeepsTheFileModeAndWritesThroughASymlink', { skip: process.platform === 'win32' }, () => {
  const home = tempHome()
  const real = path.join(tempHome(), 'dotfiles-mcp.json')
  fs.writeFileSync(real, JSON.stringify({ mcpServers: { gh: { command: 'gh-mcp', env: { GITHUB_TOKEN: 'secret' } } } }))
  fs.chmodSync(real, 0o600)
  fs.mkdirSync(path.join(home, '.cursor'))
  fs.symlinkSync(real, cursorFile(home))
  assert.equal(HOSTS.cursor.install({ home }).ok, true)
  assert.ok(fs.lstatSync(cursorFile(home)).isSymbolicLink())
  assert.equal(fs.statSync(real).mode & 0o777, 0o600)
  assert.deepEqual(readJson(real).mcpServers.leadsync, want)
  assert.deepEqual(fs.readdirSync(path.dirname(real)), ['dotfiles-mcp.json'])
})

test('cursorUpgradesAnEntryThisInstallerWroteWithoutForce', () => {
  for (const older of [['-y', '@leadsync/mcp@0.0.9'], ['-y', '@leadsync/mcp'], ['-y', '@leadsync/mcp@0.1']]) {
    const home = tempHome()
    writeJson(cursorFile(home), { mcpServers: { leadsync: { command: 'npx', args: older } } })
    assert.deepEqual(HOSTS.cursor.install({ home }), { ok: true, file: cursorFile(home) })
    assert.deepEqual(readJson(cursorFile(home)).mcpServers.leadsync, want)
  }
})

test('cursorStillRefusesAnEntryCarryingItsOwnEnv', () => {
  const home = tempHome()
  writeJson(cursorFile(home), { mcpServers: { leadsync: { command: 'npx', args: ['-y', '@leadsync/mcp'], env: { LEADSYNC_API_KEY: 'ls_live_x' } } } })
  assert.equal(HOSTS.cursor.install({ home }).ok, false)
})

test('cursorProjectDirWritesTheProjectFile', () => {
  const home = tempHome()
  const project = tempHome()
  assert.deepEqual(HOSTS.cursor.install({ home, projectDir: project }), { ok: true, file: cursorFile(project) })
  assert.equal(fs.existsSync(cursorFile(home)), false)
})

test('cursorUninstallRemovesOnlyLeadsync', () => {
  const home = tempHome()
  writeJson(cursorFile(home), { theme: 'dark', mcpServers: { other: { command: 'x' }, leadsync: want } })
  assert.deepEqual(HOSTS.cursor.uninstall({ home }), { ok: true, file: cursorFile(home) })
  assert.deepEqual(readJson(cursorFile(home)), { theme: 'dark', mcpServers: { other: { command: 'x' } } })
})

test('cursorUninstallWithNothingToRemoveIsOk', () => {
  const home = tempHome()
  assert.deepEqual(HOSTS.cursor.uninstall({ home }), { ok: true, file: cursorFile(home), unchanged: true })
  assert.equal(fs.existsSync(cursorFile(home)), false)
})

test('claudeInstallRemovesThenAdds', () => {
  const { runCli, calls } = fakeCli({ status: 1, stdout: '', stderr: 'No MCP server found with name: leadsync' })
  assert.deepEqual(HOSTS.claude.install({ runCli }), { ok: true })
  assert.deepEqual(calls, [
    ['claude', 'mcp', 'remove', '-s', 'user', 'leadsync'],
    ['claude', 'mcp', 'add', '-s', 'user', 'leadsync', '--', 'npx', '-y', SERVER_SPEC],
  ])
})

test('codexInstallRemovesThenAdds', () => {
  const { runCli, calls } = fakeCli()
  assert.deepEqual(HOSTS.codex.install({ runCli }), { ok: true })
  assert.deepEqual(calls, [
    ['codex', 'mcp', 'remove', 'leadsync'],
    ['codex', 'mcp', 'add', 'leadsync', '--', 'npx', '-y', SERVER_SPEC],
  ])
})

test('cliMissingReturnsSnippet', () => {
  const claude = HOSTS.claude.install({ runCli: fakeCli(enoent()).runCli })
  assert.equal(claude.cliMissing, true)
  assert.ok(claude.snippet.includes('claude plugin marketplace add lmoulton/leadsync-skills'))
  assert.ok(claude.snippet.includes('claude plugin install leadsync@leadsync-skills'))
  assert.ok(claude.snippet.includes(`claude mcp add -s user leadsync -- npx -y ${SERVER_SPEC}`))
  assert.ok(claude.snippet.includes('/plugin marketplace add lmoulton/leadsync-skills'))
  assert.ok(claude.snippet.includes('/plugin install leadsync@leadsync-skills'))
  const codex = HOSTS.codex.install({ runCli: fakeCli(enoent()).runCli })
  assert.equal(codex.cliMissing, true)
  assert.ok(codex.snippet.includes('[mcp_servers.leadsync]'))
  assert.ok(codex.snippet.includes(`args = ["-y", "${SERVER_SPEC}"]`))
})

test('cliAddFailureIsAnError', () => {
  const { runCli } = fakeCli({ status: 0 }, { status: 1, stdout: '', stderr: 'Invalid scope\nmore detail' })
  assert.deepEqual(HOSTS.claude.install({ runCli }), { ok: false, error: 'claude mcp add failed: Invalid scope' })
})

test('cliUninstallTreatsNotFoundAsDone', () => {
  const { runCli, calls } = fakeCli({ status: 1, stdout: '', stderr: 'No MCP server found with name: "leadsync"' })
  assert.deepEqual(HOSTS.claude.uninstall({ runCli }), { ok: true, unchanged: true })
  assert.deepEqual(calls, [['claude', 'mcp', 'remove', '-s', 'user', 'leadsync']])
  assert.deepEqual(HOSTS.codex.uninstall({ runCli: fakeCli().runCli }), { ok: true })
  assert.equal(HOSTS.codex.uninstall({ runCli: fakeCli(enoent()).runCli }).cliMissing, true)
  assert.deepEqual(HOSTS.codex.uninstall({ runCli: fakeCli({ status: 2, stderr: 'boom' }).runCli }), { ok: false, error: 'codex mcp remove failed: boom' })
})

test('skillsDirsPerHost', () => {
  assert.equal(HOSTS.claude.skillsDir({ home: '/h' }), path.join('/h', '.claude', 'skills'))
  assert.equal(HOSTS.codex.skillsDir({ home: '/h' }), path.join('/h', '.agents', 'skills'))
  assert.equal(HOSTS.claude.skillsDir({ home: '/h', projectDir: '/p' }), path.join('/p', '.claude', 'skills'))
  assert.equal(HOSTS.codex.skillsDir({ home: '/h', projectDir: '/p' }), path.join('/p', '.agents', 'skills'))
  assert.equal(HOSTS.cursor.skillsDir, null)
})

test('cliInvocationAvoidsShellArgsOnWindows', () => {
  const args = ['mcp', 'add', '-s', 'user', 'leadsync', '--', 'npx', '-y', SERVER_SPEC]
  assert.deepEqual(cliInvocation('claude', args, 'linux'), { file: 'claude', args, shell: false })
  assert.deepEqual(cliInvocation('claude', args, 'darwin'), { file: 'claude', args, shell: false })
  assert.deepEqual(cliInvocation('claude', args, 'win32'), { file: `claude ${args.join(' ')}`, args: [], shell: true })
  assert.throws(() => cliInvocation('claude', ['a b'], 'win32'), /plain argument/)
  assert.throws(() => cliInvocation('claude', ['a&b'], 'win32'), /plain argument/)
})
