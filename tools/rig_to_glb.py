"""
Convert the supplied CC-BY animation pack into the two stock companions.

Run headless:
  blender --background --factory-startup --python tools/rig_to_glb.py

Why this exists
---------------
The user's ruling: "THE TWO 3D RIGGED AND ANIMATED MODELS I GAVE YOU ARE THE TWO AI COMPANION
OPTIONS A USER CAN PICK FROM (STOCK OPTIONS)." The pack ships as 20 separate binary FBX files
(11 MB) where every file contains its own copy of the same skinned mesh plus one clip. Shipping
that to a browser would mean 20 redundant meshes and 20 skeletons.

So: import clip 1 to get the mesh + armature, then for every remaining clip import it only to
steal its Action, retarget that Action onto the first armature (bone names are identical across
the pack because it is one rig), and throw the duplicate mesh away. Result is two GLBs, one per
rig, each carrying one mesh, one skeleton, and every clip as a named animation.

Normalisation matters as much as the conversion. The locked sprite standard demands "identical
character scale / pivot / ground line" across frames, and the same reasoning applies across the
two rigs: if male and female arrive at different heights or with different origins, every camera
framing and every anchor position has to be tuned twice. So both rigs are scaled to a common
height with feet on y=0 and the pivot centred in x/z.

Attribution is not optional. "Free Animation Pack - City People Commons" by Denys Almaral,
Creative Commons 4.0, attribution required. The manifest carries the license so the UI can
render it, and CI can assert it is present.
"""

import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

# --------------------------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------------------------

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PACK = os.path.join(ROOT, "_refs", "PRODUCT-X", "V1-LOW-POLY-ANIMATIONS (Unzipped Files)", "fbx")
OUT_DIR = os.path.join(ROOT, "app", "public", "companions")

# Target height in metres. 1.75 is an ordinary adult; the exact number matters less than both
# rigs sharing it, because the camera rig and every anchor offset are expressed relative to it.
TARGET_HEIGHT = 1.75

# The pack's clips, grouped by rig. Frame counts are in the filenames and are authoritative --
# they are the animator's intent, not something to infer from the imported action range.
RIGS = {
    "companion-a": {
        "label": "Ash",
        "rig": "male",
        "clips": [
            ("idle1", "male_idle1_200f.FBX", 200),
            ("idle2", "male_idle2_220f.FBX", 220),
            ("walk", "male_BasicWalk_30f.FBX", 30),
            ("walk_slow", "male_slowWalk_40f.FBX", 40),
            ("jog", "male_jogging_30f.FBX", 30),
            ("run", "male_running_20f.FBX", 20),
            ("talk", "male_phoneTalking_180f.FBX", 180),
            ("walk_busy", "male_phoneWalking_40f.FBX", 40),
            ("celebrate", "male_flossing_48f.FBX", 48),
            ("flourish", "male_riverdance_60f.FBX", 60),
        ],
        "shared": [
            ("hype", "ani_hype_100f.FBX", 100),
            ("dance", "ani_dance_afro_56f.fbx", 56),
        ],
    },
    "companion-b": {
        "label": "Wren",
        "rig": "female",
        "clips": [
            ("idle1", "female_idle1_150f.FBX", 150),
            ("idle2", "female_idle2_190f.FBX", 190),
            ("walk", "female_BasicWalk_30f.FBX", 30),
            ("walk_slow", "female_slowWalk_40f.FBX", 40),
            ("jog", "female_jogging_30f.FBX", 30),
            ("run", "female_running_20f.FBX", 20),
            ("walk_busy", "female_phoneWalking_40f.FBX", 40),
            ("celebrate", "female_flossing_48f.FBX", 48),
        ],
        "shared": [
            ("hype", "ani_hype_100f.FBX", 100),
            ("dance", "ani_dance_afro_56f.fbx", 56),
        ],
    },
}

LICENSE = {
    "pack": "Free Animation Pack - City People Commons",
    "author": "Denys Almaral",
    "license": "CC BY 4.0",
    "requires_attribution": True,
    "source": "https://denysalmaral.com/2019/07/free-animation-pack-city-people-common-moves-wip.html",
    "notice": "Character animations by Denys Almaral, licensed CC BY 4.0.",
}

log_lines = []


def log(msg):
    line = str(msg)
    log_lines.append(line)
    print(line, flush=True)


# --------------------------------------------------------------------------------------------
# Scene helpers
# --------------------------------------------------------------------------------------------

def wipe_scene():
    """Factory-startup still ships a cube, a camera and a light. Remove everything, including
    orphaned actions, so an import's actions are unambiguous."""
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=True)
    for coll in (bpy.data.actions, bpy.data.armatures, bpy.data.meshes,
                 bpy.data.materials, bpy.data.images):
        for item in list(coll):
            coll.remove(item)


def import_fbx(path):
    """Import one FBX and return the objects it added.

    automatic_bone_orientation is on because the pack comes out of 3ds Max Biped; without it the
    bone roll is wrong and limbs twist. ignore_leaf_bones keeps the skeleton close to the
    original -- leaf bones add nodes that carry no animation and inflate the GLB.
    """
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(
        filepath=path,
        automatic_bone_orientation=True,
        ignore_leaf_bones=True,
        use_anim=True,
    )
    return [o for o in bpy.data.objects if o not in before]


def find_armature(objs):
    for o in objs:
        if o.type == "ARMATURE":
            return o
    return None


def action_of(arm):
    ad = arm.animation_data
    return ad.action if ad and ad.action else None


# --------------------------------------------------------------------------------------------
# Build one rig
# --------------------------------------------------------------------------------------------

def measure():
    """True world-space bounds of the skinned character, armature deform evaluated.

    Three things here are deliberate and were each learned the hard way:

    * Only meshes carrying an ARMATURE modifier count. Anything else in the scene is not the
      companion and must not influence its height.
    * The depsgraph is evaluated, so what gets measured is the deformed mesh a renderer draws --
      not `bound_box`, which is the undeformed local box and gave two different "heights" for what
      is anatomically the same character.
    * Vertices, not the 8 bounding-box corners. A rotated node makes the local box a poor proxy.
    """
    dg = bpy.context.evaluated_depsgraph_get()
    lo = Vector((math.inf,) * 3)
    hi = Vector((-math.inf,) * 3)
    n = 0
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or not any(m.type == "ARMATURE" for m in obj.modifiers):
            continue
        ev = obj.evaluated_get(dg)
        mesh = ev.to_mesh()
        mw = ev.matrix_world
        for v in mesh.vertices:
            w = mw @ v.co
            n += 1
            for i in range(3):
                lo[i] = min(lo[i], w[i])
                hi[i] = max(hi[i], w[i])
        ev.to_mesh_clear()
    if not n:
        return None, None
    return lo, hi


def strip_root_motion(actions):
    """Remove object-level transform channels from every clip, leaving bone animation only.

    The pack bakes locomotion into the armature's own object transform -- `basicWalk` literally
    translates the character across the world. That is right for a game where the clip drives
    movement, and wrong here for two reasons:

    * The app owns where the companion is. It anchors to desktop percentages and drifts with
      intent; a clip that also translates fights that placement and walks the character off its
      anchor.
    * It makes the ground line unverifiable. Some clips animate object location and some do not, so
      whether the feet land on z=0 depends on which clip is playing -- which is exactly the residual
      error that survived normalisation on the female rig (correct height, floating 18 cm).

    Bone channels are untouched, so the walk still looks like a walk -- it just walks in place, and
    the app decides whether that turns into travel.
    """
    removed = {}
    for name, act in actions.items():
        doomed = [fc for fc in act.fcurves if not fc.data_path.startswith("pose.bones")]
        if not doomed:
            continue
        paths = sorted({fc.data_path for fc in doomed})
        for fc in doomed:
            act.fcurves.remove(fc)
        removed[name] = paths
    if removed:
        log("  stripped root motion from %d clip(s): %s"
            % (len(removed), ", ".join(sorted(removed))))
    return removed


def add_normalisation_parent(arm, name):
    """Insert a fresh, un-animated empty above the rig and return it.

    Normalisation cannot be applied to any existing node in this hierarchy. The pack's rig is
    `rig_CharRoot` (an empty at scale 0.01) -> `bip` (armature) -> mesh, and:

    * the clips animate the ARMATURE's object-level location -- root motion, 3 `location` fcurves
      per action -- so a location written onto the armature is overwritten the moment a clip plays;
    * each source FBX also ships a second action bound to `rig_CharRoot` itself, so that node's
      transform is animated too and is likewise overwritten on export.

    That is precisely why an earlier attempt reported a converged 1.7500 and then exported a GLB
    still measuring 1.8099: the corrections were written to nodes whose transforms animation owns.
    A brand-new parent that nothing keys is immune, and its local space is world space, which makes
    the arithmetic trivial.
    """
    empty = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(empty)
    empty.empty_display_size = 0.2

    root = arm
    while root.parent is not None:
        root = root.parent

    world = root.matrix_world.copy()
    root.parent = empty
    root.matrix_world = world  # preserve the rig's current placement under the new parent
    bpy.context.view_layer.update()
    return empty


def normalise(arm, target, canonical_action, canonical_frame=1):
    """Scale to `target` height, put the feet on z=0, centre the pivot in x/y.

    Measured on a POSED character at one canonical frame, never at rest. The rest pose of this pack
    is not the character: measuring it returns ~0.33 units of bind-offset garbage, and trusting that
    number is what produced a 5.4x wrong scale factor earlier. Frame 1 of the idle clip is the pose
    the user first sees, so it is the honest thing to normalise against.

    Structured as measure -> correct -> measure again. A single computed transform is unverifiable
    by construction; the loop's final measurement is the asset's actual geometry.
    """
    holder = add_normalisation_parent(arm, "companion_root")

    if arm.animation_data is None:
        arm.animation_data_create()
    prev_action = arm.animation_data.action
    arm.animation_data.action = canonical_action
    arm.data.pose_position = "POSE"
    bpy.context.scene.frame_set(canonical_frame)
    bpy.context.view_layer.update()

    report = {"canonicalPose": "%s@%d" % (canonical_action.name, canonical_frame)}

    for attempt in range(1, 6):
        lo, hi = measure()
        if lo is None:
            log("  WARN no skinned mesh to measure; skipping normalisation")
            arm.animation_data.action = prev_action
            return {}

        height = hi.z - lo.z
        pivot = max(abs((lo.x + hi.x) * 0.5), abs((lo.y + hi.y) * 0.5))
        log("  pass %d: height=%.4f ground=%+.4f pivot=%.4f" % (attempt, height, lo.z, pivot))

        if abs(height - target) < 1e-4 and abs(lo.z) < 1e-4 and pivot < 1e-4:
            break

        k = target / height if height > 1e-9 else 1.0
        holder.scale = tuple(s * k for s in holder.scale)
        bpy.context.view_layer.update()

        lo2, hi2 = measure()
        holder.location = (
            holder.location.x - (lo2.x + hi2.x) * 0.5,
            holder.location.y - (lo2.y + hi2.y) * 0.5,
            holder.location.z - lo2.z,
        )
        bpy.context.view_layer.update()

    lo, hi = measure()

    # Root motion means the character travels during a clip, so the ground line only holds at the
    # canonical frame unless the whole clip keeps the feet planted. Report the worst-case drift
    # across the idle loop so it is a known quantity rather than a surprise on screen.
    drift_lo, drift_hi = lo.z, lo.z
    f0, f1 = int(canonical_action.frame_range[0]), int(canonical_action.frame_range[1])
    for f in range(f0, f1 + 1, max(1, (f1 - f0) // 12)):
        bpy.context.scene.frame_set(f)
        bpy.context.view_layer.update()
        l, _ = measure()
        drift_lo = min(drift_lo, l.z)
        drift_hi = max(drift_hi, l.z)

    bpy.context.scene.frame_set(canonical_frame)
    bpy.context.view_layer.update()

    # Capture the armature's object-level transform in the exact state the measurement converged
    # on, so it can be restored immediately before export.
    #
    # This is needed because only SOME clips animate the armature's object location. The male idle
    # carries root motion, so a consumer playing it overrides whatever rest transform the file
    # holds and the ground line lands correctly by luck. The female idle animates rotation only, so
    # the file's stored transform is what gets used -- and at export time the armature was sitting
    # in a blend of all ten unmuted NLA tracks, which is nobody's pose. That is the entire residual
    # error: 1.75 m tall but floating 18 cm off the floor.
    canonical_basis = arm.matrix_basis.copy()

    arm.animation_data.action = prev_action
    bpy.context.view_layer.update()

    report.update({
        "canonicalBasis": [round(v, 6) for row in canonical_basis for v in row],
        "targetHeight": target,
        "measuredHeight": round(hi.z - lo.z, 5),
        "groundLine": round(lo.z, 5),
        "pivotX": round((lo.x + hi.x) * 0.5, 5),
        "pivotY": round((lo.y + hi.y) * 0.5, 5),
        "idleGroundDrift": [round(drift_lo, 5), round(drift_hi, 5)],
        "normalisedOn": holder.name,
        "holderScale": round(holder.scale.x, 8),
    })
    log("  idle ground drift: %+.4f .. %+.4f" % (drift_lo, drift_hi))
    return report


def build(key, spec):
    log("")
    log("=== %s (%s / %s rig) ===" % (key, spec["label"], spec["rig"]))
    wipe_scene()

    all_clips = spec["clips"] + spec["shared"]
    first_name, first_file, first_frames = all_clips[0]

    base_objs = import_fbx(os.path.join(PACK, first_file))
    arm = find_armature(base_objs)
    if arm is None:
        raise RuntimeError("no armature in %s" % first_file)

    bone_names = {b.name for b in arm.data.bones}
    log("base %-12s bones=%-4d objects=%d" % (first_name, len(bone_names), len(base_objs)))

    # Every action we want to survive to the GLB, keyed by clip name.
    collected = {}

    act = action_of(arm)
    if act is None:
        raise RuntimeError("no action in %s" % first_file)
    act.name = first_name
    collected[first_name] = act

    # Remaining clips: import, steal the action, discard the duplicate geometry.
    for clip_name, file_name, frames in all_clips[1:]:
        path = os.path.join(PACK, file_name)
        if not os.path.exists(path):
            log("MISS %-12s %s" % (clip_name, file_name))
            continue

        objs = import_fbx(path)
        other = find_armature(objs)
        if other is None:
            log("SKIP %-12s no armature" % clip_name)
            for o in objs:
                bpy.data.objects.remove(o, do_unlink=True)
            continue

        other_bones = {b.name for b in other.data.bones}
        shared = bone_names & other_bones
        # A retarget is only honest if the skeletons really are the same rig. The question that
        # matters is "can this action drive every bone of the TARGET" -- so divide by the target's
        # bone count, not the donor's. Measuring it the other way punishes donors that carry extra
        # bones (some clips in this pack ship 29 bones against the base rig's 22, and every one of
        # the 22 matches); those extras simply go undriven, which is harmless.
        coverage = len(shared) / max(1, len(bone_names))
        extra = len(other_bones - bone_names)
        a = action_of(other)

        if a is not None and coverage >= 0.9:
            a.name = clip_name
            collected[clip_name] = a
            # Detach so removing the donor armature does not take the action with it.
            other.animation_data.action = None
            a.use_fake_user = True
            log("take %-12s frames=%-4d covers %d/%d target bones (+%d unused)"
                % (clip_name, frames, len(shared), len(bone_names), extra))
        else:
            why = "no action" if a is None else "covers only %.0f%% of target bones" % (coverage * 100)
            log("DROP %-12s %s (%d/%d target bones matched)"
                % (clip_name, why, len(shared), len(bone_names)))

        for o in objs:
            bpy.data.objects.remove(o, do_unlink=True)

    # -- strip baked root motion ----------------------------------------------------------------
    stripped = strip_root_motion(collected)

    # -- normalise scale, ground line and pivot ------------------------------------------------
    # Normalise against the idle clip: it is the pose the user sees first and the one every camera
    # framing is tuned for. Falling back to whatever clip exists keeps this honest if idle is ever
    # missing, rather than silently measuring the rest pose again.
    canonical = collected.get("idle1") or collected[next(iter(collected))]
    log("normalising against %s:" % canonical.name)
    metrics = normalise(arm, TARGET_HEIGHT, canonical)

    # -- stash actions into NLA tracks ---------------------------------------------------------
    # The glTF exporter's NLA_TRACKS mode emits one glTF animation per track, named after the
    # track. That is the only mode that guarantees all clips ship and keep their names; ACTIONS
    # mode depends on what happens to be assigned when the export runs.
    if arm.animation_data is None:
        arm.animation_data_create()
    arm.animation_data.action = None
    for t in list(arm.animation_data.nla_tracks):
        arm.animation_data.nla_tracks.remove(t)

    clip_meta = []
    fps = bpy.context.scene.render.fps
    for clip_name, act in collected.items():
        track = arm.animation_data.nla_tracks.new()
        track.name = clip_name
        strip = track.strips.new(clip_name, int(act.frame_range[0]), act)
        strip.name = clip_name
        track.mute = False
        clip_meta.append({
            "name": clip_name,
            "frames": int(round(act.frame_range[1] - act.frame_range[0])) + 1,
            "frameStart": int(act.frame_range[0]),
            "frameEnd": int(act.frame_range[1]),
        })

    clip_meta.sort(key=lambda c: c["name"])
    log("tracks=%d" % len(clip_meta))

    # -- export --------------------------------------------------------------------------------
    os.makedirs(OUT_DIR, exist_ok=True)
    out = os.path.join(OUT_DIR, key + ".glb")

    # Export from the canonical frame with the canonical transform restored. The exporter writes
    # each node's CURRENT TRS as its rest transform, and by this point the armature is sitting in a
    # blend of every unmuted NLA track -- a pose that belongs to no clip. Muting the tracks and
    # writing back the basis the measurement converged on is what makes the shipped file match the
    # numbers that were verified.
    bpy.context.scene.frame_set(1)
    if arm.animation_data:
        for t in arm.animation_data.nla_tracks:
            t.mute = True
    if "canonicalBasis" in metrics:
        arm.matrix_basis = Matrix([metrics["canonicalBasis"][i * 4:(i + 1) * 4] for i in range(4)])
    bpy.context.view_layer.update()

    # The exporter needs the tracks live again to emit them as animations.
    if arm.animation_data:
        for t in arm.animation_data.nla_tracks:
            t.mute = False

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format="GLB",
        export_animations=True,
        export_animation_mode="NLA_TRACKS",
        export_nla_strips=True,
        export_bake_animation=False,
        export_optimize_animation_size=True,
        export_force_sampling=False,
        export_apply=False,          # applying modifiers would destroy the armature binding
        export_skins=True,
        export_morph=False,
        export_cameras=False,
        export_lights=False,
        export_yup=True,             # glTF convention; three.js expects Y-up
        export_texture_dir="",
        export_image_format="AUTO",
    )

    size = os.path.getsize(out)
    log("wrote %s  %.1f KB" % (out, size / 1024.0))

    return {
        "id": key,
        "label": spec["label"],
        "rig": spec["rig"],
        "file": "companions/%s.glb" % key,
        "bytes": size,
        "bones": len(bone_names),
        "fps": fps,
        "metrics": metrics,
        "clips": clip_meta,
    }


# --------------------------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------------------------

def main():
    if not os.path.isdir(PACK):
        log("FATAL pack not found: %s" % PACK)
        sys.exit(2)

    results = []
    for key, spec in RIGS.items():
        results.append(build(key, spec))

    manifest = {
        "generatedBy": "tools/rig_to_glb.py",
        "blender": bpy.app.version_string,
        "license": LICENSE,
        "targetHeight": TARGET_HEIGHT,
        "companions": results,
    }
    os.makedirs(OUT_DIR, exist_ok=True)
    mpath = os.path.join(OUT_DIR, "manifest.json")
    with open(mpath, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    log("")
    log("manifest -> %s" % mpath)

    with open(os.path.join(OUT_DIR, "convert.log"), "w", encoding="utf-8") as f:
        f.write("\n".join(log_lines) + "\n")


main()
