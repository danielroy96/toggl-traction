/*
 * Generates the app icons with no external deps — a rounded magenta tile with a
 * white timer ring + hand, matching the app accent.
 *
 * Emits two artifacts:
 *   build/icon.png  — 512×512, used by electron-builder for mac/linux (and as
 *                     the source it derives other sizes from).
 *   build/icon.ico  — a genuine multi-resolution Windows icon (16…256px), each
 *                     size *rendered natively* rather than downscaled from 512.
 *
 * Rendering each size natively is the whole point: the ring and hand are thin
 * strokes, so a single 512px bitmap scaled down to a 16–32px taskbar slot
 * aliases into a blurry smudge. Drawing at the target size keeps every size
 * crisp, which is what makes the taskbar/title-bar icon look sharp.
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** Render the icon into an RGBA buffer at the given square size. */
function render(S) {
  const buf = Buffer.alloc(S * S * 4)
  const k = S / 512 // scale every dimension relative to the 512px reference art

  const px = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= S || y >= S) return
    const i = (y * S + x) * 4
    // alpha-over composite onto existing pixel
    const da = buf[i + 3] / 255
    const sa = a / 255
    const oa = sa + da * (1 - sa)
    if (oa === 0) return
    for (let c = 0; c < 3; c++) {
      const sc = [r, g, b][c]
      buf[i + c] = Math.round((sc * sa + buf[i + c] * da * (1 - sa)) / oa)
    }
    buf[i + 3] = Math.round(oa * 255)
  }
  const dist = (x, y, cx, cy) => Math.hypot(x - cx, y - cy)

  // Rounded-rect background (accent magenta #c853b4).
  const radius = 96 * k
  const inset = 24 * k
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const nx = Math.min(Math.max(x, inset + radius), S - inset - radius)
      const ny = Math.min(Math.max(y, inset + radius), S - inset - radius)
      const inCorner =
        x < inset + radius || x > S - inset - radius || y < inset + radius || y > S - inset - radius
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
  const cy = S / 2 + 8 * k
  const ringOuter = 150 * k
  const ringInner = 120 * k
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const d = dist(x, y, cx, cy)
      if (d <= ringOuter && d >= ringInner) {
        const aa = Math.min(1, ringOuter - d + 1, d - ringInner + 1)
        px(x, y, 255, 255, 255, Math.round(255 * Math.max(0, aa)))
      }
    }
  }
  // Hand: from centre up and slightly right, thickness scaled to size.
  const hw = Math.max(1, Math.round(9 * k))
  for (let t = 0; t <= 200; t++) {
    const f = t / 200
    const hx = cx + f * 70 * k * Math.sin(0.9)
    const hy = cy - f * 100 * k * Math.cos(0.4)
    for (let dx = -hw; dx <= hw; dx++)
      for (let dy = -hw; dy <= hw; dy++)
        if (dx * dx + dy * dy <= hw * hw) px(Math.round(hx + dx), Math.round(hy + dy), 255, 255, 255)
  }
  // Centre hub.
  const hub = 26 * k
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) if (dist(x, y, cx, cy) <= hub) px(x, y, 255, 255, 255)

  return buf
}

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
function encodePng(buf, S) {
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
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// ---- ICO packing (each entry is a PNG, supported on Windows Vista+) ----
function encodeIco(sizes) {
  const images = sizes.map((S) => encodePng(render(S), S))
  const count = images.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(count, 4)
  const dir = Buffer.alloc(16 * count)
  let offset = 6 + 16 * count
  images.forEach((img, idx) => {
    const S = sizes[idx]
    const e = idx * 16
    dir[e] = S >= 256 ? 0 : S // width (0 means 256)
    dir[e + 1] = S >= 256 ? 0 : S // height
    dir[e + 2] = 0 // colour count
    dir[e + 3] = 0 // reserved
    dir.writeUInt16LE(1, e + 4) // colour planes
    dir.writeUInt16LE(32, e + 6) // bits per pixel
    dir.writeUInt32LE(img.length, e + 8)
    dir.writeUInt32LE(offset, e + 12)
    offset += img.length
  })
  return Buffer.concat([header, dir, ...images])
}

mkdirSync(join(__dirname, '../build'), { recursive: true })

const png = encodePng(render(512), 512)
writeFileSync(join(__dirname, '../build/icon.png'), png)
console.log(`Wrote build/icon.png (${png.length} bytes)`)

const ico = encodeIco([16, 24, 32, 48, 64, 128, 256])
writeFileSync(join(__dirname, '../build/icon.ico'), ico)
console.log(`Wrote build/icon.ico (${ico.length} bytes, 7 sizes)`)
