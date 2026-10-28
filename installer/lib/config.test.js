'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { SERVER_NAME, SERVER_SPEC, serverCommand, keyFilePath, ensureKeyFile, setKey } = require('./config')
const { version } = require('../../package.json')

const tempHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'leadsync-home-'))
const mode = (p) => fs.statSync(p).mode & 0o777
const posix = process.platform !== 'win32'

test('serverCommandRunsThePinnedPackage', () => {
  assert.equal(SERVER_NAME, 'leadsync')
  assert.equal(SERVER_SPEC, `@leadsync/mcp@${version}`)
  assert.deepEqual(serverCommand(), { command: 'npx', args: ['-y', `@leadsync/mcp@${version}`] })
})

test('keyFilePathIsUnderHome', () => {
  assert.equal(keyFilePath('/h'), path.join('/h', '.leadsync', '.env'))
})

test('ensureKeyFileCreatesOnceWith0600', () => {
  const home = tempHome()
  const first = ensureKeyFile(home)
  assert.deepEqual(first, { file: keyFilePath(home), created: true })
  const text = fs.readFileSync(first.file, 'utf8')
  assert.match(text, /^# LeadSync API key\. Create one under Account, Settings, API keys at https:\/\/leadsync\.me\/account\/settings#api-keys\n/)
  assert.match(text, /\n# or run: npx @leadsync\/skills login\n/)
  assert.match(text, /\nLEADSYNC_API_KEY=\n$/)
  if (posix) {
    assert.equal(mode(first.file), 0o600)
    assert.equal(mode(path.dirname(first.file)), 0o700)
  }
  fs.appendFileSync(first.file, 'MINE=1\n')
  const second = ensureKeyFile(home)
  assert.deepEqual(second, { file: first.file, created: false })
  assert.equal(fs.readFileSync(first.file, 'utf8'), text + 'MINE=1\n')
})

test('setKeyReplacesInPlaceAndPreservesOtherLines', () => {
  const home = tempHome()
  const { file } = ensureKeyFile(home)
  fs.writeFileSync(file, '# mine\nLEADSYNC_API_BASE=https://x.test\nLEADSYNC_API_KEY=old\nOTHER=1\n')
  assert.equal(setKey('LEADSYNC_API_KEY', 'ls_live_new', home), file)
  assert.equal(fs.readFileSync(file, 'utf8'), '# mine\nLEADSYNC_API_BASE=https://x.test\nLEADSYNC_API_KEY=ls_live_new\nOTHER=1\n')
  if (posix) assert.equal(mode(file), 0o600)
})

test('setKeyRerunLeavesOneLine', () => {
  const home = tempHome()
  const { file } = ensureKeyFile(home)
  fs.writeFileSync(file, 'LEADSYNC_API_KEY=a\nX=1\nexport LEADSYNC_API_KEY=b\n')
  setKey('LEADSYNC_API_KEY', 'first', home)
  setKey('LEADSYNC_API_KEY', 'second', home)
  assert.equal(fs.readFileSync(file, 'utf8'), 'LEADSYNC_API_KEY=second\nX=1\n')
})

test('setKeyKeepsCrlfLineEndings', () => {
  const home = tempHome()
  const { file } = ensureKeyFile(home)
  fs.writeFileSync(file, '# c\r\nLEADSYNC_API_KEY=old\r\n')
  setKey('LEADSYNC_API_KEY', 'new', home)
  assert.equal(fs.readFileSync(file, 'utf8'), '# c\r\nLEADSYNC_API_KEY=new\r\n')
})

test('setKeyAppendsWhenAbsent', () => {
  const home = tempHome()
  const { file } = ensureKeyFile(home)
  fs.writeFileSync(file, 'A=1')
  setKey('LEADSYNC_API_BASE', 'https://staging.test', home)
  assert.equal(fs.readFileSync(file, 'utf8'), 'A=1\nLEADSYNC_API_BASE=https://staging.test\n')
})

test('setKeyCreatesTheFileFromTheTemplate', () => {
  const home = tempHome()
  const file = setKey('LEADSYNC_API_KEY', 'ls_live_k', home)
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  assert.equal(lines.filter((l) => l.startsWith('LEADSYNC_API_KEY=')).length, 1)
  assert.ok(lines.includes('LEADSYNC_API_KEY=ls_live_k'))
  assert.ok(lines[0].startsWith('# LeadSync API key.'))
  if (posix) assert.equal(mode(file), 0o600)
})

test('setKeyRejectsControlChars', () => {
  const home = tempHome()
  const { file } = ensureKeyFile(home)
  const before = fs.readFileSync(file, 'utf8')
  assert.throws(() => setKey('LEADSYNC_API_KEY', 'abc\nEVIL=1', home), /control characters/)
  assert.throws(() => setKey('LEADSYNC_API_KEY', 'abc\u0000', home), /control characters/)
  assert.throws(() => setKey('LEADSYNC_API_KEY', 'abc\r', home), /control characters/)
  assert.throws(() => setKey('leadsync_api_key', 'abc', home), /not a valid variable name/)
  assert.throws(() => setKey('A=B', 'abc', home), /not a valid variable name/)
  assert.equal(fs.readFileSync(file, 'utf8'), before)
})
