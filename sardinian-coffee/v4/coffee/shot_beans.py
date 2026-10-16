"""Shot 1: roasted beans poured into the grinder's dosing funnel, in slow motion against the cafe.

Physics (Bullet, through Blender rigid bodies): every bean is a convex-hull rigid body with its real mass (envelope
density 0.65 g/cm^3, 0.12-0.16 g a bean) and inertia from its shape, so it tumbles freely in the air (torque-free
precession of an asymmetric body) and bounces off the polished steel funnel and off the other beans with measured
coefficients (bean on steel friction 0.8 x 0.35, restitution 0.5 x 0.6). Poured from a bag ~15 cm above the funnel,
beans leave at 1-1.4 m/s spinning at 5-20 rev/s. The world runs at time scale 0.08 (the look of 750 fps footage),
20 sub-steps per frame and 30 solver iterations. The result is baked to keyframes.
"""
import math

import bpy
import numpy as np
from mathutils import Quaternion, Vector

from . import bean as B
from . import common as C
from . import materials as M
from . import props as P
from . import stage as S

NAME = 'beans'
SLOWMO = 0.08
DENSITY = 0.65
N_BEANS = 22
FUNNEL_Z = -4.2              # rim of the dosing funnel
FUNNEL = [(1.25, -9.5), (1.25, -7.2), (1.6, -6.8), (4.2, FUNNEL_Z - 0.05), (4.4, FUNNEL_Z + 0.08), (4.55, FUNNEL_Z + 0.05),
          (4.5, FUNNEL_Z - 0.12), (4.1, FUNNEL_Z - 0.2), (1.45, -6.95), (1.4, -7.2), (1.4, -9.5)]


def _volume(me):
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(me)
    v = bm.calc_volume()
    bm.free()
    return abs(v)


def _rb(scene, ob, kind, shape, mass=1.0, friction=0.5, restitution=0.3, margin=0.004):
    with bpy.context.temp_override(scene=scene, object=ob, active_object=ob, selected_objects=[ob], selected_editable_objects=[ob]):
        bpy.ops.rigidbody.object_add(type=kind)
    rb = ob.rigid_body
    rb.collision_shape = shape
    rb.mass = mass
    rb.friction = friction
    rb.restitution = restitution
    rb.use_margin = True
    rb.collision_margin = margin
    rb.mesh_source = 'FINAL'
    rb.use_deactivation = False
    rb.linear_damping = 0.01           # air drag on a bean at 1.2 m/s: ~2 % of its weight
    rb.angular_damping = 0.02


def _launch(scene, ob, p0, q0, v0, w0):
    """Kinematic for the first frames so Bullet picks up the initial linear and angular velocity, then free."""
    f0 = scene.frame_start
    dt = SLOWMO / C.FPS
    for i, f in enumerate((f0, f0 + 1, f0 + 2)):
        t = i * dt
        ob.location = p0 + v0 * t + Vector((0, 0, -0.5 * C.GRAVITY * t * t))
        ob.rotation_quaternion = (Quaternion(w0.normalized(), w0.length * t) @ q0) if w0.length > 0 else q0
        ob.rigid_body.kinematic = True
        for path in ('location', 'rotation_quaternion'):
            ob.keyframe_insert(path, frame=f)
        ob.rigid_body.keyframe_insert('kinematic', frame=f)
    ob.rigid_body.kinematic = False
    ob.rigid_body.keyframe_insert('kinematic', frame=f0 + 3)


def _funnel(col):
    ob = P.lathe_obj('dosing_funnel', FUNNEL, col, M.get('steel'), 192)
    return ob


# ------------------------------------------------------------------ camera, lights
CAM = [(0.0, (1.2, -19.0, 3.4), (0.2, 0.0, 1.6)), (0.55, (0.8, -18.2, 1.6), (0.1, 0.0, -0.4)), (1.0, (0.4, -17.2, -0.4), (0.0, 0.0, -3.4))]
HERO = 0


def _cam_sampler(hero_track):
    def cam(t):
        pos = C.hermite([(k[0], k[1]) for k in CAM], t)
        tgt = C.hermite([(k[0], k[2]) for k in CAM], t)
        shake = np.array([C.noise1(t * 1.4, 71), C.noise1(t * 1.4, 72), C.noise1(t * 1.4, 73)]) * 0.04
        hero = np.array(hero_track(t))
        return dict(pos=pos + shake, target=tgt, roll=0.02 * math.sin(t * 1.7), fov=C.lerp(30, 28, C.smooth(0, 1, t)),
                    focus=float(np.linalg.norm(pos - hero)), fstop=11.0)
    return cam


def _lights(scene):
    key = S.area_light(scene, 'b_key', 14.0, 1.1, (1.0, 0.9, 0.78), size_y=10.0)
    key.location = (-16.0, -14.0, 14.0)
    S.aim(key, (0.0, 0.0, 0.0))
    rim = S.area_light(scene, 'b_rim', 4.0, 1.6, (1.0, 0.72, 0.45), size_y=18.0)
    rim.location = (12.0, 10.0, 4.0)
    S.aim(rim, (0.0, 0.0, 0.0))
    back = S.area_light(scene, 'b_back', 6.0, 0.6, (1.0, 0.8, 0.6), size_y=6.0)
    back.location = (-8.0, 12.0, -2.0)
    S.aim(back, (0.0, 0.0, 0.0))
    fill = S.area_light(scene, 'b_fill', 10.0, 0.15, (0.9, 0.93, 1.0))
    fill.location = (10.0, -16.0, -4.0)
    S.aim(fill, (0.0, 0.0, 0.0))
    for ob in (key, rim, back, fill):
        ob.visible_camera = False


# ------------------------------------------------------------------ build
def build(scene):
    col = scene.collection
    rng = np.random.default_rng(3)
    funnel = _funnel(col)
    with bpy.context.temp_override(scene=scene):
        bpy.ops.rigidbody.world_add()
    rbw = scene.rigidbody_world
    rbw.collection = bpy.data.collections.new('rb_beans')
    rbw.substeps_per_frame = 20
    rbw.solver_iterations = 30
    rbw.time_scale = SLOWMO
    rbw.use_split_impulse = True
    rbw.point_cache.frame_start = scene.frame_start
    rbw.point_cache.frame_end = scene.frame_end + 2
    _rb(scene, funnel, 'PASSIVE', 'MESH', friction=0.35, restitution=0.6, margin=0.002)
    beans = []
    mats = (M.get('bean'), M.get('bean_inner'))
    for k in range(N_BEANS):
        me = B.bean_mesh(f'pour_bean{k}', 300 + k, 40)
        for m in mats:
            me.materials.append(m)
        ob = C.obj_new(f'pour_bean{k}', me, col)
        s = 0.92 + 0.16 * rng.random()
        ob.scale = (s, s, s)
        ob.rotation_mode = 'QUATERNION'
        mass = _volume(me) * s ** 3 * DENSITY
        _rb(scene, ob, 'ACTIVE', 'CONVEX_HULL', mass=mass, friction=0.8, restitution=0.5, margin=0.003)
        if k == HERO:
            # the hero crosses the frame close to the lens, slowly turning
            p0 = Vector((-0.9, -5.0, 6.8))
            v0 = Vector((0.6, 0.0, -95.0))
            w0 = Vector((0.3, 1.0, 0.2)).normalized() * (2 * math.pi * 6)
        else:
            p0 = Vector((rng.normal(0.25, 1.1), rng.normal(0.0, 1.3), -1.5 + 17.0 * k / N_BEANS + rng.random() * 0.8))
            v0 = Vector((rng.normal(0, 4), rng.normal(0, 4), -100 - 40 * rng.random()))
            w0 = Vector(rng.normal(size=3)).normalized() * (2 * math.pi * (5 + 15 * rng.random()))
        q0 = Quaternion(Vector(rng.normal(size=3)).normalized(), rng.random() * 6.28)
        _launch(scene, ob, p0, q0, v0, w0)
        beans.append(ob)
    rec = {o.name: [] for o in beans}
    for f in range(scene.frame_start, scene.frame_end + 3):
        scene.frame_set(f)
        for o in beans:
            rec[o.name].append(o.matrix_world.copy())
    rbw.enabled = False
    for o in beans:
        o.rigid_body.enabled = False
        if o.animation_data:
            o.animation_data_clear()
        for i, m in enumerate(rec[o.name]):
            loc, rot, sc = m.decompose()
            o.location, o.rotation_quaternion, o.scale = loc, rot, sc
            for path in ('location', 'rotation_quaternion', 'scale'):
                o.keyframe_insert(path, frame=scene.frame_start + i)
        C.set_interpolation(o, 'LINEAR')
    hero_pos = [tuple(m.to_translation()) for m in rec[beans[HERO].name]]

    def hero_track(t):
        x = (t * C.FPS + 1) - scene.frame_start
        i = int(np.clip(math.floor(x), 0, len(hero_pos) - 2))
        u = C.clamp(x - i)
        return tuple(np.array(hero_pos[i]) * (1 - u) + np.array(hero_pos[i + 1]) * u)

    _lights(scene)
    S.make_camera(scene, 'cam_beans', _cam_sampler(hero_track))
    S.key_world(scene.world, lambda t: (0.9 + 0.1 * t, 0.35, 0.4), range(scene.frame_start - 1, scene.frame_end + 2))
    attach(scene)


def attach(scene):
    """Everything is keyframed; nothing to update per frame."""
