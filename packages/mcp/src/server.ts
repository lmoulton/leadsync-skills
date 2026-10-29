import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ApiClient } from './client.js'
import { loadConfig, type ConfigIo } from './config.js'
import { registerPrompts } from './prompts.js'
import { registerReadTools } from './tools/read.js'
import { registerWriteTools } from './tools/write.js'
import type { ApiLike } from './tools/shared.js'

export const SERVER_NAME = 'leadsync'
export const SERVER_VERSION = '0.1.1'

/** Stand-in client used when no key is set: every call resolves to a config error. */
export function missingKeyClient(detail: string): ApiLike {
  return {
    request: async <T>() => ({ ok: false as const, status: 0, code: 'config_error', detail }) as import('./client.js').ApiResult<T>,
  }
}

export function createServer(env: NodeJS.ProcessEnv, fetchImpl?: typeof fetch, io?: ConfigIo): McpServer {
  const cfg = loadConfig(env, io)
  const client: ApiLike = 'error' in cfg ? missingKeyClient(cfg.error) : new ApiClient(cfg, fetchImpl)
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION })
  registerReadTools(server, client)
  registerWriteTools(server, client)
  registerPrompts(server)
  return server
}
