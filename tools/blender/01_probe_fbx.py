# Probe every source FBX so the conversion plan is based on measured facts, not assumptions.
# Run:  blender.exe -b --python tools/blender/01_probe_fbx.py -- <fbx_dir> <out_json>
import bpy, sys, os, json, math

argv = sys.argv[sys.argv.index("--") + 1:]
FBX_DIR, OUT_JSON = argv[0], argv[1]

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)

report = []
files = sorted(f for f in os.listdir(FBX_DIR) if f.lower().endswith(".fbx"))

for fn in files:
    reset()
    path = os.path.join(FBX_DIR, fn)
    try:
        bpy.ops.import_scene.fbx(filepath=path, automatic_bone_orientation=True)
    except Exception as e:
        report.append({"file": fn, "error": str(e)})
        continue

    meshes, armatures, actions, mats = [], [], [], set()
    for ob in bpy.data.objects:
        if ob.type == "MESH":
            me = ob.data
            meshes.append({
                "name": ob.name,
                "verts": len(me.vertices),
                "polys": len(me.polygons),
                "tris": sum(len(p.vertices) - 2 for p in me.polygons),
                "uv_layers": [l.name for l in me.uv_layers],
                "vgroups": len(ob.vertex_groups),
                "materials": [m.name for m in me.materials if m],
            })
            for m in me.materials:
                if m: mats.add(m.name)
        elif ob.type == "ARMATURE":
            armatures.append({"name": ob.name, "bones": len(ob.data.bones),
                              "root_bones": [b.name for b in ob.data.bones if b.parent is None]})

    for a in bpy.data.actions:
        fr = a.frame_range
        actions.append({"name": a.name, "start": round(fr[0], 2), "end": round(fr[1], 2),
                        "frames": int(round(fr[1] - fr[0])) + 1, "fcurves": len(a.fcurves)})

    sc = bpy.context.scene
    report.append({
        "file": fn,
        "scene_fps": sc.render.fps,
        "scene_frame_start": sc.frame_start,
        "scene_frame_end": sc.frame_end,
        "meshes": meshes,
        "armatures": armatures,
        "actions": actions,
        "images": [{"name": i.name, "size": list(i.size)} for i in bpy.data.images if i.name != "Render Result"],
        "material_names": sorted(mats),
    })
    print("PROBED", fn, flush=True)

with open(OUT_JSON, "w", encoding="utf-8") as f:
    json.dump(report, f, indent=2)
print("WROTE", OUT_JSON)
