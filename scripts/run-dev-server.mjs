/* Bundles the dev bridge server with esbuild and runs it. */
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const out = join(__dirname, '../node_modules/.tmp/dev-server.mjs')

await build({
  entryPoints: [join(__dirname, 'dev-server.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: out,
  logLevel: 'error'
})

spawn(process.execPath, [out], { stdio: 'inherit', env: process.env })
