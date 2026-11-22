// The picture that tastes of one ingredient — make.fun bounty entry.
// One hero ingredient: RAMEN. A glossy, steaming bowl of tonkotsu-style ramen
// with a soft jammy egg, chashu, narutomaki and green onions, drawn entirely
// procedurally: every pixel is computed in this file. No assets, no network,
// no dependencies beyond the Node standard library.
//
// Output: /output/entry.png (1024x1024 PNG, deterministic).
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const W = 1024;
const H = 1024;

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) — same seed, same picture, every run.
// ---------------------------------------------------------------------------
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261123);

// ---------------------------------------------------------------------------
// Pixel buffer + drawing primitives (premultiplied-ish straight alpha blend)
// ---------------------------------------------------------------------------
type RGB = [number, number, number];

const buf = new Uint8Array(W * H * 4);

function setPx(x: number, y: number, c: RGB, a = 1) {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= W || yi >= H) return;
  const i = (yi * W + xi) * 4;
  if (a >= 1) {
    buf[i] = c[0];
    buf[i + 1] = c[1];
    buf[i + 2] = c[2];
    buf[i + 3] = 255;
  } else {
    buf[i] = Math.round(buf[i] * (1 - a) + c[0] * a);
    buf[i + 1] = Math.round(buf[i + 1] * (1 - a) + c[1] * a);
    buf[i + 2] = Math.round(buf[i + 2] * (1 - a) + c[2] * a);
    buf[i + 3] = 255;
  }
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function mix(c1: RGB, c2: RGB, t: number): RGB {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

function fillCircle(cx: number, cy: number, r: number, c: RGB, a = 1) {
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(W - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(H - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= r) {
        // soft 1px edge
        const edge = d > r - 1 ? (r - d) : 1;
        setPx(x, y, c, a * edge);
      }
    }
  }
}

function fillEllipse(cx: number, cy: number, rx: number, ry: number, c: RGB, a = 1) {
  const x0 = Math.max(0, Math.floor(cx - rx));
  const x1 = Math.min(W - 1, Math.ceil(cx + rx));
  const y0 = Math.max(0, Math.floor(cy - ry));
  const y1 = Math.min(H - 1, Math.ceil(cy + ry));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) setPx(x, y, c, a);
    }
  }
}

// Thick line as a chain of small circles (round caps, smooth joins).
function thickLine(
  x0: number, y0: number, x1: number, y1: number,
  w: number, c: RGB, a = 1,
) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(len / Math.max(1, w / 3)));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    fillCircle(lerp(x0, x1, t), lerp(y0, y1, t), w / 2, c, a);
  }
}

// A wavy strand: polyline through sine offsets, drawn thick.
function wavyLine(
  x0: number, y0: number, x1: number, y1: number,
  amp: number, freq: number, phase: number,
  w: number, c: RGB, a = 1,
) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(8, Math.ceil(len / 4));
  const dx = (x1 - x0) / len;
  const dy = (y1 - y0) / len;
  const px = -dy;
  const py = dx;
  let prevX = x0;
  let prevY = y0;
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const off = Math.sin(t * freq * Math.PI * 2 + phase) * amp;
    const x = lerp(x0, x1, t) + px * off;
    const y = lerp(y0, y1, t) + py * off;
    thickLine(prevX, prevY, x, y, w, c, a);
    prevX = x;
    prevY = y;
  }
}

// Ring (outline of a circle) with thickness.
function ring(cx: number, cy: number, r: number, w: number, c: RGB, a = 1) {
  const x0 = Math.max(0, Math.floor(cx - r - w));
  const x1 = Math.min(W - 1, Math.ceil(cx + r + w));
  const y0 = Math.max(0, Math.floor(cy - r - w));
  const y1 = Math.min(H - 1, Math.ceil(cy + r + w));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (Math.abs(d - r) <= w / 2) setPx(x, y, c, a);
    }
  }
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
const CX = 512;
const BOWL_Y = 590;
const BOWL_R = 330;
const BROTH_R = 268;

function inBroth(x: number, y: number, margin = 0) {
  return Math.hypot(x - CX, y - BOWL_Y) <= BROTH_R - margin;
}

// 1. Background: warm dark gradient + vignette.
for (let y = 0; y < H; y++) {
  const t = y / H;
  const c = mix([38, 20, 11], [16, 9, 5], t);
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    buf[i] = c[0];
    buf[i + 1] = c[1];
    buf[i + 2] = c[2];
    buf[i + 3] = 255;
  }
}
// soft warm glow behind the bowl
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const d = Math.hypot(x - CX, y - 480) / 560;
    if (d < 1) {
      const g = (1 - d) * (1 - d) * 0.55;
      const i = (y * W + x) * 4;
      buf[i] = Math.min(255, buf[i] + 96 * g);
      buf[i + 1] = Math.min(255, buf[i + 1] + 52 * g);
      buf[i + 2] = Math.min(255, buf[i + 2] + 18 * g);
    }
  }
}

// 2. Wooden table (bottom ~46%) with planks and grain.
const TABLE_Y = 560;
for (let y = TABLE_Y; y < H; y++) {
  const t = (y - TABLE_Y) / (H - TABLE_Y);
  const base = mix([122, 78, 38], [74, 44, 20], t);
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    buf[i] = base[0];
    buf[i + 1] = base[1];
    buf[i + 2] = base[2];
  }
}
// plank seams + grain lines
for (let p = 0; p < 4; p++) {
  const y = TABLE_Y + 46 + p * 118;
  thickLine(0, y, W, y + (p % 2 === 0 ? 4 : -3), 3, [52, 30, 13], 0.85);
}
for (let g = 0; g < 90; g++) {
  const y = TABLE_Y + 10 + rand() * (H - TABLE_Y - 20);
  const x0 = rand() * W;
  const len = 120 + rand() * 420;
  const dark: RGB = rand() > 0.5 ? [96, 58, 26] : [146, 96, 48];
  wavyLine(x0, y, x0 + len, y + (rand() - 0.5) * 14, 2.5, 1.5 + rand() * 2, rand() * 6, 1.6, dark, 0.5);
}

// 3. Soft shadow under the bowl.
fillEllipse(CX, 968, 360, 42, [0, 0, 0], 0.5);
fillEllipse(CX, 962, 320, 32, [0, 0, 0], 0.45);

// 4. Bowl: deep red lacquered ceramic, darker at the base.
for (let y = BOWL_Y - BOWL_R; y <= BOWL_Y + BOWL_R; y++) {
  for (let x = CX - BOWL_R; x <= CX + BOWL_R; x++) {
    const d = Math.hypot(x - CX, y - BOWL_Y);
    if (d <= BOWL_R) {
      const t = (y - (BOWL_Y - BOWL_R)) / (2 * BOWL_R);
      const c = mix([168, 46, 34], [74, 16, 12], t);
      setPx(x, y, c);
    }
  }
}
// bowl foot ring
fillEllipse(CX, BOWL_Y + BOWL_R - 26, 150, 30, [58, 12, 9], 0.9);
// rim: thick glossy band
ring(CX, BOWL_Y, BOWL_R - 12, 26, [196, 62, 44], 1);
ring(CX, BOWL_Y, BOWL_R - 24, 5, [232, 110, 78], 0.9);
// rim specular highlight (top-left arc)
for (let a = Math.PI * 1.05; a <= Math.PI * 1.75; a += 0.004) {
  const x = CX + Math.cos(a) * (BOWL_R - 12);
  const y = BOWL_Y + Math.sin(a) * (BOWL_R - 12);
  fillCircle(x, y, 5, [255, 170, 130], 0.55);
}
// inner wall shadow (broth sits in a slight well)
ring(CX, BOWL_Y, BROTH_R + 8, 10, [60, 18, 8], 0.55);

// 5. Broth: rich golden-orange, lighter in the centre, darker at the edge.
for (let y = BOWL_Y - BROTH_R; y <= BOWL_Y + BROTH_R; y++) {
  for (let x = CX - BROTH_R; x <= CX + BROTH_R; x++) {
    const d = Math.hypot(x - CX, y - BOWL_Y);
    if (d <= BROTH_R) {
      const t = d / BROTH_R;
      const c = mix([243, 178, 84], [196, 116, 30], t * t);
      setPx(x, y, c);
    }
  }
}
// broth swirl sheen
for (let s = 0; s < 7; s++) {
  const a0 = rand() * Math.PI * 2;
  const r0 = 60 + rand() * 170;
  const a1 = a0 + 1.1 + rand() * 1.2;
  let px = CX + Math.cos(a0) * r0;
  let py = BOWL_Y + Math.sin(a0) * r0;
  for (let k = 1; k <= 40; k++) {
    const t = k / 40;
    const a = lerp(a0, a1, t);
    const r = r0 + Math.sin(t * 5) * 8;
    const x = CX + Math.cos(a) * r;
    const y = BOWL_Y + Math.sin(a) * r;
    if (inBroth(x, y, 6)) thickLine(px, py, x, y, 7, [252, 205, 120], 0.28);
    px = x;
    py = y;
  }
}
// chilli-oil droplets glistening on the broth
for (let s = 0; s < 26; s++) {
  const a = rand() * Math.PI * 2;
  const r = 30 + rand() * (BROTH_R - 60);
  const x = CX + Math.cos(a) * r;
  const y = BOWL_Y + Math.sin(a) * r * 0.95;
  if (inBroth(x, y, 14)) {
    fillCircle(x, y, 5 + rand() * 9, [198, 58, 14], 0.75);
    fillCircle(x - 2, y - 2, 2.5, [255, 140, 70], 0.8);
  }
}

// 6. Noodles: a dense tangle of wavy golden strands across the broth.
const NOODLE_LIGHT: RGB = [250, 222, 138];
const NOODLE_MID: RGB = [238, 196, 96];
const NOODLE_DARK: RGB = [214, 164, 62];
for (let n = 0; n < 64; n++) {
  const yBase = BOWL_Y - 210 + rand() * 400;
  const half = Math.sqrt(Math.max(0, (BROTH_R - 18) ** 2 - (yBase - BOWL_Y) ** 2));
  if (half < 30) continue;
  const x0 = CX - half + rand() * 30;
  const x1 = CX + half - rand() * 30;
  const shade = rand();
  const c = shade > 0.66 ? NOODLE_LIGHT : shade > 0.33 ? NOODLE_MID : NOODLE_DARK;
  wavyLine(
    x0, yBase, x1, yBase + (rand() - 0.5) * 26,
    7 + rand() * 9, 2 + rand() * 3.5, rand() * 6.28,
    7 + rand() * 3, c, 0.95,
  );
}
// noodle gloss highlights (a few bright strands on top)
for (let n = 0; n < 16; n++) {
  const yBase = BOWL_Y - 180 + rand() * 330;
  const half = Math.sqrt(Math.max(0, (BROTH_R - 30) ** 2 - (yBase - BOWL_Y) ** 2));
  if (half < 40) continue;
  wavyLine(
    CX - half + 20, yBase, CX + half - 20, yBase + (rand() - 0.5) * 18,
    6 + rand() * 6, 3 + rand() * 2, rand() * 6.28,
    2.5, [255, 240, 190], 0.85,
  );
}

// 7. Toppings — arranged so the egg is the star, lower-left of centre.
// --- Chashu (two overlapping pork slices, upper right) ---
function chashu(cx: number, cy: number, r: number, rot: number) {
  fillCircle(cx, cy, r, [232, 158, 138], 1);
  fillCircle(cx, cy, r * 0.82, [214, 128, 106], 1);
  // fatty marbling
  for (let k = 0; k < 5; k++) {
    const a = rot + (k / 5) * Math.PI * 2;
    const mx = cx + Math.cos(a) * r * 0.45;
    const my = cy + Math.sin(a) * r * 0.45;
    fillEllipse(mx, my, r * 0.3, r * 0.14, [248, 214, 196], 0.9);
  }
  fillCircle(cx, cy, r * 0.34, [198, 110, 90], 1);
  // gloss
  fillEllipse(cx - r * 0.3, cy - r * 0.35, r * 0.3, r * 0.16, [255, 220, 205], 0.5);
}
chashu(668, 500, 66, 0.4);
chashu(716, 566, 58, 1.8);

// --- Narutomaki (fish cake with pink spiral, right edge) ---
fillCircle(742, 664, 40, [250, 244, 232], 1);
ring(742, 664, 40, 3, [226, 200, 180], 0.9);
for (let k = 0; k < 26; k++) {
  const t = k / 26;
  const a = t * Math.PI * 5.2;
  const r = 4 + t * 30;
  fillCircle(742 + Math.cos(a) * r, 664 + Math.sin(a) * r, 4.5, [232, 110, 140], 0.95);
}
fillCircle(742, 664, 5, [232, 110, 140], 0.95);

// --- Soft egg, two halves, lower-left — the hero. Jammy orange yolks. ---
function eggHalf(cx: number, cy: number, rx: number, ry: number, rot: number) {
  // white
  fillEllipse(cx, cy, rx, ry, [250, 244, 230], 1);
  fillEllipse(cx, cy, rx * 0.86, ry * 0.86, [243, 234, 214], 1);
  // yolk: deep orange, glossy, slightly domed
  fillEllipse(cx, cy, rx * 0.52, ry * 0.52, [244, 140, 16], 1);
  fillEllipse(cx, cy, rx * 0.4, ry * 0.4, [252, 168, 40], 1);
  fillEllipse(cx - rx * 0.16, cy - ry * 0.18, rx * 0.2, ry * 0.12, [255, 214, 120], 0.85);
  // yolk edge shadow for depth
  ring(cx, cy, rx * 0.52, 3, [214, 110, 8], 0.5);
  void rot;
}
eggHalf(392, 668, 74, 62, 0);
eggHalf(392, 668, 74, 62, 0); // second pass deepens the white
// re-draw yolk on top after the second white pass
fillEllipse(392, 668, 38, 32, [244, 140, 16], 1);
fillEllipse(392, 668, 29, 24, [252, 168, 40], 1);
fillEllipse(380, 657, 15, 8, [255, 214, 120], 0.85);
eggHalf(300, 560, 58, 50, 0);
fillEllipse(300, 560, 30, 26, [244, 140, 16], 1);
fillEllipse(300, 560, 23, 19, [252, 168, 40], 1);
fillEllipse(291, 551, 12, 6, [255, 214, 120], 0.85);

// --- Green onions: bright rings scattered over noodles ---
for (let n = 0; n < 42; n++) {
  const a = rand() * Math.PI * 2;
  const r = rand() * (BROTH_R - 46);
  const x = CX + Math.cos(a) * r;
  const y = BOWL_Y + Math.sin(a) * r * 0.92;
  if (!inBroth(x, y, 26)) continue;
  // keep onions off the egg faces
  if (Math.hypot(x - 392, y - 668) < 84 || Math.hypot(x - 300, y - 560) < 66) continue;
  const s = 6 + rand() * 5;
  fillEllipse(x, y, s, s * 0.8, [58, 148, 58], 0.95);
  fillEllipse(x, y, s * 0.55, s * 0.45, [140, 210, 90], 0.95);
  fillEllipse(x, y, s * 0.22, s * 0.18, [30, 96, 36], 0.9);
}

// --- Sesame seeds ---
for (let n = 0; n < 60; n++) {
  const a = rand() * Math.PI * 2;
  const r = rand() * (BROTH_R - 30);
  const x = CX + Math.cos(a) * r;
  const y = BOWL_Y + Math.sin(a) * r * 0.92;
  if (!inBroth(x, y, 20)) continue;
  if (Math.hypot(x - 392, y - 668) < 84 || Math.hypot(x - 300, y - 560) < 66) continue;
  fillEllipse(x, y, 4.5, 2.4, [252, 238, 210], 0.95);
}

// 8. Steam: soft, wide, gently drifting columns above the bowl.
for (let s = 0; s < 7; s++) {
  const xBase = CX - 150 + s * 50 + (rand() - 0.5) * 14;
  let px = xBase;
  let py = BOWL_Y - BROTH_R + 30;
  for (let k = 1; k <= 26; k++) {
    const t = k / 26;
    const y = (BOWL_Y - BROTH_R + 30) - t * 260;
    const x = xBase + Math.sin(t * 3.2 + s * 1.9) * (8 + t * 16);
    thickLine(px, py, x, y, 34 - t * 14, [255, 246, 232], 0.07);
    px = x;
    py = y;
  }
}

// 9. Chopsticks resting on the rim, top right.
thickLine(560, 262, 900, 330, 13, [96, 52, 22], 1);
thickLine(556, 282, 896, 350, 13, [116, 66, 28], 1);
thickLine(560, 262, 900, 330, 4, [150, 96, 48], 0.7);
thickLine(556, 282, 896, 350, 4, [170, 112, 58], 0.7);

// 10. Final polish: gentle vignette (smooth, so the PNG stays small).
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const dx = (x - CX) / (W / 2);
    const dy = (y - H / 2) / (H / 2);
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > 0.75) {
      const vig = 1 - (d - 0.75) * 0.55;
      const i = (y * W + x) * 4;
      buf[i] = Math.max(0, Math.min(255, buf[i] * vig));
      buf[i + 1] = Math.max(0, Math.min(255, buf[i + 1] * vig));
      buf[i + 2] = Math.max(0, Math.min(255, buf[i + 2] * vig));
    }
  }
}

// ---------------------------------------------------------------------------
// PNG encoding (hand-written: IHDR, IDAT via zlib, IEND; CRC32)
// ---------------------------------------------------------------------------
const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}
function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}

function encodePng(): Buffer {
  // RGB (colour type 2): alpha is always opaque, so dropping it saves ~25%.
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0; // filter: none
    for (let x = 0; x < W; x++) {
      const s = (y * W + x) * 4;
      const d = y * (1 + W * 3) + 1 + x * 3;
      raw[d] = buf[s];
      raw[d + 1] = buf[s + 1];
      raw[d + 2] = buf[s + 2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = deflateSync(raw, { level: 9 });
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

mkdirSync("/output", { recursive: true });
writeFileSync("/output/entry.png", encodePng());
console.log("wrote /output/entry.png");
