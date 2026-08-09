/**
 * Dump a GLB's own JSON chunk: node hierarchy, skins, and which node each mesh/skin hangs off.
 *
 *   node tools/gltf_json.mjs app/public/companions/companion-a.glb
 *
 * Zero dependencies -- no three, no Electron, no dev server. It reads the binary container by hand, so it
 * works when the loader is the thing under suspicion and it works on a file three.js refuses to parse.
 *
 * ══ WHY IT EXISTS ════════════════════════════════════════════════════════════════════════════
 *
 * Every other harness reports what THREE.JS BELIEVES about a file. When a measurement is surprising, the
 * question becomes which of the two is wrong -- the file or the interpretation -- and that cannot be
 * answered with more three.js. This prints the file's own declarations, so the two can be compared.
 *
 * It earned its place during the rig investigation by answering questions no skinning measurement could:
 *
 *   * `inverseBindMatrices=ABSENT` would mean identity inverse binds are being assumed, which silently
 *      changes what every skinning number means. Printed explicitly rather than left to be inferred.
 *   * Channels targeting NON-JOINT nodes -- root motion baked onto the armature or an ancestor empty. That
 *     is what the converter strips, and this is how you confirm it actually stripped it.
 *   * The chain of node transforms above the skinned mesh. On these files that chain is load-bearing:
 *     `companion_root` carries scale 0.0096 to bring ~100x authored geometry down to 1.75 m, and the mesh
 *     node itself carries a -90 degrees X rotation. Both are invisible to any measurement of raw vertices.
 *   * `generator`, which is how a stale artifact gets caught. A GLB claiming a retired generator is a file
 *     that predates the current pipeline.
 *
 * ══ READING THE OUTPUT ON THESE ASSETS ═══════════════════════════════════════════════════════
 *
 * Expect: generator naming the three.js GLTFExporter path, one skin with 29 joints, inverseBindMatrices
 * present, and no channels targeting non-joint nodes. Note that a skinned mesh node's own transform MUST
 * be ignored by a conforming renderer (glTF spec) -- so the rotation printed on the mesh node does not
 * orient the figure, and reasoning as if it does leads directly to the wrong conclusion.
 */

import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node tools/gltf_json.mjs <glb>');
  console.error('   eg: node tools/gltf_json.mjs app/public/companions/companion-a.glb');
  process.exit(2);
}

const buf = readFileSync(file);
// GLB: 12-byte header, then chunks of [length u32][type u32][data].
let off = 12;
let json = null;
while (off < buf.length) {
  const len = buf.readUInt32LE(off);
  const type = buf.readUInt32LE(off + 4);
  if (type === 0x4e4f534a) { json = JSON.parse(buf.slice(off + 8, off + 8 + len).toString('utf8')); break; }
  off += 8 + len + ((4 - (len % 4)) % 4);
}
if (!json) { console.error('no JSON chunk'); process.exit(1); }

const r = (n) => +Number(n).toFixed(4);
const nodes = json.nodes || [];

const parentOf = new Map();
nodes.forEach((n, i) => (n.children || []).forEach(c => parentOf.set(c, i)));

const desc = (i) => {
  const n = nodes[i];
  const bits = [];
  if (n.translation) bits.push(`T=[${n.translation.map(r)}]`);
  if (n.rotation) bits.push(`Q=[${n.rotation.map(r)}]`);
  if (n.scale) bits.push(`S=[${n.scale.map(r)}]`);
  if (n.matrix) bits.push(`M=[${n.matrix.map(r)}]`);
  if (n.mesh !== undefined) bits.push(`mesh=${n.mesh}`);
  if (n.skin !== undefined) bits.push(`skin=${n.skin}`);
  return `${n.name || '(unnamed)'}  ${bits.join(' ') || '(identity)'}`;
};

console.log(`=== ${file} ===`);
console.log(`generator: ${json.asset?.generator}`);
console.log(`nodes=${nodes.length} skins=${(json.skins || []).length} meshes=${(json.meshes || []).length} animations=${(json.animations || []).length}`);

/*
 * Index presence, per primitive. These assets are NON-INDEXED -- FBXLoader drops the index buffer and
 * GLTFExporter writes what it is given. It is printed here because downstream code that bails on a missing
 * index (the app's own tear check did) is silently inert on these files, and that bug is invisible unless
 * someone looks at exactly this.
 */
console.log('\n-- primitives: index buffer and vertex count --');
(json.meshes || []).forEach((m, mi) => {
  m.primitives.forEach((p, pi) => {
    const posAcc = json.accessors[p.attributes.POSITION];
    const idxAcc = p.indices !== undefined ? json.accessors[p.indices] : null;
    const tris = idxAcc ? idxAcc.count / 3 : posAcc.count / 3;
    console.log(`  mesh ${mi} prim ${pi}: verts=${posAcc.count}  ` +
      `indices=${idxAcc ? idxAcc.count : 'ABSENT (non-indexed)'}  triangles=${tris}`);
  });
});

console.log('\n-- roots and the chain down to each skinned mesh --');
nodes.forEach((n, i) => {
  if (n.mesh === undefined && n.skin === undefined) return;
  const chain = [];
  let cur = i;
  while (cur !== undefined) { chain.unshift(cur); cur = parentOf.get(cur); }
  console.log(`\nnode ${i} (${n.name}):`);
  chain.forEach((c, d) => console.log(`  ${'  '.repeat(d)}[${c}] ${desc(c)}`));
});

(json.skins || []).forEach((s, i) => {
  console.log(`\n-- skin ${i} --`);
  console.log(`  name=${s.name} joints=${s.joints.length} skeleton=${s.skeleton}` +
    `${s.skeleton !== undefined ? ` (${nodes[s.skeleton]?.name})` : ''}` +
    `  inverseBindMatrices=${s.inverseBindMatrices !== undefined ? 'present' : 'ABSENT (identity assumed)'}`);
  const jointRoots = s.joints.filter(j => !s.joints.includes(parentOf.get(j)));
  console.log(`  joint roots: ${jointRoots.map(j => `[${j}] ${nodes[j].name}`).join(', ')}`);
});

console.log('\n-- animation channel targets (first animation) --');
const a0 = (json.animations || [])[0];
if (a0) {
  const targets = new Map();
  for (const ch of a0.channels) {
    const t = ch.target.node;
    if (!targets.has(t)) targets.set(t, []);
    targets.get(t).push(ch.target.path);
  }
  console.log(`  animation "${a0.name}": ${a0.channels.length} channels over ${targets.size} nodes`);
  const skinJoints = new Set((json.skins || [])[0]?.joints || []);
  const nonJoint = [...targets.keys()].filter(t => !skinJoints.has(t));
  // Non-joint targets are root motion. The converter strips them; this is how that is confirmed.
  console.log(`  channels targeting NON-joint nodes: ${nonJoint.length ? nonJoint.map(t => `[${t}] ${nodes[t].name} (${targets.get(t).join(',')})`).join(', ') : 'none'}`);
}

// Every clip's name and channel count, so a missing or inert clip is visible without loading the file.
console.log('\n-- all animations --');
for (const a of json.animations || []) {
  console.log(`  ${(a.name || '(unnamed)').padEnd(12)} channels=${a.channels.length} samplers=${a.samplers.length}`);
}
