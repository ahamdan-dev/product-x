# Merge every clip for one character onto a single rig and export one GLB carrying all animations.
# All 20 source FBX share the same 29-bone Biped skeleton, so actions transfer by bone name.
#
# Run: blender.exe -b --python tools/blender/02_build_companion_glb.py -- <fbx_dir> <gender> <out_glb>
import bpy, sys, os, json, re

argv = sys.argv[sys.argv.index("--") + 1:]
FBX_DIR, GENDER, OUT_GLB = argv[0], argv[1].lower(), argv[2]

# Clip map: source file -> canonical companion animation name.
# The two shared "ani_*" clips are gender-neutral celebration sources.
CLIPS = {
    "female": [
        ("female_idle1_150f.FBX",       "idle.breathe"),
        ("female_idle2_190f.FBX",       "idle.lookAround"),
        ("female_slowWalk_40f.FBX",     "locomote.stroll"),
        ("female_BasicWalk_30f.FBX",    "locomote.walk"),
        ("female_jogging_30f.FBX",      "locomote.jog"),
        ("female_running_20f.FBX",      "locomote.run"),
        ("female_phoneWalking_40f.FBX", "study.walkReading"),
        ("female_flossing_48f.FBX",     "celebrate.small"),
        ("ani_hype_100f.FBX",           "celebrate.milestone"),
        ("ani_dance_afro_56f.fbx",      "celebrate.rare"),
    ],
    "male": [
        ("male_idle1_200f.FBX",       "idle.breathe"),
        ("male_idle2_220f.FBX",       "idle.lookAround"),
        ("male_slowWalk_40f.FBX",     "locomote.stroll"),
        ("male_BasicWalk_30f.FBX",    "locomote.walk"),
        ("male_jogging_30f.FBX",      "locomote.jog"),
        ("male_running_20f.FBX",      "locomote.run"),
        ("male_phoneWalking_40f.FBX", "study.walkReading"),
        ("male_phoneTalking_180f.FBX","study.explain"),
        ("male_flossing_48f.FBX",     "celebrate.small"),
        ("ani_hype_100f.FBX",         "celebrate.milestone"),
        ("male_riverdance_60f.FBX",   "celebrate.rare"),
    ],
}

clips = CLIPS[GENDER]
bpy.ops.wm.read_factory_settings(use_empty=True)


def import_fbx(path):
    """Import and return (armature, meshes) newly added."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=path, automatic_bone_orientation=True,
                             ignore_leaf_bones=True, use_anim=True)
    new = [o for o in bpy.data.objects if o not in before]
    arm = next((o for o in new if o.type == "ARMATURE"), None)
    meshes = [o for o in new if o.type == "MESH"]
    return arm, meshes, new


def body_action(arm):
    """The action driving the skeleton (not the CharRoot helper)."""
    cands = [a for a in bpy.data.actions if a.users and a.name.startswith("bip|")
             and "Footsteps" not in a.name]
    if arm.animation_data and arm.animation_data.action:
        return arm.animation_data.action
    return cands[0] if cands else None


# --- 1. base character: first clip supplies the rig + mesh we keep ---
base_file, base_name = clips[0]
base_arm, base_meshes, _ = import_fbx(os.path.join(FBX_DIR, base_file))
assert base_arm, "no armature in base file"

act = body_action(base_arm)
act.name = base_name
act.use_fake_user = True
kept = [base_name]
print("BASE", base_file, "->", base_name, flush=True)

# --- 2. every other clip: import, steal its action, discard its geometry ---
for fn, name in clips[1:]:
    path = os.path.join(FBX_DIR, fn)
    if not os.path.exists(path):
        print("SKIP missing", fn, flush=True)
        continue
    arm, meshes, new = import_fbx(path)
    a = arm.animation_data.action if (arm and arm.animation_data) else None
    if a is None:
        print("SKIP no action", fn, flush=True)
    else:
        a.name = name
        a.use_fake_user = True          # survives the purge below
        kept.append(name)
        print("CLIP", fn, "->", name, flush=True)
    for o in new:
        bpy.data.objects.remove(o, do_unlink=True)

# --- 3. clean orphans, keep only our named actions ---
for a in list(bpy.data.actions):
    if a.name not in kept:
        bpy.data.actions.remove(a)

# --- 4. rest pose on frame 0, rig at origin, uniform scale ---
base_arm.name = f"companion_{GENDER}_rig"
base_arm.location = (0, 0, 0)
base_arm.rotation_euler = (0, 0, 0)
for m in base_meshes:
    m.name = f"companion_{GENDER}_body"

# glTF needs each action assigned as an NLA-independent track; the exporter
# handles this when we export all actions of the armature.
bpy.context.view_layer.objects.active = base_arm

# --- 5. export ---
os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
for o in bpy.data.objects:
    o.select_set(True)

bpy.ops.export_scene.gltf(
    filepath=OUT_GLB,
    export_format="GLB",
    export_animations=True,
    export_animation_mode="ACTIONS",
    export_nla_strips=False,
    export_bake_animation=False,
    export_optimize_animation_size=True,
    export_optimize_animation_keep_anim_armature=True,
    export_yup=True,
    export_apply=False,
    export_skins=True,
    export_morph=False,
    export_cameras=False,
    export_lights=False,
    export_materials="EXPORT",
    export_image_format="AUTO",
    use_selection=True,
)

meta = {
    "gender": GENDER,
    "clips": kept,
    "source_fps": 30,
    "tris": sum(sum(len(p.vertices) - 2 for p in m.data.polygons) for m in base_meshes),
    "bones": len(base_arm.data.bones),
}
with open(OUT_GLB.replace(".glb", ".meta.json"), "w", encoding="utf-8") as f:
    json.dump(meta, f, indent=2)

print("EXPORTED", OUT_GLB, json.dumps(meta))
