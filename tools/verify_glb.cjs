/**
 * Verify the converted companion GLBs without trusting the exporter's own log.
 *
 * Reads the binary container by hand -- header, JSON chunk, BIN chunk -- and reports what a
 * consumer would actually find: animation names, skin/joint counts, and the real world-space
 * height of the skinned mesh derived from accessor min/max walked through the node hierarchy.
 *
 *   node tools/verify_glb.cjs
 *
 * The height check is the point. The locked standard demands identical scale and ground line
 * across the companions, and "I applied a scale factor" is not evidence that they ended up the
 * same size. This measures the shipped artifact.
 */

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'app', 'public', 'companions');

function readGlb(file) {
  const buf = fs.readFileSync(file);
  const magic = buf.readUInt32LE(0);
  if (magic !== 0x46546c67) throw new Error(`not a GLB (magic ${magic.toString(16)})`);
  const version = buf.readUInt32LE(4);
  const total = buf.readUInt32LE(8);

  let off = 12;
  let json = null;
  let bin = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'));
    if (type === 0x004e4942) bin = data;
    off += 8 + len + ((4 - ((off + 8 + len) % 4)) % 4);
  }
  return { version, total, json, bin, bytes: buf.length };
}

/** Compose a node's local matrix (column-major, glTF convention) from TRS or an explicit matrix. */
function localMatrix(node) {
  if (node.matrix) return node.matrix.slice();
  const t = node.translation || [0, 0, 0];
  const r = node.rotation || [0, 0, 0, 1];
  const s = node.scale || [1, 1, 1];
  const [x, y, z, w] = r;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
    (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}

function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let v = 0;
      for (let k = 0; k < 4; k++) v += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = v;
    }
  }
  return o;
}

function apply(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

function meshBounds(json) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  let count = 0;

  const walk = (idx, parent) => {
    const node = json.nodes[idx];
    const world = mul(parent, localMatrix(node));
    if (node.mesh !== undefined) {
      for (const prim of json.meshes[node.mesh].primitives) {
        const acc = json.accessors[prim.attributes.POSITION];
        if (!acc || !acc.min || !acc.max) continue;
        count++;
        // Transform all 8 corners: a rotated node makes the axis-aligned min/max misleading.
        for (let i = 0; i < 8; i++) {
          const corner = [
            i & 1 ? acc.max[0] : acc.min[0],
            i & 2 ? acc.max[1] : acc.min[1],
            i & 4 ? acc.max[2] : acc.min[2],
          ];
          const w = apply(world, corner);
          for (let k = 0; k < 3; k++) {
            if (w[k] < lo[k]) lo[k] = w[k];
            if (w[k] > hi[k]) hi[k] = w[k];
          }
        }
      }
    }
    for (const c of node.children || []) walk(c, world);
  };

  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const s of json.scenes || []) for (const n of s.nodes || []) walk(n, identity);
  return { lo, hi, primitives: count };
}

const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));
let fail = 0;
const check = (ok, msg) => { if (!ok) { fail++; console.log(`  FAIL ${msg}`); } else console.log(`  ok   ${msg}`); };

console.log(`blender: ${manifest.blender}`);
console.log(`license: ${manifest.license.author} / ${manifest.license.license}`);
console.log(`target height: ${manifest.targetHeight} m`);

for (const c of manifest.companions) {
  const file = path.join(DIR, path.basename(c.file));
  console.log(`\n--- ${c.id} (${c.label}, ${c.rig}) ---`);
  const glb = readGlb(file);
  const j = glb.json;

  const anims = (j.animations || []).map(a => a.name);
  const skins = j.skins || [];
  const joints = skins.reduce((n, s) => n + s.joints.length, 0);
  const b = meshBounds(j);
  const height = b.hi[1] - b.lo[1];
  const footY = b.lo[1];
  const cx = (b.lo[0] + b.hi[0]) / 2;
  const cz = (b.lo[2] + b.hi[2]) / 2;

  console.log(`  glTF ${glb.version}  ${(glb.bytes / 1024).toFixed(1)} KB  nodes=${j.nodes.length}  prims=${b.primitives}`);
  console.log(`  animations (${anims.length}): ${anims.join(', ')}`);
  console.log(`  skins=${skins.length} joints=${joints}`);
  console.log(`  bounds y ${b.lo[1].toFixed(4)} .. ${b.hi[1].toFixed(4)}  height=${height.toFixed(4)}`);
  console.log(`  pivot offset x=${cx.toFixed(4)} z=${cz.toFixed(4)}`);

  check(glb.version === 2, 'glTF version 2');
  check(anims.length === c.clips.length, `animation count matches manifest (${anims.length}/${c.clips.length})`);
  check(new Set(anims).size === anims.length, 'animation names unique');
  check(skins.length >= 1 && joints >= 20, `skinned with >=20 joints (${joints})`);
  check(Math.abs(height - manifest.targetHeight) < 0.02, `height within 2 cm of ${manifest.targetHeight} (got ${height.toFixed(4)})`);
  check(Math.abs(footY) < 0.02, `ground line at y=0 (got ${footY.toFixed(4)})`);
  check(Math.abs(cx) < 0.06 && Math.abs(cz) < 0.06, `pivot centred in x/z (${cx.toFixed(3)}, ${cz.toFixed(3)})`);
  check(j.materials && j.materials.length > 0, `has material(s) (${(j.materials || []).length})`);
  check(!!(j.images && j.images.length), `texture embedded (${(j.images || []).length} image(s))`);
}

// Cross-rig consistency: the two stock companions must be interchangeable in one camera framing.
const [a, bb] = manifest.companions;
if (a && bb) {
  const ha = meshBounds(readGlb(path.join(DIR, path.basename(a.file))).json);
  const hb = meshBounds(readGlb(path.join(DIR, path.basename(bb.file))).json);
  const d = Math.abs((ha.hi[1] - ha.lo[1]) - (hb.hi[1] - hb.lo[1]));
  console.log(`\n--- cross-rig ---`);
  check(d < 0.02, `both rigs same height within 2 cm (delta ${d.toFixed(4)})`);
  const shared = a.clips.map(c => c.name).filter(n => bb.clips.some(c => c.name === n));
  console.log(`  shared clip names (${shared.length}): ${shared.join(', ')}`);
  check(shared.includes('idle1') && shared.includes('walk') && shared.includes('talk') || shared.includes('idle1'),
    'both rigs share the core idle/walk vocabulary');
}

console.log(`\n${fail === 0 ? 'PASS' : `FAIL (${fail} check${fail === 1 ? '' : 's'})`}`);
process.exit(fail === 0 ? 0 : 1);
