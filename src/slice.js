// Reads filament grams and print time from a sliced Bambu .3mf (Metadata/slice_info.config).
// For a raw .stl there is no slicer here, so we give a rough estimate (exact=0).
const { unzipSync, strFromU8 } = require('fflate');
const fs = require('node:fs');

function from3mf(buf) {
  const files = unzipSync(new Uint8Array(buf));
  const f = files['Metadata/slice_info.config'];
  if (!f) throw new Error('This 3MF is not sliced. Slice it in Bambu Studio and export the sliced .3mf (File > Export > Export plate sliced file).');
  const xml = strFromU8(f);
  const grams = [...xml.matchAll(/<filament [^>]*used_g="([\d.]+)"/g)].reduce((s, m) => s + parseFloat(m[1]), 0);
  const pred = xml.match(/key="prediction"\s+value="(\d+)"/);
  if (!grams) throw new Error('No filament usage found in the 3MF.');
  const pic = files['Metadata/plate_1.png'] || files[Object.keys(files).find(k => /^Metadata\/plate_\d+\.png$/.test(k))] || files['Metadata/top_1.png'];
  return { grams, minutes: pred ? parseInt(pred[1], 10) / 60 : 0, exact: 1, thumb: pic ? Buffer.from(pic) : null };
}

function fromStl(buf) {
  // volume via signed tetrahedra; handles binary and ASCII STL
  let tris = [];
  const isBin = buf.length === 84 + 50 * buf.readUInt32LE(80);
  if (isBin) {
    for (let i = 0; i < buf.readUInt32LE(80); i++) {
      const o = 84 + i * 50 + 12, v = [];
      for (let j = 0; j < 9; j++) v.push(buf.readFloatLE(o + j * 4));
      tris.push(v);
    }
  } else {
    const nums = [...buf.toString().matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)].map(m => [+m[1], +m[2], +m[3]]);
    for (let i = 0; i + 2 < nums.length; i += 3) tris.push([...nums[i], ...nums[i + 1], ...nums[i + 2]]);
  }
  if (!tris.length) throw new Error('Could not read STL.');
  let vol = 0;
  for (const [a, b, c, d, e, f, g, h, i] of tris)
    vol += (a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)) / 6;
  const cm3 = Math.abs(vol) / 1000;               // mm^3 -> cm^3
  const grams = Math.max(1, cm3 * 1.24 * 0.3);    // PLA density, ~30% effective fill (rough)
  return { grams, minutes: grams * 2.5, exact: 0 };
}

module.exports.from3mf = from3mf;
module.exports = Object.assign((path, name) => {
  const buf = fs.readFileSync(path);
  return /\.3mf$/i.test(name) ? from3mf(buf) : fromStl(buf);
}, { from3mf });
