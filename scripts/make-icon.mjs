/*
 * Generates build/icon.png (512×512) with no external deps — a rounded magenta
 * tile with a white timer ring + hand, matching the app accent. electron-builder
 * derives the mac/win/linux icons from this PNG.
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const S = 512
const buf = Buffer.alloc(S * S * 4)

const px = (x, y, r, g, b, a = 255) => {
  const i = (y * S + x) * 4
  // alpha-over composite onto existing pixel
  const da = buf[i + 3] / 255
  const sa = a / 255
  const oa = sa + da * (1 - sa)
  if (oa === 0) return
  for (let k = 0; k < 3; k++) {
    const sc = [r, g, b][k]
    buf[i + k] = Math.round((sc * sa + buf[i + k] * da * (1 - sa)) / oa)
  }
  buf[i + 3] = Math.round(oa * 255)
}

const dist = (x, y, cx, cy) => Math.hypot(x - cx, y - cy)

// Rounded-rect background (accent magenta #e08bd6-ish, a touch deeper for icon).
const radius = 96
const inset = 24
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const nx = Math.min(Math.max(x, inset + radius), S - inset - radius)
    const ny = Math.min(Math.max(y, inset + radius), S - inset - radius)
    const inCorner = x < inset + radius || x > S - inset - radius || y < inset + radius || y > S - inset - radius
    const d = inCorner ? dist(x, y, nx, ny) : 0
    const inside = x >= inset && x <= S - inset && y >= inset && y <= S - inset && d <= radius
    if (inside) {
      const edge = Math.min(1, radius - d + 1)
      px(x, y, 0xc8, 0x53, 0xb4, Math.round(255 * (inCorner ? Math.max(0, Math.min(1, edge)) : 1)))
    }
  }
}

// White timer ring + hand.
const cx = S / 2
const cy = S / 2 + 8
const ringOuter = 150
const ringInner = 120
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const d = dist(x, y, cx, cy)
    if (d <= ringOuter && d >= ringInner) {
      const aa = Math.min(1, ringOuter - d + 1, d - ringInner + 1)
      px(x, y, 255, 255, 255, Math.round(255 * Math.max(0, aa)))
    }
  }
}
// Hand: from centre up and slightly right.
for (let t = 0; t <= 100; t++) {
  const f = t / 100
  const hx = cx + f * 70 * Math.sin(0.9)
  const hy = cy - f * 100 * Math.cos(0.4)
  for (let dx = -9; dx <= 9; dx++)
    for (let dy = -9; dy <= 9; dy++)
      if (dx * dx + dy * dy <= 81) px(Math.round(hx + dx), Math.round(hy + dy), 255, 255, 255)
}
// Centre hub.
for (let y = 0; y < S; y++)
  for (let x = 0; x < S; x++)
    if (dist(x, y, cx, cy) <= 26) px(x, y, 255, 255, 255)

// ---- PNG encoding ----
function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const t = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])))
  return Buffer.concat([len, t, data, crc])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(S, 0)
ihdr.writeUInt32BE(S, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // RGBA
// scanlines with filter byte 0
const raw = Buffer.alloc(S * (S * 4 + 1))
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0
  buf.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4)
}
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
])

mkdirSync(join(__dirname, '../build'), { recursive: true })
writeFileSync(join(__dirname, '../build/icon.png'), png)
console.log(`Wrote build/icon.png (${png.length} bytes)`)
