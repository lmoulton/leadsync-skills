'use strict'
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { version } = require('../../package.json')

const SERVER_NAME = 'leadsync'
const SERVER_SPEC = `@leadsync/mcp@${version}`
const KEYS_URL = 'https://leadsync.me/account/settings#api-keys'
const KEY_FILE_TEMPLATE = [
  `# LeadSync API key. Create one under Account, Settings, API keys at ${KEYS_URL}`,
  '# or run: npx @leadsync/skills login',
  'LEADSYNC_API_KEY=',
  '',
].join('\n')

function serverCommand() {
  return { command: 'npx', args: ['-y', SERVER_SPEC] }
}

function home() {
  return os.homedir()
}

function keyFilePath(homeDir = home()) {
  return path.join(homeDir, '.leadsync', '.env')
}

/**
 * Write via a temp file and rename, so a crash never leaves a half-written file. A symlinked file is written
 * through to its target, and an existing file keeps its permissions unless a mode is given.
 */
function writeFileAtomic(file, text, mode) {
  let target = file
  let keep
  try {
    target = fs.realpathSync(file)
    keep = fs.statSync(target).mode & 0o777
  } catch (e) {
    if (e.code !== 'ENOENT') throw e
  }
  const finalMode = mode === undefined ? keep : mode
  const tmp = `${target}.${process.pid}.tmp`
  fs.writeFileSync(tmp, text, finalMode === undefined ? undefined : { mode: finalMode })
  if (finalMode !== undefined) fs.chmodSync(tmp, finalMode)
  fs.renameSync(tmp, target)
}

/** Create ~/.leadsync/.env (directory 0700, file 0600) with a commented template, once. */
function ensureKeyFile(homeDir = home()) {
  const file = keyFilePath(homeDir)
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  fs.chmodSync(dir, 0o700)
  try {
    fs.writeFileSync(file, KEY_FILE_TEMPLATE, { flag: 'wx', mode: 0o600 })
    fs.chmodSync(file, 0o600)
    return { file, created: true }
  } catch (e) {
    if (e.code === 'EEXIST') return { file, created: false }
    throw e
  }
}

const nameLine = (name) => new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`)

/** True when the key file has a NAME= line (empty values included). */
function hasKey(name, homeDir = home()) {
  let text
  try {
    text = fs.readFileSync(keyFilePath(homeDir), 'utf8')
  } catch (e) {
    if (e.code === 'ENOENT') return false
    throw e
  }
  const isName = nameLine(name)
  return text.split(/\r?\n/).some((l) => isName.test(l))
}

/**
 * Set NAME=value in the key file: the first existing NAME line is replaced in place, any later NAME lines are
 * dropped (so a re-run never leaves two), every other line is kept, and the value is appended when absent.
 */
function setKey(name, value, homeDir = home()) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error(`${name} is not a valid variable name`)
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`the value for ${name} contains control characters`)
  const { file } = ensureKeyFile(homeDir)
  const text = fs.readFileSync(file, 'utf8')
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  if (lines[lines.length - 1] === '') lines.pop()
  const isName = nameLine(name)
  const out = []
  let placed = false
  for (const line of lines) {
    if (!isName.test(line)) out.push(line)
    else if (!placed) { out.push(`${name}=${value}`); placed = true }
  }
  if (!placed) out.push(`${name}=${value}`)
  writeFileAtomic(file, out.join(eol) + eol, 0o600)
  return file
}

module.exports = { SERVER_NAME, SERVER_SPEC, KEYS_URL, serverCommand, home, keyFilePath, ensureKeyFile, hasKey, setKey, writeFileAtomic }
