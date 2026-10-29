'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { runLogin } = require('./login')
const { keyFilePath } = require('./config')
const { main } = require('../install')

const KEY = 'ls_live_supersecretkey1234567890'
const START = {
  device_code: 'dc_123',
  user_code: 'ABCD-EFGH',
  verification_uri: 'https://leadsync.me/account/device',
  verification_uri_complete: 'https://leadsync.me/account/device?user_code=ABCD-EFGH',
  expires_in: 900,
  interval: 5,
}
const SUCCESS = { api_key: KEY, key_name: 'LeadSync CLI on box', account: { id: 42, email: 'owner@example.com' } }

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
const problem = (code, status = 400, detail = `${code} detail`, headers = {}) =>
  new Response(JSON.stringify({ type: 'about:blank', title: 'T', status, code, detail }), {
    status, headers: { 'content-type': 'application/problem+json', ...headers },
  })

/** Scripted deps: fetch answers from the list in order; sleeps, opened links and log lines are recorded. */
function setup(responses, extra = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'leadsync-home-'))
  const calls = []
  const lines = []
  const sleeps = []
  const opened = []
  const deps = {
    fetch: async (url, init) => {
      calls.push({ url, init, body: init && init.body ? JSON.parse(init.body) : undefined })
      const r = responses.shift()
      if (r === undefined) throw new Error('unexpected extra request')
      if (r instanceof Error) throw r
      return r
    },
    openBrowser: (url) => opened.push(url),
    sleep: async (ms) => { sleeps.push(ms) },
    log: (s = '') => lines.push(String(s)),
    hostname: 'box',
    env: {},
    home,
    ...extra,
  }
  return { deps, home, calls, lines, sleeps, opened }
}
const keyFile = (home) => (fs.existsSync(keyFilePath(home)) ? fs.readFileSync(keyFilePath(home), 'utf8') : '')

test('pendingThenSlowDownThenSuccessWritesKey', async () => {
  const s = setup([json(START), problem('authorization_pending'), problem('slow_down'), problem('authorization_pending'), json(SUCCESS)])
  assert.equal(await runLogin([], s.deps), 0)

  assert.equal(s.calls[0].url, 'https://leadsync.me/api/v1/device/code')
  assert.equal(s.calls[0].init.method, 'POST')
  assert.deepEqual(s.calls[0].body, { client_name: 'LeadSync CLI on box' })
  const polls = s.calls.slice(1)
  assert.equal(polls.length, 4)
  for (const p of polls) {
    assert.equal(p.url, 'https://leadsync.me/api/v1/device/token')
    assert.deepEqual(p.body, { device_code: 'dc_123' })
  }
  assert.deepEqual(s.sleeps, [5000, 5000, 10000, 10000])

  const text = keyFile(s.home)
  assert.ok(text.split('\n').includes(`LEADSYNC_API_KEY=${KEY}`))
  assert.doesNotMatch(text, /LEADSYNC_API_BASE/)

  assert.deepEqual(s.opened, [START.verification_uri_complete])
  assert.equal(s.lines[0], '')
  assert.equal(s.lines[1], 'Open this link and approve the device:')
  assert.equal(s.lines[2], START.verification_uri_complete)
  assert.equal(s.lines[3], 'The page shows the code ABCD-EFGH. Check it matches.')
  assert.equal(s.lines.at(-1), `Signed in as owner@example.com. Key saved to ${keyFilePath(s.home)}. Restart Claude Code (or your assistant) to pick it up.`)
  for (const line of s.lines) assert.ok(!line.includes(KEY), `logged the key: ${line}`)
})

test('expiredTokenExits1', async () => {
  const s = setup([json(START), problem('expired_token')])
  assert.equal(await runLogin([], s.deps), 1)
  assert.equal(s.lines.at(-1), 'The login request expired. Run the command again.')
  assert.doesNotMatch(keyFile(s.home), /LEADSYNC_API_KEY=\S/)
})

test('accessDeniedExits1', async () => {
  const s = setup([json(START), problem('authorization_pending'), problem('access_denied', 403)])
  assert.equal(await runLogin([], s.deps), 1)
  assert.equal(s.lines.at(-1), 'The request was denied in the browser.')
})

test('invalidGrantExits1', async () => {
  const s = setup([json(START), problem('invalid_grant')])
  assert.equal(await runLogin([], s.deps), 1)
  assert.equal(s.lines.at(-1), 'This login request was already used. Run the command again.')
})

test('startFailureIsOneLine', async () => {
  const offline = setup([new TypeError('fetch failed')])
  assert.equal(await runLogin([], offline.deps), 1)
  assert.deepEqual(offline.lines, ['Could not reach https://leadsync.me. Check your connection and try again.'])

  const limited = setup([problem('rate_limited', 429, 'Too many login attempts.', { 'Retry-After': '120' })])
  assert.equal(await runLogin([], limited.deps), 1)
  assert.deepEqual(limited.lines, ['Could not start the login: Too many login attempts. Try again in 120 seconds.'])

  const broken = setup([new Response('<html>', { status: 502, statusText: 'Bad Gateway' })])
  assert.equal(await runLogin([], broken.deps), 1)
  assert.deepEqual(broken.lines, ['Could not start the login: HTTP 502.'])

  const garbled = setup([json({ hello: 'world' })])
  assert.equal(await runLogin([], garbled.deps), 1)
  assert.deepEqual(garbled.lines, ['Could not start the login: the response from https://leadsync.me was not a device code.'])
})

test('pollNetworkFailureExits1AfterThreeInARow', async () => {
  const s = setup([json(START), new TypeError('fetch failed'), new TypeError('fetch failed'), new TypeError('fetch failed')])
  assert.equal(await runLogin([], s.deps), 1)
  assert.equal(s.lines.at(-1), 'Could not reach https://leadsync.me. Check your connection and try again.')
  assert.equal(s.calls.length, 4)
})

test('aNetworkBlipWhilePollingIsRetried', async () => {
  const s = setup([json(START), new TypeError('fetch failed'), problem('authorization_pending'), new TypeError('fetch failed'), new TypeError('fetch failed'), json(SUCCESS)])
  assert.equal(await runLogin([], s.deps), 0)
  assert.ok(keyFile(s.home).split('\n').includes(`LEADSYNC_API_KEY=${KEY}`))
})

test('loginHelpPrintsUsageAndExits0', async () => {
  const s = setup([])
  assert.equal(await runLogin(['--help'], s.deps), 0)
  assert.equal(s.lines[0], 'Usage: npx @leadsync/skills login [--api-base <url>]')
  assert.equal(s.calls.length, 0)
})

test('unexpectedPollProblemIsOneLine', async () => {
  const s = setup([json(START), problem('internal', 500, 'Something went wrong.')])
  assert.equal(await runLogin([], s.deps), 1)
  assert.equal(s.lines.at(-1), 'Login failed: Something went wrong.')
})

test('rateLimitedPollBacksOffLikeSlowDown', async () => {
  const s = setup([json(START), problem('rate_limited', 429), json(SUCCESS)])
  assert.equal(await runLogin([], s.deps), 0)
  assert.deepEqual(s.sleeps, [5000, 10000])
})

test('stopsPollingAtExpiresIn', async () => {
  const s = setup([json({ ...START, expires_in: 12 }), problem('authorization_pending'), problem('authorization_pending')])
  assert.equal(await runLogin([], s.deps), 1)
  assert.equal(s.calls.length, 3)
  assert.equal(s.lines.at(-1), 'The login request expired. Run the command again.')
})

test('defaultsTheIntervalTo5', async () => {
  const { interval, ...noInterval } = START
  const s = setup([json(noInterval), json(SUCCESS)])
  assert.equal(await runLogin([], s.deps), 0)
  assert.deepEqual(s.sleeps, [5000])
})

test('clientNameIsTruncatedTo80', async () => {
  const s = setup([json(START), json(SUCCESS)], { hostname: 'h'.repeat(200) })
  assert.equal(await runLogin([], s.deps), 0)
  const name = s.calls[0].body.client_name
  assert.equal(name.length, 80)
  assert.ok(name.startsWith('LeadSync CLI on hhh'))
})

test('apiBaseFlagIsWrittenToKeyFile', async () => {
  const s = setup([json(START), json(SUCCESS)], { apiBase: 'https://env.test' })
  assert.equal(await runLogin(['--api-base', 'https://staging.test/'], s.deps), 0)
  assert.equal(s.calls[0].url, 'https://staging.test/api/v1/device/code')
  assert.equal(s.calls[1].url, 'https://staging.test/api/v1/device/token')
  assert.ok(keyFile(s.home).split('\n').includes('LEADSYNC_API_BASE=https://staging.test'))
})

test('envApiBaseIsUsedButNotWritten', async () => {
  const s = setup([json(START), json(SUCCESS)], { apiBase: 'https://env.test' })
  assert.equal(await runLogin([], s.deps), 0)
  assert.equal(s.calls[0].url, 'https://env.test/api/v1/device/code')
  assert.doesNotMatch(keyFile(s.home), /LEADSYNC_API_BASE/)
})

test('aStaleApiBaseInTheFileIsReplacedSoTheNewKeyWorks', async () => {
  const s = setup([json(START), json(SUCCESS)])
  fs.mkdirSync(path.dirname(keyFilePath(s.home)), { recursive: true })
  fs.writeFileSync(keyFilePath(s.home), 'LEADSYNC_API_KEY=old\nLEADSYNC_API_BASE=https://staging.test\n')
  assert.equal(await runLogin([], s.deps), 0)
  assert.equal(keyFile(s.home), `LEADSYNC_API_KEY=${KEY}\nLEADSYNC_API_BASE=https://leadsync.me\n`)
})

test('rejectsAnApiBaseThatIsNotHttps', async () => {
  const s = setup([])
  assert.equal(await runLogin(['--api-base', 'http://example.test'], s.deps), 1)
  assert.deepEqual(s.lines, ['--api-base must be an https:// URL (http:// is allowed only for localhost).'])
  const local = setup([json(START), json(SUCCESS)])
  assert.equal(await runLogin(['--api-base', 'http://localhost:8030'], local.deps), 0)
})

test('rejectsUnknownLoginOptions', async () => {
  const s = setup([])
  assert.equal(await runLogin(['--bogus'], s.deps), 1)
  assert.equal(s.lines.length, 1)
  assert.match(s.lines[0], /bogus/)
})

test('aKeyThatCannotBeSavedSaysWhereItWent', async () => {
  const s = setup([json(START), json({ ...SUCCESS, api_key: 'bad\nkey' })])
  assert.equal(await runLogin([], s.deps), 1)
  assert.match(s.lines.at(-1), /^Could not save the key to .*\. It was created as "LeadSync CLI on box" on owner@example\.com; revoke it under Account, Settings, API keys and run this again\.$/)
})

test('mainRoutesLoginWithItsDeps', async () => {
  const s = setup([json(START), json(SUCCESS)])
  assert.equal(await main(['login'], s.deps), 0)
  assert.ok(keyFile(s.home).includes(`LEADSYNC_API_KEY=${KEY}`))
})
