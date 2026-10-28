'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { parseArgs, main } = require('../install')
const { SERVER_SPEC } = require('./config')

const tempHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'leadsync-home-'))
const noCli = () => { throw new Error('runCli must not be called') }
const enoent = () => ({ error: Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }), status: null, stdout: '', stderr: '' })

function run(argv, { home = tempHome(), runCli = noCli } = {}) {
  const lines = []
  return main(argv, { home, runCli, log: (s = '') => lines.push(String(s)) }).then((code) => ({ code, out: lines.join('\n'), home }))
}

test('parseArgsHandlesProjectDirAndAll', () => {
  assert.deepEqual(parseArgs(['--all', '--project-dir', 'rel/dir', '--force']), {
    command: 'install', hosts: [], all: true, uninstall: false, force: true, projectDir: path.resolve('rel/dir'),
  })
  assert.deepEqual(parseArgs(['--cursor', '--codex', '--claude']).hosts, ['claude', 'codex', 'cursor'])
  assert.equal(parseArgs(['--uninstall', '--cursor']).uninstall, true)
  assert.equal(parseArgs(['--cursor']).projectDir, undefined)
  assert.equal(parseArgs(['--help']).command, 'help')
  assert.equal(parseArgs(['-h']).command, 'help')
  assert.deepEqual(parseArgs(['login', '--api-base', 'https://s.test']), { command: 'login', argv: ['--api-base', 'https://s.test'] })
})

test('parseArgsReportsMistakes', () => {
  assert.match(parseArgs([]).error, /Choose at least one of --claude, --cursor, --codex or --all/)
  assert.ok(parseArgs(['--bogus']).error)
  assert.ok(parseArgs(['--project-dir']).error)
  assert.match(parseArgs(['cursor']).error, /cursor/)
})

test('helpPrintsUsageAndExits0', async () => {
  const { code, out } = await run(['--help'])
  assert.equal(code, 0)
  assert.match(out, /Usage: npx @leadsync\/skills/)
  assert.match(out, /login/)
})

test('aMistakePrintsTheErrorAndUsageAndExits1', async () => {
  const { code, out } = await run([])
  assert.equal(code, 1)
  assert.match(out, /Choose at least one/)
  assert.match(out, /Usage:/)
})

test('cursorInstallWritesTheConfigAndTheKeyFile', async () => {
  const { code, out, home } = await run(['--cursor'])
  assert.equal(code, 0)
  const data = JSON.parse(fs.readFileSync(path.join(home, '.cursor', 'mcp.json'), 'utf8'))
  assert.deepEqual(data.mcpServers.leadsync, { command: 'npx', args: ['-y', SERVER_SPEC] })
  assert.ok(fs.existsSync(path.join(home, '.leadsync', '.env')))
  assert.match(out, /skills are not copied for Cursor; the prompt connect_form_to_destination is available from the server/)
  assert.match(out, /Installed\. Next: npx @leadsync\/skills login \(or paste a key into ~\/\.leadsync\/\.env\)$/)
})

test('allPicksHostsWhoseConfigDirExists', async () => {
  const home = tempHome()
  fs.mkdirSync(path.join(home, '.codex'))
  fs.mkdirSync(path.join(home, '.cursor'))
  const calls = []
  const runCli = (cmd, args) => { calls.push(cmd); return { status: 0, stdout: '', stderr: '' } }
  const { code } = await run(['--all'], { home, runCli })
  assert.equal(code, 0)
  assert.deepEqual([...new Set(calls)], ['codex'])
  assert.ok(fs.existsSync(path.join(home, '.agents', 'skills', 'leadsync-setup', 'SKILL.md')))
  assert.ok(fs.existsSync(path.join(home, '.cursor', 'mcp.json')))
  assert.equal(fs.existsSync(path.join(home, '.claude')), false)
})

test('allWithNoAssistantFoundExits1', async () => {
  const { code, out } = await run(['--all'])
  assert.equal(code, 1)
  assert.match(out, /No supported assistant found/)
})

test('claudeInstallCopiesSkills', async () => {
  const { code, out, home } = await run(['--claude'], { runCli: () => ({ status: 0, stdout: '', stderr: '' }) })
  assert.equal(code, 0)
  assert.ok(fs.existsSync(path.join(home, '.claude', 'skills', 'connecting-lead-forms', 'SKILL.md')))
  assert.match(out, /Claude Code: registered leadsync/)
})

test('projectDirPutsSkillsInTheProject', async () => {
  const project = tempHome()
  const { code, home } = await run(['--claude', '--project-dir', project], { runCli: () => ({ status: 0, stdout: '', stderr: '' }) })
  assert.equal(code, 0)
  assert.ok(fs.existsSync(path.join(project, '.claude', 'skills', 'leadsync-setup', 'SKILL.md')))
  assert.equal(fs.existsSync(path.join(home, '.claude', 'skills')), false)
})

test('missingCliPrintsTheSnippetAndExits0', async () => {
  const { code, out, home } = await run(['--claude', '--cursor'], { runCli: enoent })
  assert.equal(code, 0)
  assert.match(out, /claude plugin marketplace add lmoulton\/leadsync-skills/)
  assert.equal(fs.existsSync(path.join(home, '.claude', 'skills')), false)
  assert.ok(fs.existsSync(path.join(home, '.cursor', 'mcp.json')))
})

test('aFailedHostExits1AndOthersStillRun', async () => {
  const runCli = (cmd, args) => (args[1] === 'add' ? { status: 1, stdout: '', stderr: 'nope' } : { status: 0, stdout: '', stderr: '' })
  const { code, out, home } = await run(['--claude', '--cursor'], { runCli })
  assert.equal(code, 1)
  assert.match(out, /Claude Code: failed: claude mcp add failed: nope/)
  assert.ok(fs.existsSync(path.join(home, '.cursor', 'mcp.json')))
  assert.doesNotMatch(out, /Installed\. Next/)
})

test('uninstallRemovesEntriesAndSkillsButKeepsTheKeyFile', async () => {
  const home = tempHome()
  const ok = () => ({ status: 0, stdout: '', stderr: '' })
  await run(['--claude', '--cursor'], { home, runCli: ok })
  const { code, out } = await run(['--uninstall', '--claude', '--cursor'], { home, runCli: ok })
  assert.equal(code, 0)
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, '.cursor', 'mcp.json'), 'utf8')).mcpServers.leadsync, undefined)
  assert.deepEqual(fs.readdirSync(path.join(home, '.claude', 'skills')), [])
  assert.ok(fs.existsSync(path.join(home, '.leadsync', '.env')))
  assert.match(out, /left in place/)
})
