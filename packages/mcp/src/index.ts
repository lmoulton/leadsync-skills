#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createServer } from './server.js'

const server = createServer(process.env)
await server.connect(new StdioServerTransport())
console.error('leadsync-mcp: ready')
