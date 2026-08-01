/* Bundles each TS test with esbuild (resolving electron-free modules) and runs it. */
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { dirname, join, basename } from 'node:path'
import { execFileSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))

const TESTS = ['timer-test.ts', 'calendar-test.ts', 'enrich-test.ts']

let failed = false
for (const test of TESTS) {
  const out = join(__dirname, `../node_modules/.tmp/${basename(test, '.ts')}.mjs`)
  await build({
    entryPoints: [join(__dirname, test)],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: out,
    logLevel: 'error'
  })
  console.log(`\n# ${test}`)
  try {
    execFileSync(process.execPath, [out], { stdio: 'inherit' })
  } catch {
    failed = true
  }
}

if (failed) process.exit(1)
