"""
Ground-truth verification of the companion GLBs by round-tripping them through a real glTF
implementation.

  blender --background --factory-startup --python tools/verify_glb.py

Why not verify by reading the container in JS?
-----------------------------------------------
Because a first attempt at that measured the wrong thing and reported a 3 mm tall character. For a
skinned mesh the glTF spec says the mesh node's own transform MUST be ignored -- the vertices are
placed by the joint matrices, so POSITION accessor min/max walked through the node hierarchy is
not render space and cannot be compared against a target height.

Importing the GLB and evaluating the depsgraph asks the question the right way round: what does a
conforming consumer actually put on screen? That covers scale, ground line, pivot, the armature
binding, and whether the animations survived the NLA export -- in one measurement each.
"""

import json
import math
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DIR = os.path.join(ROOT, "app", "public", "companions")

failures = []
lines = []


def out(msg):
    lines.append(msg)
    print(msg, flush=True)


def check(ok, msg):
    out("  %s %s" % ("ok  " if ok else "FAIL", msg))
    if not ok:
        failures.append(msg)


def wipe():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=True)
    for coll in (bpy.data.actions, bpy.data.armatures, bpy.data.meshes,
                 bpy.data.materials, bpy.data.images, bpy.data.objects):
        for item in list(coll):
            try:
                coll.remove(item)
            except Exception:
                pass


def skinned_meshes():
    """Only the meshes bound to the armature.

    Blender's glTF importer adds an unrelated `Icosphere` to the scene on import -- confirmed not
    to be in the file by reading the GLB's own JSON, which declares exactly one mesh with one
    primitive. Filtering on the ARMATURE modifier keeps that phantom out of the measurement
    instead of letting a 2-unit sphere define the character's height.
    """
    return [o for o in bpy.context.scene.objects
            if o.type == "MESH" and any(m.type == "ARMATURE" for m in o.modifiers)]


def evaluated_bounds():
    """World-space bounds of the skinned mesh with modifiers evaluated, so the armature deform is
    included. This is the shape a renderer draws."""
    dg = bpy.context.evaluated_depsgraph_get()
    lo = Vector((math.inf,) * 3)
    hi = Vector((-math.inf,) * 3)
    verts = 0
    for obj in skinned_meshes():
        ev = obj.evaluated_get(dg)
        mesh = ev.to_mesh()
        mw = ev.matrix_world
        for v in mesh.vertices:
            w = mw @ v.co
            verts += 1
            for i in range(3):
                lo[i] = min(lo[i], w[i])
                hi[i] = max(hi[i], w[i])
        ev.to_mesh_clear()
    return (lo, hi, verts) if verts else (None, None, 0)


manifest_path = os.path.join(DIR, "manifest.json")
if not os.path.exists(manifest_path):
    print("FATAL no manifest at %s" % manifest_path)
    sys.exit(2)

with open(manifest_path, encoding="utf-8") as f:
    manifest = json.load(f)

target = manifest["targetHeight"]
out("target height: %.3f m" % target)
out("license: %s / %s (attribution required: %s)"
    % (manifest["license"]["author"], manifest["license"]["license"],
       manifest["license"]["requires_attribution"]))

heights = {}

for c in manifest["companions"]:
    path = os.path.join(DIR, os.path.basename(c["file"]))
    out("")
    out("--- %s (%s, %s rig) ---" % (c["id"], c["label"], c["rig"]))
    wipe()
    bpy.ops.import_scene.gltf(filepath=path)

    arms = [o for o in bpy.context.scene.objects if o.type == "ARMATURE"]
    meshes = skinned_meshes()
    anims = sorted(a.name for a in bpy.data.actions)
    expected = sorted(x["name"] for x in c["clips"])

    # Measure the POSED character at the same canonical frame the converter normalised against.
    # The rest pose of this pack is not the character -- it measures ~0.33 units of bind offset, and
    # the clips carry root motion on the armature's object transform, so both "which pose" and
    # "which frame" have to match the converter or the numbers are not comparable.
    if arms:
        arm = arms[0]
        idle = next((a for a in bpy.data.actions if a.name == "idle1"), None) \
            or next((a for a in bpy.data.actions if "idle1" in a.name), None) \
            or (bpy.data.actions[0] if bpy.data.actions else None)
        if idle is not None:
            if arm.animation_data is None:
                arm.animation_data_create()
            for t in arm.animation_data.nla_tracks:
                t.mute = True
            arm.animation_data.action = idle
            out("  measuring pose: %s @ frame 1" % idle.name)
        arm.data.pose_position = "POSE"
        bpy.context.scene.frame_set(1)
        bpy.context.view_layer.update()

    lo, hi, nverts = evaluated_bounds()
    if lo is None:
        check(False, "imported GLB contains a mesh")
        continue

    height = hi.z - lo.z
    foot = lo.z
    cx = (lo.x + hi.x) * 0.5
    cy = (lo.y + hi.y) * 0.5
    heights[c["id"]] = height

    out("  armatures=%d meshes=%d verts=%d" % (len(arms), len(meshes), nverts))
    out("  bounds z %.4f .. %.4f  height=%.4f" % (lo.z, hi.z, height))
    out("  pivot offset x=%.4f y=%.4f" % (cx, cy))
    out("  actions (%d): %s" % (len(anims), ", ".join(anims)))

    check(len(arms) == 1, "exactly one armature (%d)" % len(arms))
    check(len(meshes) >= 1, "has skinned mesh (%d)" % len(meshes))
    check(any(m.modifiers for m in meshes), "mesh is bound to the armature (has modifier)")
    check(abs(height - target) < 0.03,
          "height within 3 cm of %.2f m (got %.4f)" % (target, height))
    check(abs(foot) < 0.03, "ground line at z=0 (got %.4f)" % foot)
    check(abs(cx) < 0.08 and abs(cy) < 0.08,
          "pivot centred in x/y (%.3f, %.3f)" % (cx, cy))

    # Clip survival. Blender's glTF importer names imported actions after the animation, sometimes
    # with an object prefix, so match by containment rather than demanding exact equality.
    missing = [e for e in expected if not any(e == a or a.endswith(e) or e in a for a in anims)]
    check(not missing, "every manifest clip present (missing: %s)" % (missing or "none"))
    check(len(anims) >= len(expected),
          "action count >= manifest clip count (%d/%d)" % (len(anims), len(expected)))

    # A clip that exists but keys nothing is worse than a missing clip: it looks fine in a list and
    # freezes on screen. Require real fcurves and a non-zero frame range on each.
    empty = [a.name for a in bpy.data.actions if len(a.fcurves) == 0]
    flat = [a.name for a in bpy.data.actions if (a.frame_range[1] - a.frame_range[0]) < 1]
    check(not empty, "no action has zero fcurves (%s)" % (empty or "none"))
    check(not flat, "no action is a single frame (%s)" % (flat or "none"))

    mats = {m.name for o in meshes for m in o.data.materials if m}
    imgs = sorted(i.name for i in bpy.data.images if i.name != "Render Result")
    out("  materials: %s" % (", ".join(sorted(mats)) or "none"))
    out("  images: %s" % (", ".join(imgs) or "none"))
    check(len(mats) > 0, "mesh has a material")
    check(len(imgs) > 0, "texture travelled with the GLB (peopleColors)")

out("")
out("--- cross-rig ---")
if len(heights) == 2:
    a, b = list(heights.values())
    check(abs(a - b) < 0.02,
          "both stock companions the same height within 2 cm (delta %.4f)" % abs(a - b))
else:
    check(False, "two stock companions present (got %d)" % len(heights))

out("")
out("PASS" if not failures else "FAIL (%d check%s)" % (len(failures), "" if len(failures) == 1 else "s"))

with open(os.path.join(DIR, "verify.log"), "w", encoding="utf-8") as f:
    f.write("\n".join(lines) + "\n")

if failures:
    sys.exit(1)
