import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type Config = { apiKey: string; apiBase: string; account?: string }

/** Where loadConfig looks for key files. readFile returns null when the file does not exist and throws otherwise. */
export type ConfigIo = { home: () => string; readFile: (p: string) => string | null }

export const defaultIo: ConfigIo = {
  home: homedir,
  readFile: (p) => {
    try {
      return readFileSync(p, 'utf8')
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR') return null
      throw e
    }
  },
}

const VARS = ['LEADSYNC_API_KEY', 'LEADSYNC_API_BASE', 'LEADSYNC_ACCOUNT'] as const

/** Key files in precedence order: the customer file `login` writes, then the internal one (read only). */
export function keyFiles(home: string): string[] {
  return [join(home, '.leadsync', '.env'), join(home, '.config', 'leadsync', 'api.env')]
}

/**
 * Parse `KEY=value` lines. Blank lines, `#` comments and an `export ` prefix are allowed; values may be
 * single or double quoted. Throws on any other line, naming only its number so a pasted key is never echoed.
 */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  text.replace(/^﻿/, '').split(/\r\n|\n|\r/).forEach((raw, i) => {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) return
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!m) throw new Error(`line ${i + 1} is not KEY=value`)
    let value = m[2]
    const q = value[0]
    if ((q === '"' || q === "'") && value.length >= 2 && value.endsWith(q)) value = value.slice(1, -1)
    else value = value.replace(/\s+#.*$/, '')
    out[m[1]] = value.trim()
  })
  return out
}

export function loadConfig(env: NodeJS.ProcessEnv, io: ConfigIo = defaultIo): Config | { error: string } {
  const found: Partial<Record<(typeof VARS)[number], string>> = {}
  for (const v of VARS) {
    const val = env[v]?.trim()
    // A host that leaves the plugin's optional key prompt unexpanded ("${user_config.api_key}")
    // must not hide the key file behind a value that can never authenticate.
    if (val && !/^\$\{[^}]*\}$/.test(val)) found[v] = val
  }
  for (const file of keyFiles(io.home())) {
    if (VARS.every((v) => found[v])) break
    let parsed: Record<string, string>
    try {
      const text = io.readFile(file)
      if (text === null) continue
      parsed = parseEnvFile(text)
    } catch (e) {
      const reason = e instanceof Error ? e.message.split(',')[0] : String(e)
      return { error: `${file} could not be read: ${reason}` }
    }
    for (const v of VARS) if (!found[v] && parsed[v]) found[v] = parsed[v]
  }

  const apiKey = found.LEADSYNC_API_KEY
  if (!apiKey) return { error: 'LEADSYNC_API_KEY is not set. Run: npx @leadsync/skills login' }
  const apiBase = (found.LEADSYNC_API_BASE || 'https://leadsync.me').replace(/\/+$/, '')
  const account = found.LEADSYNC_ACCOUNT
  return account ? { apiKey, apiBase, account } : { apiKey, apiBase }
}

/** Safe-to-print form of the key: first 12 characters only. */
export function keyHint(apiKey: string): string {
  return apiKey.slice(0, 12)
}
