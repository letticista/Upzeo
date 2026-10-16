"""Shot 2: flat burrs like the Ceado E6C (64 mm OGX64, Opalglide coating), beans shattering in slow motion.

Physics (Bullet, through Blender rigid bodies): the lower burr and its carrier turn at 1480 rpm as an animated
(kinematic) body; the upper burr is fixed. Each bean is pre-fractured into Voronoi shards held together by breakable
fixed constraints, so it cracks where the breaker teeth actually hit it. The world runs at time scale 0.06 (the look
of 1000 fps footage, 8.9 degrees of burr rotation per frame) with 20 sub-steps per frame and 30 solver iterations,
gravity 981 cm/s^2, real bean mass (0.62 g/cm^3) and friction. Shards that reach the outer cutting zone are ground
to powder: they vanish while grains are thrown out of the burr gap. The simulation is baked to keyframes, the
powder is a closed-form ballistic system evaluated at every (sub)frame.

Burr geometry from Ceado's OGX64 renders and comparable 64 mm burrs: OD 64 mm, bore 38.8 mm, 8.5 mm thick,
smooth entry bevel r 19.4-22.5 mm, 48 swept asymmetric V grooves (45 degrees from radial) from r 22.5 to 31.5 mm,
thin parallel land at the rim, 3 counterbored screws on a 48.2 mm pitch circle. The upper burr has 44 teeth,
mirrored, so the edges cross like scissors.
"""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

from . import bean as B
from . import common as C
from . import gn
from . import materials as M
from . import stage as S

NAME = 'burrs'
RPM = 1480.0
SLOWMO = 0.06                  # world time scale: 1 s of screen = 0.06 s of real time
R_IN, R_BEV, R_TEETH, R_OUT, THICK = 1.94, 2.25, 3.15, 3.2, 0.85
BEVEL_DROP = 0.15
GAP = 0.06                     # land-to-land gap (opened from the real ~0.025 cm so the contacts stay stable)
DENSITY = 0.65                 # g/cm^3, roasted bean envelope density (measured 0.62-0.75)
N_BEANS = 12
BREAK_IMPULSE = 0.3           # glue breaking threshold: impulse per sub-step (g*cm/s); tuned so beans stay whole in flight
                               # and crack on the breaker teeth (measured crushing force 30-50 N)
# the upper burr is cut away towards the camera (which looks along +y): keep world angles -20..200 degrees. The burr is
# flipped about X, which maps a local angle a to -a, so the local sector runs from 160 to 380 degrees.
UPPER_SECTOR = (math.radians(160), math.radians(20))


def real_time(t):
    return (t - C.T['burrs']) * SLOWMO


def burr_angle(t):
    return -2 * math.pi * RPM / 60.0 * real_time(t)


# ------------------------------------------------------------------ burr surface
def face_height(r, th, teeth, sweep=1.0):
    """Height of the toothed face (0 = land), negative into the steel."""
    r = np.asarray(r, float)
    th = np.asarray(th, float)
    h = np.zeros_like(r)
    bev = r < R_BEV
    h[bev] = -BEVEL_DROP * (R_BEV - r[bev]) / (R_BEV - R_IN)
    s = np.clip((r - R_BEV) / (R_TEETH - R_BEV), 0, 1)
    tz = (r >= R_BEV) & (r < R_TEETH + 0.02)
    ts = th - sweep * np.log(np.maximum(r, 1e-3) / R_BEV)          # log spiral at 45 degrees
    u = np.mod(ts * teeth / (2 * np.pi), 1.0)
    frac = 0.85 - 0.73 * s
    depth = 0.2 * (1 - s) ** 1.2 + 0.012
    w = u / np.maximum(frac, 1e-3)
    prof = np.where(w < 0.06, w / 0.06, np.clip(1 - (w - 0.06) / 0.94, 0, 1))   # steep cutting wall, long relief facet
    g = np.where(u < frac, -depth * prof, 0.0)
    h[tz] = np.minimum(h[tz], g[tz]) if np.any(tz) else h[tz]
    # entry: grooves fade in over the end of the bevel
    blend = np.clip((r - (R_BEV - 0.08)) / 0.08, 0, 1)
    h = np.where(bev, np.minimum(h, g * blend), h)
    # counterbores of the three screws
    for a in (math.radians(90), math.radians(210), math.radians(330)):
        cx, cy = 2.41 * math.cos(a), 2.41 * math.sin(a)
        d = np.hypot(r * np.cos(th) - cx, r * np.sin(th) - cy)
        h = np.where(d < 0.43, np.minimum(h, -0.45), h)
    return h


def burr_solid(name, teeth, nr, per_tooth, sweep=1.0, sector=None):
    """Closed burr: toothed face on a polar grid, flat back, bore and rim walls, optional cut faces for a sector."""
    nt = teeth * per_tooth
    if sector is None:
        ths = np.linspace(0, 2 * np.pi, nt, endpoint=False)
        closed = True
    else:
        a0, a1 = sector
        span = (a1 - a0) % (2 * np.pi)
        ths = a0 + np.linspace(0, span, int(nt * span / (2 * np.pi)) + 1)
        closed = False
    rs = R_IN + (R_OUT - R_IN) * np.linspace(0, 1, nr)
    Rg, Tg = np.meshgrid(rs, ths, indexing='ij')                      # (nr, nth)
    H = face_height(Rg, Tg, teeth, sweep)
    H[0, :] = np.minimum(H[0, :], -BEVEL_DROP)
    nth = len(ths)
    top = np.stack([Rg * np.cos(Tg), Rg * np.sin(Tg), H], -1).reshape(-1, 3)
    bot = np.stack([Rg * np.cos(Tg), Rg * np.sin(Tg), np.full_like(H, -THICK)], -1).reshape(-1, 3)
    verts = np.concatenate([top, bot])
    off = len(top)
    vid = lambda i, j: i * nth + (j % nth)
    faces = []
    jmax = nth if closed else nth - 1
    for i in range(nr - 1):
        for j in range(jmax):
            a, b, c, d = vid(i, j), vid(i, j + 1), vid(i + 1, j + 1), vid(i + 1, j)
            faces.append((a, d, c, b))                                   # top, facing +z
            faces.append((a + off, b + off, c + off, d + off))           # back
    for j in range(jmax):
        i = nr - 1
        faces.append((vid(i, j), vid(i, j + 1), vid(i, j + 1) + off, vid(i, j) + off))    # rim wall
        faces.append((vid(0, j + 1), vid(0, j), vid(0, j) + off, vid(0, j + 1) + off))    # bore wall
    if not closed:
        for i in range(nr - 1):
            faces.append((vid(i + 1, 0), vid(i, 0), vid(i, 0) + off, vid(i + 1, 0) + off))
            j = nth - 1
            faces.append((vid(i, j), vid(i + 1, j), vid(i + 1, j) + off, vid(i, j) + off))
    me = C.mesh_from_arrays(name, verts, faces, smooth_shade=False)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(me)
    bm.free()
    # smooth the gentle facets, keep the cutting edges crisp
    me.set_sharp_from_angle(angle=math.radians(35))
    return me


def burr_coating():
    """Opalglide: bright ground steel under an interference coating (teal / magenta / violet shifting with angle)."""
    g = M.Graph('opalglide')
    tan = g.node('ShaderNodeTangent', direction_type='RADIAL', axis='Z').outputs[0]
    co = g.coord()
    film = g.map_range(g.noise(co, 0.9, detail=3.0).outputs['Fac'], 0.3, 0.7, 260.0, 520.0)
    marks = g.noise(co, 120.0, detail=3.0)
    rough = g.math('ADD', M.varied_roughness(g, 0.13, 0.24, 3.0), g.map_range(marks.outputs['Fac'], 0.3, 0.7, -0.04, 0.04))
    g.p(Base_Color=(0.56, 0.57, 0.58), Metallic=1.0, Roughness=rough, Anisotropic=0.6, Tangent=tan,
        Thin_Film_Thickness=film, Thin_Film_IOR=2.0, Normal=M.micro_normal(g, 160.0, 0.025))
    return g.mat


# ------------------------------------------------------------------ build
def build(scene):
    col = scene.collection
    rng = np.random.default_rng(11)
    coat = burr_coating()
    dark = M.get('steel_dark')
    # lower burr assembly (rotating): burr + carrier hub + screws
    lower = bpy.data.objects.new('lower_assembly', None)
    col.objects.link(lower)
    lower_me = burr_solid('lower_burr', 48, 110, 26)
    lower_me.materials.append(coat)
    C.obj_new('lower_burr', lower_me, col, lower)
    hub_v, hub_f, hub_uv = C.lathe([(0.001, 0.62), (0.13, 0.62), (0.13, 0.4), (0.62, 0.36), (0.66, 0.1), (1.2, 0.02), (1.25, -0.12),
                                    (1.93, -0.2), (1.95, -0.85), (0.001, -0.85)], 128)
    hub = C.obj_new('carrier_hub', C.mesh_from_arrays('carrier_hub', hub_v, hub_f, hub_uv), col, lower)
    hub.data.materials.append(M.get('steel'))
    for a in (90, 210, 330):
        screw = _screw(f'screw_{a}', col, lower)
        screw.location = (2.41 * math.cos(math.radians(a)), 2.41 * math.sin(math.radians(a)), -0.47)
    # upper burr (fixed), mirrored face down, cut away towards the camera for the render; full ring for collisions
    upper = bpy.data.objects.new('upper_assembly', None)
    col.objects.link(upper)
    upper.location = (0, 0, GAP)
    upper.rotation_euler = (math.pi, 0, 0)
    up_me = burr_solid('upper_burr', 44, 110, 26, sweep=1.0, sector=UPPER_SECTOR)
    up_me.materials.append(coat)
    C.obj_new('upper_burr', up_me, col, upper)
    for a in (90, 210):
        s = _screw(f'screw_u{a}', col, upper)
        s.location = (2.41 * math.cos(math.radians(a)), 2.41 * math.sin(math.radians(a)), -0.47)
    # chamber: dark housing behind the burrs, a bellows throat above (out of the frame but in the reflections)
    hv, hf, huv = C.lathe([(3.6, -2.5), (3.7, -2.5), (3.7, 2.2), (3.6, 2.2)], 128)
    house = C.obj_new('chamber', C.mesh_from_arrays('chamber', hv, hf, huv), col)
    house.data.materials.append(dark)
    _cut_sector(house, math.radians(-25), math.radians(205))
    tv, tf, tuv = C.lathe([(2.0, 1.2), (2.05, 1.2), (2.05, 12.0), (2.0, 12.0)], 96)
    throat = C.obj_new('throat', C.mesh_from_arrays('throat', tv, tf, tuv), col)
    throat.data.materials.append(M.get('steel'))
    _cut_sector(throat, math.radians(-20), math.radians(200))

    # collision proxies (hidden): the full upper ring, coarse lower burr, the hub
    proxies = bpy.data.collections.new('burr_proxies')
    scene.collection.children.link(proxies)
    lower_proxy = C.obj_new('lower_proxy', burr_solid('lower_proxy', 48, 40, 8), proxies, lower)
    upper_proxy = C.obj_new('upper_proxy', burr_solid('upper_proxy', 44, 40, 8), proxies, upper)
    hub_proxy = C.obj_new('hub_proxy', hub.data, proxies, lower)
    wall_proxy = C.obj_new('wall_proxy', C.mesh_from_arrays('wall_proxy', *C.lathe([(3.5, -2.5), (3.5, 2.5)], 64)[:2]), proxies)
    for p in (lower_proxy, upper_proxy, hub_proxy, wall_proxy):
        p.hide_render = True
        p.display_type = 'WIRE'

    # rotation of the lower assembly (keyframes on every frame, linear)
    a0, a1 = scene.frame_start - 2, scene.frame_end + 2
    for f in range(a0, a1 + 1):
        lower.rotation_euler = (0, 0, burr_angle(C.time_of(f)))
        lower.keyframe_insert('rotation_euler', frame=f)
    C.set_interpolation(lower, 'LINEAR')

    # rigid body world
    with bpy.context.temp_override(scene=scene):
        bpy.ops.rigidbody.world_add()
    rbw = scene.rigidbody_world
    rbw.collection = bpy.data.collections.new('rb_burrs')
    rbw.constraints = bpy.data.collections.new('rb_burrs_constraints')
    rbw.substeps_per_frame = 20
    rbw.solver_iterations = 30
    rbw.time_scale = SLOWMO
    rbw.use_split_impulse = True
    rbw.point_cache.frame_start = scene.frame_start
    rbw.point_cache.frame_end = scene.frame_end + 2
    # Bullet multiplies the two bodies' values: steel 0.35 x bean 0.8 = 0.28 bean-on-steel friction (measured wall
    # friction 0.14-0.25, inclined plane ~0.5), bean-on-bean 0.64 (repose angle 29-34 deg); restitution 0.6 x 0.5 = 0.3
    for p, kin in ((lower_proxy, True), (hub_proxy, True), (upper_proxy, False), (wall_proxy, False)):
        _rb(scene, p, 'PASSIVE', shape='MESH', friction=0.35, restitution=0.6, kinematic=kin, margin=0.004)

    # beans: shards glued with breakable fixed constraints, thrown down the throat
    shards = []
    bean_mat, inner_mat = M.get('bean'), M.get('bean_inner')
    for k in range(N_BEANS):
        src = B.bean_bmesh(100 + k, 40)
        bscale = 0.92 + 0.16 * rng.random()
        bmesh.ops.scale(src, vec=(bscale, bscale, bscale), verts=src.verts)
        pieces = B.fragment_meshes(f'bean{k}', src, int(rng.integers(8, 12)), 200 + k, (bean_mat, inner_mat))
        src.free()
        # entry: staggered, falling at ~1.2 m/s from the bellows, tumbling
        p0 = Vector((rng.normal(0, 0.55), rng.normal(0, 0.55), 2.6 + 0.9 * k + rng.random() * 0.4))
        q0 = Quaternion(Vector(rng.normal(size=3)).normalized(), rng.random() * 6.28)
        v0 = Vector((rng.normal(0, 8), rng.normal(0, 8), -120 - 20 * rng.random()))
        w0 = Vector(rng.normal(0, 40, 3))
        objs = []
        for j, (me, c) in enumerate(pieces):
            ob = C.obj_new(me.name, me, col)
            ob.rotation_mode = 'QUATERNION'
            vol = abs(_volume(me))
            _rb(scene, ob, 'ACTIVE', shape='CONVEX_HULL', mass=max(vol * DENSITY, 1e-4), friction=0.8, restitution=0.5, margin=0.003)
            ob.rigid_body.linear_damping = 0.02
            ob.rigid_body.angular_damping = 0.05
            objs.append((ob, Vector(c)))
        _launch(scene, objs, p0, q0, v0, w0)
        _glue(scene, objs, k)
        shards.extend(o for o, _ in objs)

    # bake: step the simulation frame by frame, record every shard
    rec = {o.name: [] for o in shards}
    for f in range(scene.frame_start, scene.frame_end + 3):
        scene.frame_set(f)
        for o in shards:
            rec[o.name].append(o.matrix_world.copy())
    rbw.enabled = False
    for o in shards:
        o.rigid_body.enabled = False
    events = _key_shards(scene, shards, rec)
    _powder(scene, col, events, rng)
    _lights_camera(scene)
    attach(scene)


def _screw(name, col, parent):
    """Socket head cap screw sunk in its counterbore."""
    v, f, uv = C.lathe([(0.001, 0.0), (0.36, 0.0), (0.4, 0.04), (0.4, 0.38), (0.36, 0.42), (0.17, 0.42), (0.17, 0.3), (0.001, 0.3)], 48)
    ob = C.obj_new(name, C.mesh_from_arrays(name, v, f, uv), col, parent)
    ob.data.materials.append(M.get('steel_dark'))
    return ob


def _cut_sector(ob, a0, a1):
    """Delete the faces of a lathe outside the angular sector [a0, a1] (going counter-clockwise)."""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    span = (a1 - a0) % (2 * math.pi)
    kill = [f for f in bm.faces if ((math.atan2(f.calc_center_median().y, f.calc_center_median().x) - a0) % (2 * math.pi)) > span]
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    bm.to_mesh(me)
    bm.free()


def _volume(me):
    bm = bmesh.new()
    bm.from_mesh(me)
    v = bm.calc_volume()
    bm.free()
    return v


def _rb(scene, ob, kind, shape, mass=1.0, friction=0.5, restitution=0.3, kinematic=False, margin=0.004):
    with bpy.context.temp_override(scene=scene, object=ob, active_object=ob, selected_objects=[ob], selected_editable_objects=[ob]):
        bpy.ops.rigidbody.object_add(type=kind)
    rb = ob.rigid_body
    rb.type = kind
    rb.collision_shape = shape
    rb.mass = mass
    rb.friction = friction
    rb.restitution = restitution
    rb.kinematic = kinematic
    rb.use_margin = True
    rb.collision_margin = margin
    rb.mesh_source = 'FINAL'
    rb.use_deactivation = False


def _launch(scene, objs, p0, q0, v0, w0):
    """Animate the glued bean for the first frames (kinematic) so Bullet inherits its velocity, then let go."""
    f0 = scene.frame_start
    dt = 1.0 / C.FPS * SLOWMO
    for i, f in enumerate((f0, f0 + 1, f0 + 2)):     # Bullet needs two animated steps to pick up the velocity
        t = i * dt
        pos = p0 + v0 * t + Vector((0, 0, -0.5 * C.GRAVITY * t * t))
        ang = w0.length * t
        rot = Quaternion(w0.normalized(), ang) @ q0 if w0.length > 0 else q0
        for ob, c in objs:
            ob.rigid_body.kinematic = True
            ob.location = pos + rot @ c
            ob.rotation_quaternion = rot
            ob.keyframe_insert('location', frame=f)
            ob.keyframe_insert('rotation_quaternion', frame=f)
            ob.rigid_body.keyframe_insert('kinematic', frame=f)
    for ob, _ in objs:
        ob.rigid_body.kinematic = False
        ob.rigid_body.keyframe_insert('kinematic', frame=f0 + 3)


def _glue(scene, objs, k):
    """Fixed constraints between the shards of a bean, so it moves as one rigid body until an impact impulse above the
    threshold tears the glue."""
    pairs = {(i, j) for i in range(len(objs)) for j in range(i + 1, len(objs))}   # all pairs: no shard of a bean collides with another
    for i, j in sorted(pairs):
        a, b = objs[i][0], objs[j][0]
        e = bpy.data.objects.new(f'glue{k}_{i}_{j}', None)
        scene.collection.objects.link(e)
        e.location = (a.location + b.location) / 2
        with bpy.context.temp_override(scene=scene, object=e, active_object=e, selected_objects=[e]):
            bpy.ops.rigidbody.constraint_add(type='FIXED')
        rc = e.rigid_body_constraint
        rc.object1, rc.object2 = a, b
        rc.use_breaking = True
        rc.breaking_threshold = BREAK_IMPULSE
        rc.disable_collisions = True
        e.hide_render = True


def _key_shards(scene, shards, rec):
    """Baked transforms -> keyframes. Shards that reach the outer cutting zone are ground: they shrink away and their
    position and time are returned as powder emission events."""
    events = []
    f0 = scene.frame_start
    for ob in shards:
        if ob.animation_data:
            ob.animation_data_clear()
        mats = rec[ob.name]
        gone = None
        for i, m in enumerate(mats):
            loc, rot, _ = m.decompose()
            r = math.hypot(loc.x, loc.y)
            if gone is None and r > R_TEETH - 0.25 and loc.z < GAP + 0.2:
                gone = i
                events.append((C.time_of(f0 + i), (loc.x, loc.y, loc.z), _volume(ob.data)))
            s = 1.0 if gone is None else max(0.0, 1.0 - (i - gone) / 3.0)
            ob.location, ob.rotation_quaternion, ob.scale = loc, rot, (s, s, s)
            for path in ('location', 'rotation_quaternion', 'scale'):
                ob.keyframe_insert(path, frame=f0 + i)
        C.set_interpolation(ob, 'LINEAR')
    return events


# ------------------------------------------------------------------ powder
def _powder(scene, col, events, rng):
    """Grounds leaving the burr gap: born where shards are ground and all around the rim while beans are being cut.
    Closed-form motion (tangential throw + gravity + quadratic-ish drag approximated as linear)."""
    births = []
    for t, (x, y, z), vol in events:
        n = int(np.clip(vol * 2200, 20, 400))
        births.append((np.full(n, t) + rng.random(n) * 0.25, np.repeat([[x, y, z]], n, 0) + rng.normal(0, 0.05, (n, 3))))
    t0, t1 = C.T['burrs'] + 0.45, C.SHOTS[1][2]
    n = 6000
    th = rng.random(n) * 2 * np.pi
    births.append((t0 + rng.random(n) * (t1 - t0), np.stack([R_OUT * np.cos(th), R_OUT * np.sin(th), np.full(n, GAP * 0.5)], -1)))
    tb = np.concatenate([b[0] for b in births])
    p0 = np.concatenate([b[1] for b in births])
    r = np.hypot(p0[:, 0], p0[:, 1]) + 1e-6
    radial = np.stack([p0[:, 0] / r, p0[:, 1] / r, np.zeros_like(r)], -1)
    tang = np.stack([p0[:, 1] / r, -p0[:, 0] / r, np.zeros_like(r)], -1)      # direction of the lower burr's rotation
    speed = (2 * np.pi * RPM / 60.0) * R_OUT * (0.5 + 0.5 * rng.random(len(tb)))
    v0 = tang * speed[:, None] + radial * (40 + 80 * rng.random(len(tb)))[:, None] + rng.normal(0, 15, (len(tb), 3))
    size = 0.012 + 0.025 * rng.random(len(tb)) ** 2
    np.savez(C.CACHE / 'burrs_powder.npz', tb=tb, p0=p0, v0=v0, size=size)
    # instanced grain shapes
    shapes = bpy.data.collections.new('grain_shapes')
    for i in range(6):
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0)
        for v in bm.verts:
            v.co *= 0.65 + 0.5 * rng.random()
        me = bpy.data.meshes.new(f'grain{i}')
        bm.to_mesh(me)
        bm.free()
        shapes.objects.link(bpy.data.objects.new(f'grain{i}', me))
    me = bpy.data.meshes.new('powder')
    me.vertices.add(len(tb))
    me.attributes.new('size', 'FLOAT', 'POINT')
    me.attributes.new('pid', 'INT', 'POINT')
    me.attributes['pid'].data.foreach_set('value', np.arange(len(tb), dtype=np.int32))
    ob = C.obj_new('powder', me, col)
    mod = ob.modifiers.new('grains', 'NODES')
    mod.node_group = gn.grain_instancer('grain_instancer', shapes, M.get('grain'))


def powder_positions(t, data):
    tb, p0, v0, size = data['tb'], data['p0'], data['v0'], data['size']
    tau = np.maximum((t - tb) * SLOWMO, 0.0)                 # real seconds since birth
    k = 6.0                                                    # drag rate, 1/s
    e = (1 - np.exp(-k * tau)) / k
    pos = p0 + v0 * e[:, None]
    pos[:, 2] -= C.GRAVITY * (tau / k - e / k)
    alive = (t >= tb)
    s = np.where(alive, size, 0.0)
    pos[~alive] = p0[~alive]
    return pos, s


# ------------------------------------------------------------------ camera, lights
CAM_KEYS = [(1.0, (-1.2, -9.6, 5.6), (0.0, 0.2, 0.6)), (1.8, (-0.4, -8.9, 4.6), (0.1, 0.3, 0.2)), (2.6, (0.7, -8.0, 3.7), (0.3, 0.6, 0.0))]


def _cam(t):
    pos = C.hermite([(k[0], k[1]) for k in CAM_KEYS], t)
    tgt = C.hermite([(k[0], k[2]) for k in CAM_KEYS], t)
    focus_pt = np.array([0.4, -1.6, 0.05])                      # the near breaker zone, where the beans crack
    shake = np.array([C.noise1(t * 2.0, 1), C.noise1(t * 2.0, 2), C.noise1(t * 2.0, 3)]) * 0.02
    return dict(pos=pos + shake, target=tgt, roll=0.04 * math.sin(t * 1.3), fov=C.lerp(30, 26, C.smooth(1.0, 2.6, t)),
                focus=float(np.linalg.norm(pos - focus_pt)), fstop=8.0)


def _lights_camera(scene):
    col = scene.collection
    key = S.area_light(scene, 'key', 6.0, 0.9, (1.0, 0.93, 0.85), size_y=10.0)
    key.location = (-7.0, -5.0, 9.0)
    S.aim(key, (0, 0, 0))
    rim = S.area_light(scene, 'rim', 2.0, 0.8, (1.0, 0.75, 0.5), size_y=8.0)
    rim.location = (6.0, 6.0, 3.0)
    S.aim(rim, (0, 0, 0.3))
    top = S.area_light(scene, 'top', 3.0, 0.15, (0.9, 0.95, 1.0))
    top.location = (0.0, 0.0, 14.0)
    S.aim(top, (0, 0, 0))
    S.make_camera(scene, 'cam_burrs', _cam)
    S.key_world(scene.world, lambda t: (0.6, 0.15, 0.0), range(scene.frame_start - 1, scene.frame_end + 2))


# ------------------------------------------------------------------ render-time updates
def attach(scene):
    data = dict(np.load(C.CACHE / 'burrs_powder.npz'))
    me = scene.objects['powder'].data

    def update(t):
        pos, s = powder_positions(t, data)
        me.vertices.foreach_set('co', pos.astype(np.float32).ravel())
        me.attributes['size'].data.foreach_set('value', s.astype(np.float32))
        me.update()

    C.on_frame(scene.name, update)
    update(C.time_of(scene.frame_start))
