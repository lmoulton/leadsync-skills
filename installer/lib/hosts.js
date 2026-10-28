'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { isDeepStrictEqual } = require('node:util')
const { SERVER_NAME, SERVER_SPEC, serverCommand, writeFileAtomic } = require('./config')

/**
 * How to start a host CLI. macOS and Linux: directly, no shell. Windows: the CLIs are usually .cmd shims, which
 * Node only starts through cmd.exe, so the call becomes one command line (an args array with a shell is
 * deprecated, DEP0190). Every argument here is a fixed token, and anything else is refused.
 */
function cliInvocation(cmd, args, platform = process.platform) {
  if (platform !== 'win32') return { file: cmd, args, shell: false }
  for (const a of [cmd, ...args]) {
    if (!/^[A-Za-z0-9@._/:=-]+$/.test(a)) throw new Error(`not a plain argument: ${a}`)
  }
  return { file: [cmd, ...args].join(' '), args: [], shell: true }
}

/** Run a host CLI; cmd's "not recognised" exit (9009) is reported as ENOENT, like a missing binary elsewhere. */
function defaultRunCli(cmd, args) {
  const inv = cliInvocation(cmd, args)
  const r = spawnSync(inv.file, inv.args, { encoding: 'utf8', shell: inv.shell, windowsHide: true })
  if (inv.shell && r.status === 9009) return { ...r, error: Object.assign(new Error(`${cmd} not found`), { code: 'ENOENT' }) }
  return r
}

const firstLine = (r) => (`${r.stderr || ''}\n${r.stdout || ''}`.split(/\r?\n/).find((l) => l.trim()) || `exit code ${r.status}`).trim()
const notRegistered = (r) => /not found|no .*found|does not exist|no such/i.test(`${r.stderr || ''} ${r.stdout || ''}`)
const missing = (r) => r.error && r.error.code === 'ENOENT'

const MANUAL = `npx -y ${SERVER_SPEC}`

function cliHost({ label, cli, configDir, skillsDir, addArgs, removeArgs, snippet }) {
  const run = (runCli, args) => runCli(cli, args)
  return {
    label,
    configDir,
    skillsDir,
    install({ runCli = defaultRunCli } = {}) {
      const rm = run(runCli, removeArgs)
      if (missing(rm)) return { cliMissing: true, snippet }
      const add = run(runCli, addArgs)
      if (missing(add)) return { cliMissing: true, snippet }
      if (add.error || add.status !== 0) return { ok: false, error: `${cli} mcp add failed: ${add.error ? add.error.message : firstLine(add)}` }
      return { ok: true }
    },
    uninstall({ runCli = defaultRunCli } = {}) {
      const rm = run(runCli, removeArgs)
      if (missing(rm)) return { cliMissing: true, snippet: `${cli} mcp remove ${removeArgs.slice(2).join(' ')}` }
      if (!rm.error && rm.status === 0) return { ok: true }
      if (!rm.error && notRegistered(rm)) return { ok: true, unchanged: true }
      return { ok: false, error: `${cli} mcp remove failed: ${rm.error ? rm.error.message : firstLine(rm)}` }
    },
  }
}

const claude = cliHost({
  label: 'Claude Code',
  cli: 'claude',
  configDir: (home) => path.join(home, '.claude'),
  skillsDir: ({ home, projectDir }) => path.join(projectDir || home, '.claude', 'skills'),
  removeArgs: ['mcp', 'remove', '-s', 'user', SERVER_NAME],
  addArgs: ['mcp', 'add', '-s', 'user', SERVER_NAME, '--', ...MANUAL.split(' ')],
  snippet: [
    'Install the LeadSync plugin (server plus skills) from a terminal:',
    '  claude plugin marketplace add lmoulton/leadsync-skills',
    '  claude plugin install leadsync@leadsync-skills',
    'or type these in Claude Code itself:',
    '  /plugin marketplace add lmoulton/leadsync-skills',
    '  /plugin install leadsync@leadsync-skills',
    'or add only the server:',
    `  claude mcp add -s user ${SERVER_NAME} -- ${MANUAL}`,
  ].join('\n'),
})

const codex = cliHost({
  label: 'Codex',
  cli: 'codex',
  configDir: (home) => path.join(home, '.codex'),
  skillsDir: ({ home, projectDir }) => path.join(projectDir || home, '.agents', 'skills'),
  removeArgs: ['mcp', 'remove', SERVER_NAME],
  addArgs: ['mcp', 'add', SERVER_NAME, '--', ...MANUAL.split(' ')],
  snippet: [
    'Add this to ~/.codex/config.toml:',
    `  [mcp_servers.${SERVER_NAME}]`,
    '  command = "npx"',
    `  args = ["-y", "${SERVER_SPEC}"]`,
  ].join('\n'),
})

const cursorFile = ({ home, projectDir }) => path.join(projectDir || home, '.cursor', 'mcp.json')

/** An entry this installer (or the /mcp page snippet without env) wrote: any version, nothing else set. */
const isOurs = (entry) =>
  isDeepStrictEqual(Object.keys(entry || {}).sort(), ['args', 'command']) &&
  entry.command === 'npx' &&
  Array.isArray(entry.args) &&
  entry.args.length === 2 &&
  entry.args[0] === '-y' &&
  /^@leadsync\/mcp(@[0-9A-Za-z.^~*-]+)?$/.test(String(entry.args[1]))

/** Read a Cursor mcp.json: {} when absent, an error when it is not a JSON object with an object mcpServers. */
function readCursor(file) {
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (e) {
    if (e.code === 'ENOENT') return { data: {}, exists: false }
    return { error: `${file} could not be read: ${e.message}` }
  }
  let data
  try {
    data = text.trim() === '' ? {} : JSON.parse(text)
  } catch {
    return { error: `${file} is not valid JSON; fix it or move it aside, then run this again` }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { error: `${file} is not a JSON object` }
  const servers = data.mcpServers
  if (servers !== undefined && (!servers || typeof servers !== 'object' || Array.isArray(servers))) {
    return { error: `${file} has an mcpServers value that is not an object` }
  }
  return { data, exists: true }
}

const writeCursor = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  writeFileAtomic(file, JSON.stringify(data, null, 2) + '\n')
}

const cursor = {
  label: 'Cursor',
  configDir: (home) => path.join(home, '.cursor'),
  skillsDir: null,
  install({ home, projectDir, force = false }) {
    const file = cursorFile({ home, projectDir })
    const r = readCursor(file)
    if (r.error) return { ok: false, error: r.error }
    const servers = r.data.mcpServers || {}
    const want = serverCommand()
    if (SERVER_NAME in servers) {
      if (isDeepStrictEqual(servers[SERVER_NAME], want)) return { ok: true, file, unchanged: true }
      if (!force && !isOurs(servers[SERVER_NAME])) return { ok: false, error: `a different ${SERVER_NAME} entry exists; re-run with --force` }
    }
    writeCursor(file, { ...r.data, mcpServers: { ...servers, [SERVER_NAME]: want } })
    return { ok: true, file }
  },
  uninstall({ home, projectDir }) {
    const file = cursorFile({ home, projectDir })
    const r = readCursor(file)
    if (r.error) return { ok: false, error: r.error }
    const servers = r.data.mcpServers
    if (!servers || !(SERVER_NAME in servers)) return { ok: true, file, unchanged: true }
    const { [SERVER_NAME]: _removed, ...rest } = servers
    writeCursor(file, { ...r.data, mcpServers: rest })
    return { ok: true, file }
  },
}

const HOSTS = { claude, codex, cursor }

module.exports = { HOSTS, cliInvocation, defaultRunCli }
