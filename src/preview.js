// Preview picture of an STL: shaded isometric view drawn in plain JS (no slicer needed), returned as a PNG.
const zlib = require('node:zlib');
const { triangles } = require('./estimate');

const N = 192, COLOR = [0, 174, 66];   // size in px, Bambu green
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4), body = Buffer.concat([Buffer.from(type), data]), sum = Buffer.alloc(4);
  len.writeUInt32BE(data.length); sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
};
function png(rgba) {
  const raw = Buffer.alloc((N * 4 + 1) * N);
  for (let y = 0; y < N; y++) rgba.copy(raw, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4);   // filter byte 0 per row
  const head = Buffer.alloc(13); head.writeUInt32BE(N, 0); head.writeUInt32BE(N, 4); head.set([8, 6, 0, 0, 0], 8);   // 8-bit RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function preview(stl) {
  const tris = triangles(stl);
  // z up; look from front-right above: spin 40 degrees round z, then tilt 55 degrees back
  const sp = 40 * Math.PI / 180, ti = 55 * Math.PI / 180, cs = Math.cos(sp), sn = Math.sin(sp), ct = Math.cos(ti), st = Math.sin(ti);
  const rot = (x, y, z) => { const a = x * cs - y * sn, b = x * sn + y * cs; return [a, b * ct - z * st, b * st + z * ct]; };   // [screen x, screen y (down), depth]
  const P = tris.map(t => [rot(t[0], t[1], t[2]), rot(t[3], t[4], t[5]), rot(t[6], t[7], t[8])]);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const t of P) for (const v of t) { x0 = Math.min(x0, v[0]); x1 = Math.max(x1, v[0]); y0 = Math.min(y0, v[1]); y1 = Math.max(y1, v[1]); }
  const s = (N * 0.84) / Math.max(x1 - x0, y1 - y0, 1e-6), ox = (N - (x1 - x0) * s) / 2 - x0 * s, oy = (N - (y1 - y0) * s) / 2 - y0 * s;
  const img = Buffer.alloc(N * N * 4), depth = new Float32Array(N * N).fill(-Infinity), light = [-0.35, -0.55, 0.75];
  for (const [a, b, c] of P) {
    let nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    const k = 0.35 + 0.65 * Math.abs(nx * light[0] + ny * light[1] + nz * light[2]);   // two-sided, so odd winding still shades
    const ax = a[0] * s + ox, ay = a[1] * s + oy, bx = b[0] * s + ox, by = b[1] * s + oy, cx = c[0] * s + ox, cy = c[1] * s + oy;
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy); if (Math.abs(den) < 1e-9) continue;
    for (let y = Math.max(0, Math.floor(Math.min(ay, by, cy))); y <= Math.min(N - 1, Math.ceil(Math.max(ay, by, cy))); y++)
      for (let x = Math.max(0, Math.floor(Math.min(ax, bx, cx))); x <= Math.min(N - 1, Math.ceil(Math.max(ax, bx, cx))); x++) {
        const px = x + 0.5, py = y + 0.5, w0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / den, w1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / den, w2 = 1 - w0 - w1;
        if (w0 < -0.02 || w1 < -0.02 || w2 < -0.02) continue;
        const z = w0 * a[2] + w1 * b[2] + w2 * c[2], i = y * N + x;
        if (z <= depth[i]) continue;
        depth[i] = z; img[i * 4] = COLOR[0] * k; img[i * 4 + 1] = COLOR[1] * k; img[i * 4 + 2] = COLOR[2] * k; img[i * 4 + 3] = 255;
      }
  }
  return png(img);
}
module.exports = { preview };
