'use strict'
const os = require('node:os')
const util = require('node:util')
const { spawn } = require('node:child_process')
const { hasKey, keyFilePath, setKey, home: defaultHome } = require('./config')

const DEFAULT_BASE = 'https://leadsync.me'
const REQUEST_TIMEOUT_MS = 30_000
const EXPIRED = 'The login request expired. Run the command again.'

/** Open a link in the default browser; any failure is ignored because the link is already printed. */
function defaultOpenBrowser(url) {
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [url]]
      : process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
        : ['xdg-open', [url]]
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true })
    child.on('error', () => {})
    child.unref()
  } catch {
    // no browser available
  }
}

function withDefaults(deps) {
  const d = {
    fetch: globalThis.fetch,
    openBrowser: defaultOpenBrowser,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log: (s = '') => console.log(s),
    hostname: os.hostname(),
    apiBase: undefined,
    env: process.env,
    home: defaultHome(),
  }
  for (const [k, v] of Object.entries(deps)) if (v !== undefined) d[k] = v
  return d
}

/** https only, except http to this machine for local development. Returns the base without a trailing slash. */
function resolveBase(raw) {
  let u
  try {
    u = new URL(String(raw).trim())
  } catch {
    return null
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
  if (!(u.protocol === 'https:' || (u.protocol === 'http:' && local))) return null
  return `${u.origin}${u.pathname}`.replace(/\/+$/, '')
}

const positive = (n) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : undefined)

async function post(d, url, body) {
  let res
  try {
    res = await d.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch {
    return { network: true }
  }
  const text = await res.text().catch(() => '')
  let data
  try {
    data = text ? JSON.parse(text) : undefined
  } catch {
    data = undefined
  }
  const ra = res.headers.get('Retry-After')
  return {
    ok: res.ok,
    status: res.status,
    data: data && typeof data === 'object' && !Array.isArray(data) ? data : {},
    retryAfter: ra && /^\d+$/.test(ra) ? Number(ra) : undefined,
  }
}

/** RFC 7807 detail (or the HTTP status) as one sentence, with the Retry-After hint when there is one. */
function describe(r) {
  const detail = typeof r.data.detail === 'string' && r.data.detail.trim() ? r.data.detail.trim() : `HTTP ${r.status}`
  return `${detail.replace(/\.+$/, '')}.${r.retryAfter ? ` Try again in ${r.retryAfter} seconds.` : ''}`
}

function save(d, data, base, explicitBase) {
  const email = data.account && typeof data.account.email === 'string' ? data.account.email : 'your account'
  if (typeof data.api_key !== 'string' || data.api_key === '') {
    d.log('Login failed: the response did not include a key.')
    return 1
  }
  let file
  try {
    file = setKey('LEADSYNC_API_KEY', data.api_key, d.home)
    // A base left over from an earlier login elsewhere would point the new key at the wrong server.
    if (explicitBase || hasKey('LEADSYNC_API_BASE', d.home)) setKey('LEADSYNC_API_BASE', base, d.home)
  } catch (e) {
    const name = typeof data.key_name === 'string' ? data.key_name : 'LeadSync CLI'
    d.log(`Could not save the key to ${keyFilePath(d.home)}: ${e.message}. It was created as "${name}" on ${email}; revoke it under Account, Settings, API keys and run this again.`)
    return 1
  }
  d.log(`Signed in as ${email}. Key saved to ${file}. Restart Claude Code (or your assistant) to pick it up.`)
  return 0
}

/**
 * Sign in with the LeadSync device flow (RFC 8628): get a code, show the link, poll until the browser approves,
 * then save the key to ~/.leadsync/.env. Never prints the key. Returns the exit code.
 */
async function runLogin(argv, deps = {}) {
  const d = withDefaults(deps)
  let values
  try {
    ;({ values } = util.parseArgs({ args: argv, options: { 'api-base': { type: 'string' } }, strict: true, allowPositionals: false }))
  } catch (e) {
    d.log(e.message)
    return 1
  }
  const explicit = values['api-base']
  const base = resolveBase(explicit ?? d.apiBase ?? d.env.LEADSYNC_API_BASE ?? DEFAULT_BASE)
  if (!base) {
    d.log(`${explicit !== undefined ? '--api-base' : 'LEADSYNC_API_BASE'} must be an https:// URL (http:// is allowed only for localhost).`)
    return 1
  }
  const unreachable = `Could not reach ${base}. Check your connection and try again.`

  const clientName = Array.from(`LeadSync CLI on ${d.hostname}`).slice(0, 80).join('')
  const start = await post(d, `${base}/api/v1/device/code`, { client_name: clientName })
  if (start.network) {
    d.log(unreachable)
    return 1
  }
  if (!start.ok) {
    d.log(`Could not start the login: ${describe(start)}`)
    return 1
  }
  const code = start.data
  const link = code.verification_uri_complete || code.verification_uri
  if (typeof code.device_code !== 'string' || typeof code.user_code !== 'string' || typeof link !== 'string') {
    d.log(`Could not start the login: the response from ${base} was not a device code.`)
    return 1
  }
  let interval = positive(code.interval) ?? 5
  const expiresIn = positive(code.expires_in) ?? 900

  d.log()
  d.log('Open this link and approve the device:')
  d.log(link)
  d.log(`The page shows the code ${code.user_code}. Check it matches.`)
  try {
    d.openBrowser(link)
  } catch {
    // the link is printed above
  }
  d.log(`Waiting for approval (the link expires in ${Math.round(expiresIn / 60)} minutes).`)

  let elapsed = 0
  while (elapsed + interval <= expiresIn) {
    await d.sleep(interval * 1000)
    elapsed += interval
    const r = await post(d, `${base}/api/v1/device/token`, { device_code: code.device_code })
    if (r.network) {
      d.log(unreachable)
      return 1
    }
    if (r.ok) return save(d, r.data, base, explicit !== undefined)
    switch (r.data.code) {
      case 'authorization_pending':
        continue
      case 'slow_down':
      case 'rate_limited':
        interval = Math.max(interval + 5, r.retryAfter ?? 0)
        continue
      case 'expired_token':
        d.log(EXPIRED)
        return 1
      case 'access_denied':
        d.log('The request was denied in the browser.')
        return 1
      case 'invalid_grant':
        d.log('This login request was already used. Run the command again.')
        return 1
      default:
        d.log(`Login failed: ${describe(r)}`)
        return 1
    }
  }
  d.log(EXPIRED)
  return 1
}

module.exports = { runLogin, resolveBase }
