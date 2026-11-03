// Rough weight/time estimate for an STL (mm units) from print parameters. Sliced .3mf files give exact numbers instead.
const MATERIALS = {            // density g/cm3, effective volumetric speed mm3/s on a Bambu printer
  PLA: { d: 1.24, flow: 9 }, PETG: { d: 1.27, flow: 7 }, ABS: { d: 1.04, flow: 7 }, ASA: { d: 1.07, flow: 7 }, TPU: { d: 1.21, flow: 3 },
};
const BUILD_LIMIT = 256;       // mm, P1S / P2S build plate edge

function parseStl(buf) {
  const tri = [];
  if (buf.length >= 84 && buf.length === 84 + 50 * buf.readUInt32LE(80)) {
    for (let i = 0, n = buf.readUInt32LE(80); i < n; i++) {
      const o = 84 + i * 50 + 12, v = [];
      for (let j = 0; j < 9; j++) v.push(buf.readFloatLE(o + j * 4));
      tri.push(v);
    }
  } else {
    const p = [...buf.toString().matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)].map(m => [+m[1], +m[2], +m[3]]);
    for (let i = 0; i + 2 < p.length; i += 3) tri.push([...p[i], ...p[i + 1], ...p[i + 2]]);
  }
  if (!tri.length) throw new Error('Could not read this STL file.');
  let vol = 0, area = 0; const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const [a, b, c, d, e, f, g, h, i] of tri) {
    vol += (a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)) / 6;
    const ux = d - a, uy = e - b, uz = f - c, vx = g - a, vy = h - b, vz = i - c;
    area += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    for (const [k, x] of [[0, a], [1, b], [2, c], [0, d], [1, e], [2, f], [0, g], [1, h], [2, i]]) { if (x < min[k]) min[k] = x; if (x > max[k]) max[k] = x; }
  }
  const size = max.map((m, k) => m - min[k]);
  if (!isFinite(vol) || Math.abs(vol) < 1) throw new Error('This STL has no volume (is it a closed model?).');
  return { volume: Math.abs(vol), area, size };
}

function checkParams(p) {
  const out = {
    material: String(p.material || 'PLA').toUpperCase(), layer: +p.layer || 0.2,
    infill: p.infill === '' || p.infill == null ? 15 : +p.infill, supports: p.supports === true || p.supports === 'true' || p.supports === '1' || p.supports === 1,
    copies: Math.round(+p.copies || 1),
  };
  if (!MATERIALS[out.material]) throw new Error('Unknown material');
  if (!(out.layer >= 0.08 && out.layer <= 0.4)) throw new Error('Layer height must be 0.08 to 0.4 mm');
  if (!(out.infill >= 0 && out.infill <= 100)) throw new Error('Infill must be 0 to 100 %');
  if (!(out.copies >= 1 && out.copies <= 20)) throw new Error('Copies must be 1 to 20');
  return out;
}

function estimate(geo, p) {
  if (Math.max(...geo.size) > BUILD_LIMIT) throw new Error(`Part is ${geo.size.map(x => Math.round(x)).join(' x ')} mm; the printers fit at most ${BUILD_LIMIT} mm per side. Scale it down or split it.`);
  const m = MATERIALS[p.material];
  const shell = Math.min(geo.volume, geo.area * 1.2);                    // 2 walls + top/bottom layers
  let vol = (shell + Math.max(0, geo.volume - shell) * (p.infill / 100)) * (p.supports ? 1.15 : 1) * 1.03;
  const layers = geo.size[2] / p.layer;
  return {
    grams: Math.max(0.5, (vol / 1000) * m.d * p.copies),
    minutes: ((vol / m.flow + layers * 6) * p.copies) / 60,
  };
}
module.exports = { MATERIALS, BUILD_LIMIT, parseStl, checkParams, estimate };
