import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultIo, loadConfig, parseEnvFile } from '../src/config.js'
import { SERVER_VERSION } from '../src/server.js'

const HOME = join('/', 'home', 't')
const NEW_FILE = join(HOME, '.leadsync', '.env')
const LEGACY_FILE = join(HOME, '.config', 'leadsync', 'api.env')
const files = (map: Record<string, string>) => ({ home: () => HOME, readFile: (p: string) => map[p] ?? null })
const none = files({})

describe('parseEnvFile', () => {
  it('reads KEY=value lines', () => {
    expect(parseEnvFile('LEADSYNC_API_KEY=ls_live_abc\nLEADSYNC_ACCOUNT=7\n')).toEqual({ LEADSYNC_API_KEY: 'ls_live_abc', LEADSYNC_ACCOUNT: '7' })
  })
  it('strips double and single quotes', () => {
    expect(parseEnvFile(`A="quoted"\nB='single'`)).toEqual({ A: 'quoted', B: 'single' })
  })
  it('handles CRLF line endings', () => {
    expect(parseEnvFile('A=1\r\nB=2\r\n')).toEqual({ A: '1', B: '2' })
  })
  it('skips blank and comment lines', () => {
    expect(parseEnvFile('# LeadSync API key\n\n   \n  # indented comment\nA=1\n')).toEqual({ A: '1' })
  })
  it('accepts an export prefix', () => {
    expect(parseEnvFile('export LEADSYNC_API_KEY=k1')).toEqual({ LEADSYNC_API_KEY: 'k1' })
  })
  it('trims trailing spaces, inside and outside quotes', () => {
    expect(parseEnvFile('A=ls_live_abc   \r\nB="ls_live_def"  \r\nC = spaced\n')).toEqual({ A: 'ls_live_abc', B: 'ls_live_def', C: 'spaced' })
  })
  it('drops an inline comment after an unquoted value', () => {
    expect(parseEnvFile('A=ls_live_abc # my key\nB="x # kept"')).toEqual({ A: 'ls_live_abc', B: 'x # kept' })
  })
  it('keeps an empty value as empty', () => {
    expect(parseEnvFile('LEADSYNC_API_KEY=\n')).toEqual({ LEADSYNC_API_KEY: '' })
  })
  it('rejects a line that is not KEY=value without echoing it', () => {
    expect(() => parseEnvFile('A=1\nls_live_secretvalue\n')).toThrow(/^line 2 is not KEY=value$/)
  })
})

describe('loadConfig', () => {
  it('reports a missing key with the login command', () => {
    expect(loadConfig({}, none)).toEqual({ error: 'LEADSYNC_API_KEY is not set. Run: npx @leadsync/skills login' })
  })
  it('applies defaults and reads overrides', () => {
    expect(loadConfig({ LEADSYNC_API_KEY: 'k' }, none)).toEqual({ apiKey: 'k', apiBase: 'https://leadsync.me' })
    expect(loadConfig({ LEADSYNC_API_KEY: 'k', LEADSYNC_API_BASE: 'https://s.test/', LEADSYNC_ACCOUNT: '7' }, none))
      .toEqual({ apiKey: 'k', apiBase: 'https://s.test', account: '7' })
  })
  it('envWinsOverFile', () => {
    const io = files({ [NEW_FILE]: 'LEADSYNC_API_KEY=from_file\nLEADSYNC_API_BASE=https://file.test\n' })
    expect(loadConfig({ LEADSYNC_API_KEY: 'from_env', LEADSYNC_API_BASE: 'https://env.test' }, io))
      .toEqual({ apiKey: 'from_env', apiBase: 'https://env.test' })
  })
  it('newFileWinsOverLegacyFile', () => {
    const io = files({ [NEW_FILE]: 'LEADSYNC_API_KEY=new_key\n', [LEGACY_FILE]: 'LEADSYNC_API_KEY=legacy_key\nLEADSYNC_ACCOUNT=9\n' })
    expect(loadConfig({}, io)).toEqual({ apiKey: 'new_key', apiBase: 'https://leadsync.me', account: '9' })
  })
  it('reads the legacy file when the new one is absent', () => {
    expect(loadConfig({}, files({ [LEGACY_FILE]: 'LEADSYNC_API_KEY=legacy_key\n' })))
      .toEqual({ apiKey: 'legacy_key', apiBase: 'https://leadsync.me' })
  })
  it('fills LEADSYNC_API_BASE from the file when the env lacks it', () => {
    const io = files({ [NEW_FILE]: 'LEADSYNC_API_KEY=file_key\nLEADSYNC_API_BASE=https://staging.test/\n' })
    expect(loadConfig({ LEADSYNC_API_KEY: 'env_key' }, io)).toEqual({ apiKey: 'env_key', apiBase: 'https://staging.test' })
  })
  it('treats an empty key in the new file as unset and falls through to the legacy file', () => {
    const io = files({ [NEW_FILE]: '# LeadSync API key\nLEADSYNC_API_KEY=\n', [LEGACY_FILE]: 'LEADSYNC_API_KEY=legacy_key\n' })
    expect(loadConfig({}, io)).toEqual({ apiKey: 'legacy_key', apiBase: 'https://leadsync.me' })
  })
  it('treats an empty env value as unset', () => {
    expect(loadConfig({ LEADSYNC_API_KEY: '  ' }, files({ [NEW_FILE]: 'LEADSYNC_API_KEY=file_key' })))
      .toEqual({ apiKey: 'file_key', apiBase: 'https://leadsync.me' })
  })
  it('ignores an unexpanded ${...} placeholder in the env and reads the key file', () => {
    expect(loadConfig({ LEADSYNC_API_KEY: '${user_config.api_key}' }, files({ [NEW_FILE]: 'LEADSYNC_API_KEY=file_key' })))
      .toEqual({ apiKey: 'file_key', apiBase: 'https://leadsync.me' })
  })
  it('lets an expanded key from the plugin prompt win over the key file', () => {
    expect(loadConfig({ LEADSYNC_API_KEY: 'ls_live_prompted' }, files({ [NEW_FILE]: 'LEADSYNC_API_KEY=file_key' })))
      .toMatchObject({ apiKey: 'ls_live_prompted' })
  })
  it('returns the bare key from a CRLF, quoted, padded file', () => {
    expect(loadConfig({}, files({ [NEW_FILE]: 'LEADSYNC_API_KEY="ls_live_abc" \r\n' }))).toMatchObject({ apiKey: 'ls_live_abc' })
  })
  it('malformedKeyFileIsConfigError', () => {
    const io = {
      home: () => HOME,
      readFile: (p: string) => {
        if (p === NEW_FILE) throw Object.assign(new Error(`EACCES: permission denied, open '${p}'`), { code: 'EACCES' })
        return null
      },
    }
    expect(loadConfig({}, io)).toEqual({ error: `${NEW_FILE} could not be read: EACCES: permission denied` })
  })
  it('reports a file that cannot be parsed, naming the path and the line only', () => {
    const r = loadConfig({}, files({ [NEW_FILE]: 'ls_live_pasted_without_a_name\n' }))
    expect(r).toEqual({ error: `${NEW_FILE} could not be read: line 1 is not KEY=value` })
  })
})

describe('defaultIo', () => {
  it('returns null for a missing file, the text for a present one, and throws for a directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'leadsync-io-'))
    writeFileSync(join(dir, 'a.env'), 'A=1\n')
    mkdirSync(join(dir, 'sub'))
    expect(defaultIo.readFile(join(dir, 'missing.env'))).toBeNull()
    expect(defaultIo.readFile(join(dir, 'nodir', 'x.env'))).toBeNull()
    expect(defaultIo.readFile(join(dir, 'a.env'))).toBe('A=1\n')
    expect(() => defaultIo.readFile(join(dir, 'sub'))).toThrow()
  })
})

describe('package', () => {
  it('versionMatchesPackage', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    expect(SERVER_VERSION).toBe(pkg.version)
  })
})
