/* Bundles api-smoke.ts with esbuild and runs it (token via TOGGL_TOKEN env). */
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const out = join(__dirname, '../node_modules/.tmp/api-smoke.mjs')

await build({
  entryPoints: [join(__dirname, 'api-smoke.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: out,
  logLevel: 'error'
})

execFileSync(process.execPath, [out], { stdio: 'inherit', env: process.env })
