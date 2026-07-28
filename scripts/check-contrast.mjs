/*
 * WCAG 2.1 contrast checker for the design tokens.
 *
 * Parses src/renderer/src/styles/tokens.css, and for each theme verifies the
 * text/background and UI-component pairings that must meet AA:
 *   - body text        >= 4.5:1
 *   - large/bold text  >= 3.0:1
 *   - UI boundaries    >= 3.0:1 (borders, focus ring)
 *
 * Run: node scripts/check-contrast.mjs
 * Exits non-zero if any required pair fails, so it can gate CI.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(__dirname, '../src/renderer/src/styles/tokens.css'), 'utf-8')

/** Extract each `:root...{ }` block with its selector. */
function parseThemes(text) {
  const themes = {}
  const re = /:root([^,{]*)(?:,\s*:root[^{]*)?\{([^}]*)\}/g
  let m
  while ((m = re.exec(text))) {
    const selector = m[1].trim()
    const name = /data-theme='([^']+)'/.exec(m[0])?.[1] ?? 'dark'
    const body = m[2]
    const vars = {}
    for (const decl of body.split(';')) {
      const mm = /--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})/.exec(decl)
      if (mm) vars[mm[1]] = mm[2]
    }
    themes[name] = { ...(themes[name] ?? {}), ...vars }
  }
  return themes
}

function hexToRgb(hex) {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const n = parseInt(h.slice(0, 6), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function relLum([r, g, b]) {
  const f = (c) => {
    c /= 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

function ratio(a, b) {
  const l1 = relLum(hexToRgb(a))
  const l2 = relLum(hexToRgb(b))
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]
  return (hi + 0.05) / (lo + 0.05)
}

// (name, fg, bg, minimum) — surfaces text can appear on, and UI boundaries.
const checks = (t) => [
  ['text on bg', t.text, t.bg, 4.5],
  ['text on surface', t.text, t.surface, 4.5],
  ['text on surface-2', t.text, t['surface-2'], 4.5],
  ['secondary on bg', t['text-secondary'], t.bg, 4.5],
  ['secondary on surface', t['text-secondary'], t.surface, 4.5],
  ['muted on bg', t['text-muted'], t.bg, 4.5],
  ['muted on surface', t['text-muted'], t.surface, 4.5],
  ['on-accent text on accent', t['text-on-accent'], t.accent, 4.5],
  ['accent-text on bg (link)', t['accent-text'], t.bg, 4.5],
  ['accent-text on surface', t['accent-text'], t.surface, 4.5],
  ['success on surface (large)', t.success, t.surface, 3.0],
  ['danger on surface (large)', t.danger, t.surface, 3.0],
  // Functional component boundaries (input/button outlines) must be >=3:1.
  // `--border` is decorative-only (dividers) and WCAG-exempt, so not required.
  ['border-strong on surface (UI)', t['border-strong'], t.surface, 3.0],
  ['border-strong on bg (UI)', t['border-strong'], t.bg, 3.0],
  ['focus ring on bg (UI)', t['focus-ring'], t.bg, 3.0],
  ['focus ring on surface (UI)', t['focus-ring'], t.surface, 3.0]
]

const themes = parseThemes(css)
let failures = 0
for (const [name, vars] of Object.entries(themes)) {
  console.log(`\n== theme: ${name} ==`)
  for (const [label, fg, bg, min] of checks(vars)) {
    if (!fg || !bg) {
      console.log(`  ?  ${label}: missing token`)
      continue
    }
    const r = ratio(fg, bg)
    const pass = r >= min
    if (!pass) failures++
    console.log(
      `  ${pass ? 'PASS' : 'FAIL'}  ${label.padEnd(30)} ${r.toFixed(2)}:1 (min ${min})`
    )
  }
}

console.log(`\n${failures === 0 ? 'All contrast checks passed.' : `${failures} FAILURES`}`)
process.exit(failures === 0 ? 0 : 1)
