#!/usr/bin/env node
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const util = require('node:util')
const { HOSTS, defaultRunCli } = require('./lib/hosts')
const { SERVER_NAME, SERVER_SPEC, ensureKeyFile, keyFilePath, home: defaultHome } = require('./lib/config')
const { placeSkills, removeSkills } = require('./lib/skills')
const { runLogin } = require('./lib/login')

const HOST_ORDER = ['claude', 'codex', 'cursor']

const USAGE = `Usage: npx @leadsync/skills [options]
       npx @leadsync/skills login [--api-base <url>]

Installs the LeadSync MCP server (${SERVER_SPEC}) and skills into your AI assistant.

Options:
  --claude              Claude Code: register the server and copy the skills to ~/.claude/skills
  --cursor              Cursor: add the server to ~/.cursor/mcp.json
  --codex               Codex: register the server and copy the skills to ~/.agents/skills
  --all                 every assistant above whose settings folder exists
  --project-dir <dir>   use <dir>/.cursor/mcp.json, <dir>/.claude/skills and <dir>/.agents/skills instead
  --force               replace a different leadsync entry in Cursor's mcp.json
  --uninstall           remove the server and the skills (the key file is left in place)
  -h, --help            show this help

Commands:
  login                 sign in to LeadSync in your browser and save an API key to ~/.leadsync/.env`

const OPTIONS = {
  claude: { type: 'boolean' },
  cursor: { type: 'boolean' },
  codex: { type: 'boolean' },
  all: { type: 'boolean' },
  uninstall: { type: 'boolean' },
  force: { type: 'boolean' },
  'project-dir': { type: 'string' },
  help: { type: 'boolean', short: 'h' },
}

function parseArgs(argv) {
  if (argv[0] === 'login') return { command: 'login', argv: argv.slice(1) }
  let values
  try {
    ;({ values } = util.parseArgs({ args: argv, options: OPTIONS, strict: true, allowPositionals: false }))
  } catch (e) {
    return { error: e.message }
  }
  if (values.help) return { command: 'help' }
  const hosts = HOST_ORDER.filter((h) => values[h])
  if (!hosts.length && !values.all) return { error: 'Choose at least one of --claude, --cursor, --codex or --all.' }
  const dir = values['project-dir']
  return {
    command: 'install',
    hosts,
    all: Boolean(values.all),
    uninstall: Boolean(values.uninstall),
    force: Boolean(values.force),
    projectDir: dir === undefined ? undefined : path.resolve(dir),
  }
}

const indent = (text) => text.split('\n').map((l) => `  ${l}`).join('\n')

/** Install into (or uninstall from) one host and print its line. Returns 'ok', 'missing' or 'failed'. */
function runHost(name, args, ctx, log) {
  const host = HOSTS[name]
  const skillsDir = host.skillsDir && host.skillsDir(ctx)
  let r
  try {
    r = args.uninstall ? host.uninstall(ctx) : host.install(ctx)
  } catch (e) {
    r = { ok: false, error: e.message }
  }

  if (args.uninstall) {
    let removed = 0
    try {
      if (skillsDir) removed = removeSkills(skillsDir)
    } catch (e) {
      log(`${host.label}: failed: could not remove the skills from ${skillsDir}: ${e.message}`)
      return 'failed'
    }
    const skills = skillsDir ? `; ${removed} skills removed from ${skillsDir}` : ''
    if (r.cliMissing) {
      log(`${host.label}: the ${name} command was not found${skills}. To remove the server by hand, run:`)
      log(indent(r.snippet))
      return 'missing'
    }
    if (!r.ok) {
      log(`${host.label}: failed: ${r.error}`)
      return 'failed'
    }
    const where = r.file ? ` from ${r.file}` : ''
    log(`${host.label}: ${r.unchanged ? `${SERVER_NAME} was not registered${where}` : `removed ${SERVER_NAME}${where}`}${skills}`)
    return 'ok'
  }

  if (r.cliMissing) {
    log(`${host.label}: the ${name} command was not found, so nothing was changed. To add LeadSync by hand:`)
    log(indent(r.snippet))
    return 'missing'
  }
  if (!r.ok) {
    log(`${host.label}: failed: ${r.error}`)
    return 'failed'
  }
  if (r.file) log(`${host.label}: ${r.unchanged ? `${SERVER_NAME} is already set up in` : `added ${SERVER_NAME} to`} ${r.file}`)
  else log(`${host.label}: registered ${SERVER_NAME} (npx -y ${SERVER_SPEC})`)
  if (!skillsDir) {
    log(`  skills are not copied for ${host.label}; the prompt connect_form_to_destination is available from the server`)
    return 'ok'
  }
  try {
    log(`  ${placeSkills(skillsDir)} skills copied to ${skillsDir}`)
  } catch (e) {
    log(`${host.label}: failed: could not copy the skills to ${skillsDir}: ${e.message}`)
    return 'failed'
  }
  return 'ok'
}

async function main(argv, deps = {}) {
  const log = deps.log || ((s = '') => console.log(s))
  const homeDir = deps.home || defaultHome()
  const args = parseArgs(argv)
  if (args.error) {
    log(args.error)
    log()
    log(USAGE)
    return 1
  }
  if (args.command === 'help') {
    log(USAGE)
    return 0
  }
  if (args.command === 'login') return runLogin(args.argv, { ...deps, home: homeDir, log })

  let hosts = args.hosts
  if (args.all) {
    const found = HOST_ORDER.filter((h) => fs.existsSync(HOSTS[h].configDir(homeDir)))
    hosts = HOST_ORDER.filter((h) => hosts.includes(h) || found.includes(h))
    if (!hosts.length) {
      log('No supported assistant found (looked for ~/.claude, ~/.codex and ~/.cursor). Use --claude, --cursor or --codex.')
      return 1
    }
  }

  const ctx = { home: homeDir, projectDir: args.projectDir, force: args.force, runCli: deps.runCli || defaultRunCli }
  const results = hosts.map((name) => runHost(name, args, ctx, log))
  const failed = results.includes('failed')

  if (args.uninstall) {
    const file = keyFilePath(homeDir)
    if (fs.existsSync(file)) log(`Your key file ${file} was left in place; delete it if you no longer need it.`)
    if (failed) log('Finished with errors; see the lines above.')
    return failed ? 1 : 0
  }

  try {
    const key = ensureKeyFile(homeDir)
    if (key.created) log(`Created ${key.file} for your API key.`)
  } catch (e) {
    log(`Could not create ${keyFilePath(homeDir)}: ${e.message}`)
    return 1
  }
  if (failed) {
    log('Finished with errors; see the lines above.')
    return 1
  }
  if (results.every((r) => r === 'missing')) {
    log('Nothing was installed automatically. Follow the steps above, then run: npx @leadsync/skills login')
    return 0
  }
  log('Installed. Next: npx @leadsync/skills login (or paste a key into ~/.leadsync/.env)')
  return 0
}

module.exports = { parseArgs, main, USAGE }

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code },
    (e) => { console.error(e && e.message ? e.message : e); process.exitCode = 1 },
  )
}
