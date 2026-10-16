"""Scene, world, camera and render settings shared by all shots (Cycles path tracing)."""
import math

import bpy
from mathutils import Vector

from . import common as C

HDRI = {'exr': C.ASSETS / 'comfy_cafe_4k.exr', 'hdr': C.V3_ASSETS / 'comfy_cafe_2k.hdr'}


def hdri_path():
    return HDRI['exr'] if HDRI['exr'].exists() else HDRI['hdr']


def _maybe(target, **props):
    """Set properties that may not exist in every Blender version."""
    for k, v in props.items():
        if hasattr(target, k):
            setattr(target, k, v)


def configure_render(scene, final=True):
    """Path tracing settings required by the brief: Cycles, >= 12 total bounces with >= 4 glossy/transmission,
    refractive and reflective caustics, real motion blur with a 180 degree shutter, AgX view on an ACEScg working space."""
    r, cy = scene.render, scene.cycles
    r.engine = 'CYCLES'
    r.resolution_x, r.resolution_y, r.resolution_percentage = C.WIDTH, C.HEIGHT, 100
    r.fps, r.fps_base = C.FPS, 1.0
    r.use_motion_blur = True
    r.motion_blur_shutter = 0.5
    r.motion_blur_position = 'CENTER'
    r.use_persistent_data = True
    r.film_transparent = False
    r.image_settings.file_format = 'PNG'
    r.image_settings.color_depth = '16'
    r.image_settings.color_mode = 'RGB'
    r.image_settings.compression = 15
    r.use_overwrite = False
    r.use_placeholder = True
    cy.device = 'GPU'
    cy.samples = 384 if final else 32
    cy.use_adaptive_sampling = True
    cy.adaptive_threshold = 0.008 if final else 0.05
    cy.adaptive_min_samples = 64 if final else 8
    cy.use_denoising = True
    cy.denoiser = 'OPENIMAGEDENOISE'
    cy.denoising_input_passes = 'RGB_ALBEDO_NORMAL'
    cy.denoising_prefilter = 'ACCURATE'
    cy.denoising_quality = 'HIGH'
    cy.max_bounces = 16
    cy.diffuse_bounces = 6
    cy.glossy_bounces = 8
    cy.transmission_bounces = 12
    cy.volume_bounces = 4
    cy.transparent_max_bounces = 24
    cy.caustics_reflective = True
    cy.caustics_refractive = True
    cy.blur_glossy = 0.2            # only a touch of filter: keeps refractive caustics sharp but tames fireflies
    cy.sample_clamp_direct = 0.0
    cy.sample_clamp_indirect = 20.0
    _maybe(cy, light_sampling_threshold=0.01, use_light_tree=True, pixel_filter_type='BLACKMAN_HARRIS', filter_width=1.5,
           volume_step_rate=1.0, volume_max_steps=1024)
    # colour: AgX view (the ACEScg working space is set once for the whole file, see use_acescg)
    vs = scene.view_settings
    vs.view_transform = 'AgX'
    vs.look = 'AgX - Base Contrast'
    vs.exposure = 0.0
    vs.gamma = 1.0
    scene.display_settings.display_device = 'sRGB'
    # physics in centimetres
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 0.01
    scene.unit_settings.length_unit = 'CENTIMETERS'
    scene.gravity = (0.0, 0.0, -C.GRAVITY)


def use_acescg():
    """Switch the file to an ACEScg working space, converting every colour authored in linear Rec.709."""
    if bpy.data.colorspace.working_space != 'ACEScg':
        bpy.ops.wm.set_working_color_space(working_space='ACEScg', convert_colors=True)


def configure_device(prefer=('OPTIX', 'METAL', 'HIP', 'ONEAPI', 'CUDA')):
    """OptiX on NVIDIA, Metal on Apple silicon, otherwise whatever GPU is there; CPU as last resort."""
    prefs = bpy.context.preferences.addons['cycles'].preferences
    available = [t[0] for t in prefs.get_device_types(bpy.context)]
    for kind in prefer:
        if kind not in available:
            continue
        prefs.compute_device_type = kind
        prefs.get_devices()
        devs = [d for d in prefs.devices if d.type == kind]
        if devs:
            for d in prefs.devices:
                d.use = d.type == kind
            return kind, [d.name for d in devs]
    prefs.compute_device_type = 'NONE'
    for sc in bpy.data.scenes:
        sc.cycles.device = 'CPU'
    return 'CPU', []


def new_world(name, strength=1.0):
    w = bpy.data.worlds.new(name)
    nt = w.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputWorld')
    bg = nt.nodes.new('ShaderNodeBackground')
    env = nt.nodes.new('ShaderNodeTexEnvironment')
    env.image = bpy.data.images.load(str(hdri_path()), check_existing=True)
    env.image.colorspace_settings.name = 'Linear Rec.709'
    env.interpolation = 'Cubic'
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.name = 'rot'
    tc = nt.nodes.new('ShaderNodeTexCoord')
    # camera rays see a dimmer, warmer room than the light it casts (keeps the background a soft bokeh)
    lp = nt.nodes.new('ShaderNodeLightPath')
    cam_bg = nt.nodes.new('ShaderNodeBackground')
    cam_bg.name = 'cam_bg'
    tint = nt.nodes.new('ShaderNodeMix')
    tint.data_type = 'RGBA'
    tint.blend_type = 'MULTIPLY'
    tint.inputs[0].default_value = 1.0
    tint.inputs[7].default_value = (1.0, 0.78, 0.6, 1.0)
    mix = nt.nodes.new('ShaderNodeMixShader')
    L = nt.links.new
    L(tc.outputs['Generated'], mp.inputs['Vector'])
    L(mp.outputs[0], env.inputs['Vector'])
    L(env.outputs['Color'], bg.inputs['Color'])
    L(env.outputs['Color'], tint.inputs[6])
    L(tint.outputs[2], cam_bg.inputs['Color'])
    L(lp.outputs['Is Camera Ray'], mix.inputs[0])
    L(bg.outputs[0], mix.inputs[1])
    L(cam_bg.outputs[0], mix.inputs[2])
    L(mix.outputs[0], out.inputs['Surface'])
    bg.inputs['Strength'].default_value = strength
    cam_bg.inputs['Strength'].default_value = strength * 0.35
    bg.name = 'light_bg'
    return w


def key_world(world, sampler, frames):
    """sampler(t) -> (rotation_z_radians, light_strength, camera_strength)."""
    nt = world.node_tree
    mp, bg, cb = nt.nodes['rot'], nt.nodes['light_bg'], nt.nodes['cam_bg']
    for f in frames:
        rz, ls, cs = sampler(C.time_of(f))
        mp.inputs['Rotation'].default_value = (0.0, 0.0, rz)
        bg.inputs['Strength'].default_value = ls
        cb.inputs['Strength'].default_value = cs
        mp.inputs['Rotation'].keyframe_insert('default_value', frame=f)
        bg.inputs['Strength'].keyframe_insert('default_value', frame=f)
        cb.inputs['Strength'].keyframe_insert('default_value', frame=f)
    C.set_interpolation(nt, 'LINEAR')


def new_scene(name):
    """A shot = a Blender scene covering its frame range of the global timeline."""
    sc = bpy.data.scenes.new(name)
    a, b = C.shot_range(name)
    sc.frame_start, sc.frame_end = a, b
    configure_render(sc)
    sc.world = new_world(f'world_{name}')
    return sc


# The scene is modelled in centimetres (scale_length 0.01). Cycles sizes the aperture and light falloff in
# Blender units, so real-world optics and wattages are converted here: an f/5.6 lens at 1 BU = 1 cm needs
# aperture_fstop 0.056, and a 50 W lamp at 30 cm needs 50 * 1e4 "Blender watts" to light like it does at 0.3 m.
UNIT = 0.01


def real_watts(w):
    return w / (UNIT * UNIT)


def make_camera(scene, name, sampler, sensor=36.0):
    """sampler(t) -> dict(pos, target, roll, fov (vertical, degrees), focus (cm), fstop (real f-number)).
    Keyed on every frame plus one frame either side for the motion blur shutter."""
    cam = bpy.data.cameras.new(name)
    cam.sensor_fit = 'VERTICAL'
    cam.sensor_height = sensor
    cam.sensor_width = sensor * C.WIDTH / C.HEIGHT
    cam.clip_start = 0.5
    cam.clip_end = 5000.0
    cam.dof.use_dof = True
    cam.dof.aperture_blades = 9
    cam.dof.aperture_rotation = math.radians(10)
    ob = C.obj_new(name, cam, scene.collection)
    ob.rotation_mode = 'QUATERNION'
    scene.camera = ob
    a, b = scene.frame_start, scene.frame_end
    for f in range(a - 1, b + 2):
        s = sampler(C.time_of(f))
        ob.location = Vector(s['pos'])
        ob.rotation_quaternion = C.look_at_quaternion(s['pos'], s['target'], s.get('roll', 0.0))
        cam.lens = C.fov_to_lens(s['fov'], sensor)
        cam.dof.focus_distance = s['focus']
        cam.dof.aperture_fstop = s['fstop'] * UNIT
        ob.keyframe_insert('location', frame=f)
        ob.keyframe_insert('rotation_quaternion', frame=f)
        cam.keyframe_insert('lens', frame=f)
        cam.dof.keyframe_insert('focus_distance', frame=f)
        cam.dof.keyframe_insert('aperture_fstop', frame=f)
    C.set_interpolation(ob, 'LINEAR')
    C.set_interpolation(cam, 'LINEAR')
    return ob


def area_light(scene, name, size, power, color=(1.0, 0.92, 0.84), shape='RECTANGLE', size_y=None, spread=180.0):
    """power in real watts (converted for the centimetre scene)."""
    ld = bpy.data.lights.new(name, 'AREA')
    ld.shape = shape
    ld.size = size
    if size_y is not None:
        ld.size_y = size_y
    ld.energy = real_watts(power)
    ld.color = color
    ld.spread = math.radians(spread)
    return C.obj_new(name, ld, scene.collection)


def point_light(scene, name, power, color=(1.0, 0.9, 0.8), radius=0.5):
    """power in real watts (converted for the centimetre scene)."""
    ld = bpy.data.lights.new(name, 'POINT')
    ld.energy = real_watts(power)
    ld.color = color
    ld.shadow_soft_size = radius
    return C.obj_new(name, ld, scene.collection)


def aim(ob, target):
    ob.rotation_mode = 'QUATERNION'
    ob.rotation_quaternion = C.look_at_quaternion(ob.location, target)
