import { homedir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createCadScriptServer } from './mcp';

// Designs are written and read in `--dir`, or where the server was started.
const args = process.argv.slice(2);
const at = args.indexOf('--dir');
// An MCP config passes `~` through as written, without a shell to expand it.
const given = (at >= 0 ? args[at + 1]! : '.').replace(/^~(?=$|\/)/, homedir());
const dir = path.resolve(process.env.INIT_CWD ?? process.cwd(), given);
// The solver logs as it works; stdout carries the protocol and nothing else.
console.log = console.error.bind(console);
await createCadScriptServer(dir).connect(new StdioServerTransport());
console.error(`camNC design scripts in ${dir}`);
