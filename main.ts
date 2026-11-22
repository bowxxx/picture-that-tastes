// Steaming Ramen — One Bowl, One Ingredient
// A top-down bowl of ramen, drawn entirely in code with the Node.js
// standard library only. No images, no network, no randomness:
// every pixel comes from a seeded generator, so the output is
// byte-identical on every run.
//
// Run:  node main.ts
// Writes: /output/entry.png  (1024 x 1024, PNG)

import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";

// ------------------------------------------------------------------
// Seeded generator (mulberry32) — the only source of "randomness".
// ------------------------------------------------------------------
function makeRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = makeRng(20261123);
const pick = (lo, hi) => lo + rng() * (hi - lo);

// ------------------------------------------------------------------
// Canvas: a flat RGBA buffer plus a handful of tiny paint helpers.
// ------------------------------------------------------------------
const W = 1024;
const H = 1024;
const buf = Buffer.alloc(W * H * 4); // starts transparent black

function mix(a, b, t) {
  return a + (b - a) * t;
}

function dot(x, y, r, g, b, alpha) {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= W || yi >= H) return;
  const i = (yi * W + xi) * 4;
  const inv = 1 - alpha;
  buf[i] = Math.round(buf[i] * inv + r * alpha);
  buf[i + 1] = Math.round(buf[i + 1] * inv + g * alpha);
  buf[i + 2] = Math.round(buf[i + 2] * inv + b * alpha);
  buf[i + 3] = 255;
}

// Soft filled disc; `feather` px of anti-aliased edge.
function disc(cx, cy, r, color, alpha = 1, feather = 1.2) {
  const [cr, cg, cb] = color;
  const x0 = Math.max(0, Math.floor(cx - r - feather));
  const x1 = Math.min(W - 1, Math.ceil(cx + r + feather));
  const y0 = Math.max(0, Math.floor(cy - r - feather));
  const y1 = Math.min(H - 1, Math.ceil(cy + r + feather));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d >= r + feather) continue;
      const edge = d <= r ? 1 : 1 - (d - r) / feather;
      dot(x, y, cr, cg, cb, alpha * edge);
    }
  }
}

// Filled ellipse with the same soft edge.
function blob(cx, cy, rx, ry, color, alpha = 1, feather = 1.5) {
  const [cr, cg, cb] = color;
  const x0 = Math.max(0, Math.floor(cx - rx - feather));
  const x1 = Math.min(W - 1, Math.ceil(cx + rx + feather));
  const y0 = Math.max(0, Math.floor(cy - ry - feather));
  const y1 = Math.min(H - 1, Math.ceil(cy + ry + feather));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const nx = (x + 0.5 - cx) / rx;
      const ny = (y + 0.5 - cy) / ry;
      const d = Math.hypot(nx, ny);
      if (d >= 1 + feather / Math.max(rx, ry)) continue;
      const edge = d <= 1 ? 1 : Math.max(0, 1 - (d - 1) * Math.max(rx, ry) / feather);
      dot(x, y, cr, cg, cb, alpha * edge);
    }
  }
}

// Flat ring between two radii.
function ring(cx, cy, rInner, rOuter, color, alpha = 1) {
  const [cr, cg, cb] = color;
  const x0 = Math.max(0, Math.floor(cx - rOuter - 1));
  const x1 = Math.min(W - 1, Math.ceil(cx + rOuter + 1));
  const y0 = Math.max(0, Math.floor(cy - rOuter - 1));
  const y1 = Math.min(H - 1, Math.ceil(cy + rOuter + 1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d < rInner || d > rOuter) continue;
      dot(x, y, cr, cg, cb, alpha);
    }
  }
}

// Radial wash: colour A at the centre fading to colour B at radius r.
function wash(cx, cy, r, inner, outer, alpha = 1) {
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(W - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(H - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d > r) continue;
      const t = d / r;
      dot(
        x, y,
        mix(inner[0], outer[0], t),
        mix(inner[1], outer[1], t),
        mix(inner[2], outer[2], t),
        alpha,
      );
    }
  }
}

// A polyline drawn as a chain of small discs — good for wavy noodles
// and steam ribbons. `clip` optionally rejects points outside a circle.
function scribble(points, width, color, alpha = 1, clip = null) {
  for (let s = 0; s < points.length - 1; s++) {
    const [ax, ay] = points[s];
    const [bx, by] = points[s + 1];
    const len = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(len / 2));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = ax + (bx - ax) * t;
      const y = ay + (by - ay) * t;
      if (clip && Math.hypot(x - clip[0], y - clip[1]) > clip[2]) continue;
      disc(x, y, width / 2, color, alpha, 0.9);
    }
  }
}

// A gentle sine wave across a horizontal span — one noodle strand.
function noodle(yBase, amp, waves, phase, width, color, alpha, clip) {
  const pts = [];
  const span = clip[2] * 2 * 0.96;
  for (let x = -span / 2; x <= span / 2; x += 6) {
    const wobble = Math.sin((x / span) * Math.PI * 2 * waves + phase);
    const wobble2 = Math.sin((x / span) * Math.PI * 2 * (waves * 2.3) + phase * 2) * 0.35;
    pts.push([clip[0] + x, yBase + (wobble + wobble2) * amp]);
  }
  scribble(pts, width, color, alpha, clip);
}

// Thick straight stroke between two points.
function bar(x1, y1, x2, y2, width, color, alpha = 1) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.ceil(len / 2);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    disc(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, width / 2, color, alpha, 1);
  }
}

// ------------------------------------------------------------------
// Palette
// ------------------------------------------------------------------
const C = {
  wallTop: [46, 24, 12],
  wallBottom: [26, 13, 6],
  plank: [107, 66, 33],
  plankDark: [88, 53, 26],
  plankLight: [126, 80, 42],
  seam: [58, 34, 16],
  shadow: [12, 6, 3],
  bowlRed: [176, 44, 36],
  bowlRedDeep: [128, 28, 24],
  rimLight: [228, 92, 70],
  rimGloss: [244, 150, 128],
  brothCore: [238, 176, 66],
  brothEdge: [196, 120, 28],
  brothDeep: [168, 96, 20],
  noodle: [243, 219, 141],
  noodleShade: [216, 178, 92],
  eggWhite: [253, 246, 232],
  yolk: [240, 140, 26],
  yolkHot: [255, 191, 77],
  chashu: [232, 144, 124],
  chashuPale: [246, 192, 174],
  chashuCore: [201, 106, 85],
  naruto: [255, 248, 240],
  narutoPink: [232, 106, 138],
  scallion: [63, 158, 77],
  scallionDeep: [31, 107, 46],
  chop: [138, 90, 46],
  chopLight: [169, 118, 63],
  steam: [255, 250, 240],
};

// ------------------------------------------------------------------
// Scene. Bowl centre (512, 560); broth radius 300; bowl radius 352.
// ------------------------------------------------------------------
const CX = 512;
const CY = 560;
const BROTH_R = 300;
const BOWL_R = 352;

// 1 — Room: dark wall fading down, then the wooden table.
function backdrop() {
  for (let y = 0; y < H; y++) {
    const t = y / H;
    const r = mix(C.wallTop[0], C.wallBottom[0], t);
    const g = mix(C.wallTop[1], C.wallBottom[1], t);
    const b = mix(C.wallTop[2], C.wallBottom[2], t);
    for (let x = 0; x < W; x++) dot(x, y, r, g, b, 1);
  }
  // Vignette: darken the corners a touch.
  wash(CX, 420, 760, [0, 0, 0], [0, 0, 0], 0); // no-op keep structure clear
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.hypot(x - CX, y - 430) / 760;
      if (d > 0.75) dot(x, y, 0, 0, 0, Math.min(0.35, (d - 0.75) * 1.4));
    }
  }
}

function table() {
  const top = 560;
  const plankH = 116;
  for (let p = 0; p < 5; p++) {
    const y0 = top + p * plankH;
    const base = p % 2 === 0 ? C.plank : C.plankDark;
    for (let y = y0; y < Math.min(H, y0 + plankH); y++) {
      for (let x = 0; x < W; x++) {
        const grain = Math.sin(x * 0.011 + p * 2.7 + Math.sin(y * 0.05) * 2) * 6;
        dot(x, y, base[0] + grain, base[1] + grain * 0.7, base[2] + grain * 0.4, 1);
      }
    }
    // Seam between planks.
    for (let x = 0; x < W; x++) dot(x, y0, C.seam[0], C.seam[1], C.seam[2], 0.9);
    // A couple of faint grain streaks per plank.
    for (let s = 0; s < 5; s++) {
      const gy = y0 + pick(8, plankH - 8);
      const pts = [];
      for (let x = 0; x <= W; x += 14) {
        pts.push([x, gy + Math.sin(x * 0.02 + p) * 3]);
      }
      scribble(pts, 1.6, C.plankLight, 0.16);
    }
  }
}

// 2 — Soft shadow the bowl casts on the table.
function bowlShadow() {
  blob(CX, CY + 300, 330, 52, C.shadow, 0.5, 6);
  blob(CX, CY + 288, 300, 40, C.shadow, 0.35, 6);
}

// 3 — The bowl itself: deep red body, glossy rim, golden broth.
function bowl() {
  disc(CX, CY, BOWL_R, C.bowlRed, 1, 2);
  disc(CX, CY, BOWL_R - 14, C.bowlRedDeep, 1, 1.5);
  ring(CX, CY, BOWL_R - 26, BOWL_R - 14, C.rimLight, 0.95);
  // Glossy crescent on the upper-left rim.
  for (let a = Math.PI * 0.95; a < Math.PI * 1.75; a += 0.02) {
    const x = CX + Math.cos(a) * (BOWL_R - 20);
    const y = CY + Math.sin(a) * (BOWL_R - 20);
    disc(x, y, 7, C.rimGloss, 0.55, 2);
  }
  // Broth: warm radial wash, lighter where the light pools.
  wash(CX, CY, BROTH_R, C.brothCore, C.brothEdge, 1);
  wash(CX - 90, CY - 110, 190, [244, 196, 96], C.brothCore, 0.45);
  // A few glistening oil beads on the surface.
  for (let i = 0; i < 26; i++) {
    const a = rng() * Math.PI * 2;
    const rr = Math.sqrt(rng()) * (BROTH_R - 40);
    const x = CX + Math.cos(a) * rr;
    const y = CY + Math.sin(a) * rr;
    disc(x, y, pick(3, 9), [255, 214, 120], pick(0.25, 0.5), 1);
  }
}

// 4 — Noodles: a tangled bed of wavy strands filling the broth.
function noodles() {
  const clip = [CX, CY, BROTH_R - 8];
  // Darker under-strands first, pale strands on top.
  for (let i = 0; i < 34; i++) {
    const yBase = CY + pick(-BROTH_R * 0.72, BROTH_R * 0.72);
    noodle(yBase, pick(7, 15), pick(3, 6), rng() * 6, pick(5, 8), C.noodleShade, 0.85, clip);
  }
  for (let i = 0; i < 52; i++) {
    const yBase = CY + pick(-BROTH_R * 0.78, BROTH_R * 0.78);
    noodle(yBase, pick(6, 14), pick(3, 7), rng() * 6, pick(4.5, 7), C.noodle, 0.95, clip);
  }
  // A lifted swirl of noodles near the top, as if just stirred.
  for (let i = 0; i < 9; i++) {
    const pts = [];
    const cx0 = CX - 60 + i * 4;
    const cy0 = CY - 150 + i * 3;
    for (let a = 0; a <= Math.PI * 2.2; a += 0.25) {
      const r = 10 + a * 5.5;
      pts.push([cx0 + Math.cos(a) * r, cy0 + Math.sin(a) * r * 0.8]);
    }
    scribble(pts, 5, C.noodle, 0.95, clip);
  }
}

// 5 — Toppings: two soft eggs, chashu, narutomaki, scallions.
function softEgg(x, y, tilt) {
  blob(x, y, 62, 56, C.eggWhite, 1, 2);
  blob(x, y, 56, 50, [255, 252, 244], 0.6, 2);
  disc(x + tilt, y, 34, C.yolk, 1, 2);
  disc(x + tilt - 4, y - 5, 26, C.yolkHot, 0.85, 2);
  disc(x + tilt - 10, y - 12, 7, [255, 232, 170], 0.9, 1.5); // glossy catch-light
  ring(x + tilt, y, 30, 34, [214, 110, 18], 0.5);
}

function chashuSlice(x, y, r) {
  disc(x, y, r, C.chashu, 1, 2);
  disc(x, y, r * 0.72, C.chashuPale, 0.9, 2);
  // Fat marbling: a couple of pale curls.
  for (let i = 0; i < 3; i++) {
    const pts = [];
    const a0 = rng() * Math.PI * 2;
    for (let a = a0; a < a0 + Math.PI * 1.4; a += 0.3) {
      const rr = r * (0.35 + 0.3 * Math.sin(a * 2));
      pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]);
    }
    scribble(pts, 5, C.naruto, 0.75);
  }
  disc(x, y, r * 0.3, C.chashuCore, 0.95, 2);
  disc(x - r * 0.12, y - r * 0.14, 5, [255, 220, 205], 0.8, 1.5);
}

function narutomaki(x, y, r) {
  disc(x, y, r, C.naruto, 1, 2);
  // Pink rim and spiral centre.
  ring(x, y, r - 6, r - 1, C.narutoPink, 0.9);
  const pts = [];
  for (let a = 0; a <= Math.PI * 4.4; a += 0.22) {
    const rr = 3 + a * 2.4;
    pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]);
  }
  scribble(pts, 4.5, C.narutoPink, 0.95);
  // Pink speckles around the edge.
  for (let i = 0; i < 14; i++) {
    const a = rng() * Math.PI * 2;
    const rr = r * pick(0.55, 0.85);
    disc(x + Math.cos(a) * rr, y + Math.sin(a) * rr, pick(2, 4), C.narutoPink, 0.8, 1);
  }
}

function scallion(x, y, r) {
  disc(x, y, r, C.scallion, 1, 1);
  disc(x, y, r * 0.55, C.scallionDeep, 1, 1);
  disc(x - r * 0.25, y - r * 0.25, r * 0.22, [140, 220, 120], 0.9, 1);
}

function toppings() {
  softEgg(CX - 185, CY + 95, -6);
  softEgg(CX - 205, CY - 55, 5);
  chashuSlice(CX + 165, CY - 75, 72);
  chashuSlice(CX + 205, CY + 35, 62);
  narutomaki(CX + 195, CY + 165, 48);
  // Scallion confetti scattered over the noodles.
  for (let i = 0; i < 34; i++) {
    const a = rng() * Math.PI * 2;
    const rr = Math.sqrt(rng()) * (BROTH_R - 45);
    scallion(CX + Math.cos(a) * rr, CY + Math.sin(a) * rr, pick(6, 10));
  }
  // A few chilli-oil flecks for colour.
  for (let i = 0; i < 12; i++) {
    const a = rng() * Math.PI * 2;
    const rr = Math.sqrt(rng()) * (BROTH_R - 60);
    disc(CX + Math.cos(a) * rr, CY + Math.sin(a) * rr, pick(2.5, 5), [178, 32, 18], 0.75, 1);
  }
}

// 6 — Steam: soft ribbons curling up from the hot broth.
function steam() {
  for (let s = 0; s < 6; s++) {
    const x0 = CX - 190 + s * 76 + pick(-14, 14);
    const top = 130 + pick(0, 60);
    const pts = [];
    for (let y = CY - BROTH_R + 40; y >= top; y -= 8) {
      const rise = (CY - BROTH_R + 40 - y) / (CY - BROTH_R + 40 - top);
      const sway = Math.sin(y * 0.045 + s * 1.7) * (6 + rise * 22);
      pts.push([x0 + sway, y]);
    }
    // Draw the ribbon twice: a wide faint pass, then a narrow core.
    scribble(pts, 24, C.steam, 0.07);
    scribble(pts, 10, C.steam, 0.10);
  }
}

// 7 — Chopsticks resting on the rim, upper right.
function chopsticks() {
  const x1 = 560, y1 = 268, x2 = 872, y2 = 330;
  const x3 = 556, y3 = 296, x4 = 868, y4 = 366;
  bar(x1, y1, x2, y2, 13, C.chop, 1);
  bar(x1, y1 - 3, x2, y2 - 3, 4, C.chopLight, 0.8);
  bar(x3, y3, x4, y4, 13, C.chop, 1);
  bar(x3, y3 - 3, x4, y4 - 3, 4, C.chopLight, 0.8);
  // Tapered tips.
  disc(x2, y2, 5, C.chop, 1, 1);
  disc(x4, y4, 5, C.chop, 1, 1);
}

// ------------------------------------------------------------------
// Hand-written PNG encoder (stdlib zlib for the DEFLATE stream).
// ------------------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}

function encodePng() {
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0; // filter: none
    for (let x = 0; x < W; x++) {
      const src = (y * W + x) * 4;
      const dst = y * (1 + W * 3) + 1 + x * 3;
      raw[dst] = buf[src];
      raw[dst + 1] = buf[src + 1];
      raw[dst + 2] = buf[src + 2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return png;
}

// ------------------------------------------------------------------
// Paint the scene, encode, write.
// ------------------------------------------------------------------
backdrop();
table();
bowlShadow();
bowl();
noodles();
toppings();
steam();
chopsticks();

mkdirSync("/output", { recursive: true });
const png = encodePng();
writeFileSync("/output/entry.png", png);
console.log(`wrote /output/entry.png — ${png.length} bytes, ${W}x${H}`);
