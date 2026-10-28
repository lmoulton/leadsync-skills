import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createServer } from '../src/server.js'
import type { ConfigIo } from '../src/config.js'

export type Call = { url: string; init: RequestInit }

export function fake(res: Response) {
  const calls: Call[] = []
  const f = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return res.clone() }) as unknown as typeof fetch
  return { f, calls }
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

/** No key files: keeps the suite from reading the real home directory. */
export const noFiles = { home: () => '/nonexistent-home', readFile: () => null }

export async function connect(env: NodeJS.ProcessEnv, f?: typeof fetch, io: ConfigIo = noFiles) {
  const server = createServer(env, f, io)
  const [a, b] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 't', version: '0' })
  await Promise.all([server.connect(a), client.connect(b)])
  return client
}

export const text = (r: any) => r.content[0].text as string
