/* Bundles the TS test with esbuild (resolving electron-free modules) and runs it. */
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const out = join(__dirname, '../node_modules/.tmp/timer-test.mjs')

await build({
  entryPoints: [join(__dirname, 'timer-test.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: out,
  logLevel: 'error'
})

execFileSync(process.execPath, [out], { stdio: 'inherit' })
