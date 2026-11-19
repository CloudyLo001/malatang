"""Cinematic Blender shots for the malatang trailer.

Run:  blender -b -P video/blender_shots.py -- <shot> [<shot> ...]
Shots: fall, lineup, drop, cooked. Each renders 180 frames (6 s @ 30 fps) at 1920x1920 to
video/frames/<shot>/####.png; the square is cropped to 16:9 and 9:16 in the edit.
"""

import math
import os
import random
import sys

import bpy
from mathutils import Euler, Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MINT = os.path.join(ROOT, "public", "assets", "mint")
OUT = os.path.join(ROOT, "video", "frames")
COOKED_GLB = os.path.join(ROOT, "video", "out", "cooked.glb")
FRAMES = 180

SIZES = {
    "bok-choy": 0.125, "broccoli": 0.065, "enoki-mushroom": 0.115, "shiitake-mushroom": 0.055,
    "shrimp": 0.085, "fish-tofu-roll": 0.065, "striped-fish-dumpling": 0.045, "lotus-root-slice": 0.062,
    "mini-sausage": 0.06, "fried-tofu-puff": 0.045, "firm-tofu": 0.06, "fish-ball": 0.036,
    "beef-slice": 0.08, "crab-stick": 0.085, "instant-noodle-block": 0.09, "napa-cabbage": 0.11,
    "pork-belly-slice": 0.085, "snow-peas": 0.08, "hot-pot-bowl": 0.34,
}


# ---------------------------------------------------------------- helpers

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x = sc.render.resolution_y = 1920
    sc.render.fps = 30
    sc.frame_start, sc.frame_end = 1, FRAMES
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGB"
    ee = sc.eevee
    ee.taa_render_samples = 48
    for attr, value in (("use_raytracing", True), ("use_shadows", True), ("use_gtao", True)):
        if hasattr(ee, attr):
            setattr(ee, attr, value)
    if hasattr(ee, "ray_tracing_options"):
        ee.ray_tracing_options.resolution_scale = "2"
    sc.view_settings.view_transform = "AgX"
    looks = [i.identifier for i in sc.view_settings.bl_rna.properties["look"].enum_items]
    for want in ("AgX - Punchy", "AgX - Medium High Contrast"):
        if want in looks:
            sc.view_settings.look = want
            break
    world = bpy.data.worlds.new("world")
    sc.world = world
    world.use_nodes = True
    return sc


def set_world(color, strength):
    nodes = bpy.context.scene.world.node_tree.nodes
    bg = nodes.get("Background")
    bg.inputs[0].default_value = (*color, 1)
    bg.inputs[1].default_value = strength


_cache = {}


def load(key):
    """Import a Mint model once, join it into one mesh scaled to real size, origin at its centre."""
    if key in _cache:
        src = _cache[key]
        dup = src.copy()
        bpy.context.scene.collection.objects.link(dup)
        return dup
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(MINT, key, "optimized_glb.glb"))
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == "MESH"]
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for o in new:
        if o != obj and o.name in bpy.data.objects:
            bpy.data.objects.remove(o, do_unlink=True)
    pts = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    dims = hi - lo
    s = SIZES.get(key, 0.07) / max(dims)
    obj.data.transform(Matrix.Translation(-(lo + hi) / 2))
    obj.data.transform(Matrix.Scale(s, 4))
    obj.location = (0, 0, 0)
    obj.name = key
    for poly in obj.data.polygons:
        poly.use_smooth = True
    _cache[key] = obj
    return obj


def lay_flat(obj):
    """Rotate so the thinnest bounding dimension is vertical."""
    d = obj.dimensions
    axis = min(range(3), key=lambda i: d[i])
    if axis == 0:
        obj.rotation_euler = Euler((0, math.pi / 2, 0))
    elif axis == 1:
        obj.rotation_euler = Euler((math.pi / 2, 0, 0))


def half_height(obj):
    bpy.context.view_layer.update()
    pts = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    return (max(p.z for p in pts) - min(p.z for p in pts)) / 2


def area(name, loc, target, energy, size, color=(1, 0.93, 0.85)):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.size = size
    data.color = color
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = loc
    obj.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    return obj


def camera(lens=50, fstop=2.8):
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    cam.data.lens = lens
    cam.data.sensor_width = 36
    cam.data.clip_start = 0.005
    cam.data.dof.use_dof = True
    cam.data.dof.aperture_fstop = fstop
    return cam


def aim(cam, loc, target, frame=None):
    cam.location = loc
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    if frame is not None:
        cam.keyframe_insert("location", frame=frame)
        cam.keyframe_insert("rotation_euler", frame=frame)


def focus_empty(loc):
    e = bpy.data.objects.new("focus", None)
    bpy.context.scene.collection.objects.link(e)
    e.location = loc
    bpy.context.scene.camera.data.dof.focus_object = e
    return e


def material(name, color, metallic=0.0, roughness=0.5):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (*color, 1)
    p.inputs["Metallic"].default_value = metallic
    p.inputs["Roughness"].default_value = roughness
    return m


def plane(name, size, z, mat):
    bpy.ops.mesh.primitive_plane_add(size=size, location=(0, 0, z))
    obj = bpy.context.active_object
    obj.name = name
    obj.data.materials.append(mat)
    return obj


def wood_material():
    m = bpy.data.materials.new("wood")
    m.use_nodes = True
    nt = m.node_tree
    p = nt.nodes["Principled BSDF"]
    p.inputs["Roughness"].default_value = 0.45
    wave = nt.nodes.new("ShaderNodeTexWave")
    wave.inputs["Scale"].default_value = 3.0
    wave.inputs["Distortion"].default_value = 6.0
    wave.inputs["Detail"].default_value = 4.0
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.035, 0.014, 0.006, 1)
    ramp.color_ramp.elements[1].color = (0.09, 0.04, 0.018, 1)
    mapping = nt.nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (2, 0.25, 1)
    coord = nt.nodes.new("ShaderNodeTexCoord")
    nt.links.new(coord.outputs["Object"], mapping.inputs["Vector"])
    nt.links.new(mapping.outputs["Vector"], wave.inputs["Vector"])
    nt.links.new(wave.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], p.inputs["Base Color"])
    return m


def reflection_card(loc, strength):
    """A bright card outside the shot for metals to reflect."""
    card = plane("card", 0.9, 0, bpy.data.materials.new("emit"))
    m = card.data.materials[0]
    m.use_nodes = True
    em = m.node_tree.nodes.new("ShaderNodeEmission")
    em.inputs["Strength"].default_value = strength
    m.node_tree.links.new(em.outputs[0], m.node_tree.nodes["Material Output"].inputs["Surface"])
    card.location = loc
    card.rotation_euler = (Vector((0, 0, 0.05)) - Vector(loc)).to_track_quat("Z", "Y").to_euler()
    return card


def smooth_keys(obj):
    if obj.animation_data and obj.animation_data.action:
        action = obj.animation_data.action
        curves = []
        if hasattr(action, "fcurves"):
            curves = list(action.fcurves)
        else:  # layered actions (Blender 4.4+)
            for layer in action.layers:
                for strip in layer.strips:
                    for bag in strip.channelbags:
                        curves.extend(bag.fcurves)
        for fc in curves:
            for kp in fc.keyframe_points:
                kp.interpolation = "BEZIER"
                kp.handle_left_type = kp.handle_right_type = "AUTO_CLAMPED"


def linear_keys(obj):
    if obj.animation_data and obj.animation_data.action:
        action = obj.animation_data.action
        curves = list(action.fcurves) if hasattr(action, "fcurves") else [
            c for layer in action.layers for strip in layer.strips for bag in strip.channelbags for c in bag.fcurves]
        for fc in curves:
            for kp in fc.keyframe_points:
                kp.interpolation = "LINEAR"


# ---------------------------------------------------------------- shots

def shot_fall():
    """Title: ingredients tumbling in slow motion through a dark, warm-lit void."""
    sc = reset()
    set_world((0.02, 0.012, 0.01), 1.0)
    random.seed(7)
    keys = ["shrimp", "bok-choy", "fish-ball", "broccoli", "enoki-mushroom", "beef-slice", "fried-tofu-puff",
            "striped-fish-dumpling", "lotus-root-slice", "mini-sausage", "shiitake-mushroom", "fish-tofu-roll",
            "shrimp", "crab-stick", "snow-peas", "fish-ball"]
    keys = keys + keys + keys[:6]
    random.shuffle(keys)
    cols = [-0.19, -0.13, -0.075, -0.025, 0.025, 0.075, 0.13, 0.19]
    for i, key in enumerate(keys):
        obj = load(key)
        x = cols[i % len(cols)] + random.uniform(-0.02, 0.02)
        y = random.uniform(-0.1, 0.14)
        speed = random.uniform(0.0026, 0.0036)  # metres per frame: slow motion
        start_z = -0.12 + (i / len(keys)) * 0.9 + random.uniform(-0.04, 0.04)
        r0 = Euler([random.uniform(0, math.tau) for _ in range(3)])
        spin = Vector([random.uniform(-0.03, 0.03) for _ in range(3)])
        for f in (1, FRAMES):
            obj.location = (x, y, start_z - speed * (f - 1))
            obj.rotation_euler = Euler([r0[a] + spin[a] * (f - 1) for a in range(3)])
            obj.keyframe_insert("location", frame=f)
            obj.keyframe_insert("rotation_euler", frame=f)
        linear_keys(obj)
    cam = camera(lens=45, fstop=2.0)
    aim(cam, (0, -0.62, 0.03), (0, 0, 0.0), frame=1)
    aim(cam, (0, -0.55, 0.02), (0, 0, 0.0), frame=FRAMES)
    focus_empty((0, 0.0, 0))
    area("key", (0.6, -0.5, 0.8), (0, 0, 0), 120, 0.8)
    area("rim", (-0.5, 0.6, 0.4), (0, 0, 0), 160, 0.6, (1.0, 0.55, 0.3))
    area("fill", (-0.7, -0.6, -0.2), (0, 0, 0), 25, 1.0, (0.7, 0.8, 1.0))
    return sc


def shot_lineup():
    """Macro dolly along a row of raw ingredients on brushed steel."""
    sc = reset()
    set_world((0.02, 0.016, 0.014), 0.5)
    sc.view_settings.exposure = -0.6
    steel = material("steel", (0.55, 0.55, 0.54), metallic=1.0, roughness=0.33)
    plane("tray", 3, 0, steel)
    back = plane("back", 3, 0, material("back", (0.006, 0.005, 0.005), roughness=0.9))
    back.location = (0, 0.6, 0.4)
    back.rotation_euler = (math.pi / 2, 0, 0)
    keys = ["bok-choy", "shrimp", "enoki-mushroom", "beef-slice", "fish-ball", "broccoli", "lotus-root-slice",
            "fried-tofu-puff", "shiitake-mushroom", "striped-fish-dumpling", "mini-sausage", "crab-stick"]
    random.seed(3)
    x = -0.55
    for key in keys:
        obj = load(key)
        lay_flat(obj)
        obj.rotation_euler.z += random.uniform(-0.5, 0.5)
        obj.location = (x, random.uniform(-0.02, 0.03), 0)
        obj.location.z = half_height(obj)
        x += SIZES[key] * 0.75 + 0.03
    end = x
    cam = camera(lens=60, fstop=1.8)
    start_x, end_x = -0.5, end - 0.1
    for f, cx in ((1, start_x), (FRAMES, end_x)):
        aim(cam, (cx, -0.32, 0.12), (cx + 0.05, 0, 0.02), frame=f)
    linear_keys(cam)
    focus = focus_empty((start_x + 0.05, 0, 0.02))
    focus.keyframe_insert("location", frame=1)
    focus.location = (end_x + 0.05, 0, 0.02)
    focus.keyframe_insert("location", frame=FRAMES)
    linear_keys(focus)
    area("key", (0.2, -0.6, 0.7), (0, 0, 0), 22, 1.2)
    area("rim", (0.0, 0.5, 0.3), (0, 0, 0), 45, 2.5, (1.0, 0.62, 0.38))
    area("softbox", (0.0, -0.2, 0.9), (0, 0, 0), 10, 1.5)
    return sc


def shot_drop():
    """Low close-up: pieces dropping one by one into the steel hot-pot bowl."""
    sc = reset()
    set_world((0.03, 0.02, 0.015), 0.6)
    sc.view_settings.exposure = -0.5
    plane("counter", 4, 0, wood_material())
    reflection_card((0.0, 0.7, 0.6), 4.0)
    bowl = load("hot-pot-bowl")
    bowl.location.z = half_height(bowl)
    inner = 0.135
    random.seed(11)
    keys = ["shrimp", "fish-ball", "bok-choy", "broccoli", "fish-ball", "beef-slice", "mini-sausage",
            "fried-tofu-puff", "shrimp", "striped-fish-dumpling", "enoki-mushroom", "lotus-root-slice",
            "shiitake-mushroom", "fish-tofu-roll"]
    level = 0.03
    for i, key in enumerate(keys):
        obj = load(key)
        lay_flat(obj)
        base_rot = obj.rotation_euler.copy()
        r = random.uniform(0, inner * 0.6)
        a = random.uniform(0, math.tau)
        hh = half_height(obj)
        rest = Vector((math.cos(a) * r, math.sin(a) * r, level + hh))
        level += 0.006
        land = 8 + i * 11
        top = rest + Vector((random.uniform(-0.03, 0.03), random.uniform(-0.03, 0.03), 0.45))
        spin = Euler((base_rot.x + random.uniform(-1, 1), base_rot.y + random.uniform(-1, 1), random.uniform(0, math.tau)))
        rest_rot = Euler((base_rot.x + random.uniform(-0.2, 0.2), base_rot.y + random.uniform(-0.2, 0.2), spin.z + 0.6))
        # Hidden above frame until its drop, then falls, bounces once and settles.
        for f, loc, rot in ((1, top, spin), (land - 9, top, spin), (land, rest, rest_rot),
                            (land + 3, rest + Vector((0, 0, 0.012)), rest_rot), (land + 6, rest, rest_rot)):
            obj.location = loc
            obj.rotation_euler = rot
            obj.keyframe_insert("location", frame=max(1, f))
            obj.keyframe_insert("rotation_euler", frame=max(1, f))
        smooth_keys(obj)
    cam = camera(lens=40, fstop=2.4)
    aim(cam, (0.17, -0.3, 0.44), (0, 0.01, 0.05), frame=1)
    aim(cam, (0.1, -0.24, 0.37), (0, 0.01, 0.05), frame=FRAMES)
    smooth_keys(cam)
    focus_empty((0, 0, 0.06))
    area("key", (0.4, -0.3, 0.8), (0, 0, 0.05), 70, 0.9)
    area("rim", (-0.4, 0.5, 0.4), (0, 0, 0.05), 90, 0.8, (1.0, 0.6, 0.35))
    area("fill", (-0.6, -0.6, 0.3), (0, 0, 0.05), 15, 1.2, (0.75, 0.85, 1.0))
    return sc


def shot_cooked():
    """Hero orbit around the finished bowl exported from the game."""
    sc = reset()
    set_world((0.03, 0.02, 0.015), 0.9)
    plane("counter", 4, 0, wood_material())
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=COOKED_GLB)
    new = [o for o in bpy.data.objects if o not in before]
    for o in new:
        if o.type != "MESH":
            continue
        for slot in o.material_slots:
            m = slot.material
            if not m:
                continue
            # The game's broth is translucent; in a still render an opaque glossy surface reads better.
            if o.name.startswith("soup") and m.use_nodes:
                p = m.node_tree.nodes.get("Principled BSDF")
                if p:
                    for link in list(p.inputs["Alpha"].links):
                        m.node_tree.links.remove(link)
                    p.inputs["Alpha"].default_value = 1.0
                    p.inputs["Roughness"].default_value = 0.08
                    if "Coat Weight" in p.inputs:
                        p.inputs["Coat Weight"].default_value = 0.6
                if hasattr(m, "surface_render_method"):
                    m.surface_render_method = "DITHERED"
                if hasattr(m, "blend_method"):
                    m.blend_method = "OPAQUE"
    root = bpy.data.objects.new("pot", None)
    sc.collection.objects.link(root)
    for o in new:
        if o.parent is None:
            o.parent = root
    # The pot spins slowly while the camera arcs around it.
    root.rotation_euler = (0, 0, 0)
    root.keyframe_insert("rotation_euler", frame=1)
    root.rotation_euler = (0, 0, math.radians(-25))
    root.keyframe_insert("rotation_euler", frame=FRAMES)
    linear_keys(root)
    cam = camera(lens=42, fstop=2.2)
    for f, ang, dist, h in ((1, -70, 0.52, 0.36), (FRAMES, -110, 0.44, 0.3)):
        a = math.radians(ang)
        aim(cam, (math.cos(a) * dist, math.sin(a) * dist, h), (0, 0, 0.055), frame=f)
    smooth_keys(cam)
    focus_empty((0, 0, 0.07))
    area("key", (0.35, -0.35, 0.9), (0, 0, 0.05), 90, 0.6)
    area("rim", (-0.45, 0.5, 0.45), (0, 0, 0.05), 140, 0.8, (1.0, 0.62, 0.35))
    area("fill", (-0.6, -0.5, 0.35), (0, 0, 0.05), 15, 1.4, (0.75, 0.85, 1.0))
    sc.view_settings.exposure = -1.1
    reflection_card((0.0, 0.8, 0.55), 2.0)
    return sc


SHOTS = {"fall": shot_fall, "lineup": shot_lineup, "drop": shot_drop, "cooked": shot_cooked}


def main():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else list(SHOTS)
    preview = "--preview" in args
    for name in [a for a in args if a in SHOTS]:
        _cache.clear()
        sc = SHOTS[name]()
        out = os.path.join(OUT, name)
        os.makedirs(out, exist_ok=True)
        if preview:
            for f in (1, FRAMES // 2, FRAMES):
                sc.frame_set(f)
                sc.render.filepath = os.path.join(ROOT, "video", "out", f"preview_{name}_{f:03d}.png")
                sc.eevee.taa_render_samples = 16
                bpy.ops.render.render(write_still=True)
        else:
            sc.render.filepath = os.path.join(out, "")
            bpy.ops.render.render(animation=True)
        print("DONE", name, flush=True)


main()
