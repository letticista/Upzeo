"""Shot 5: the finished espresso on a Gallura granite table. Top-down on the crema, crane up and back to a
three-quarter view of the cup, the logo prints itself while golden sparks swirl onto it, a glint crosses the glaze,
slow push in under the title.

Set (real sizes, cm): honed and waxed granite slab, cork coaster 168 mm x 5.5 mm, porcelain saucer and cup
(props), crema (crema.py) turning slowly (residual swirl of the pour, ~0.1 rad/s), a myrtle sprig and eight roasted
beans in the foreground.

Physics and measured values:
- Beans: dropped 0.4-1.2 cm onto the granite with Bullet before the shot starts (2.5 s pre-roll, 20 sub-steps per
  frame, 30 solver iterations, gravity 981 cm/s^2). Mass from the mesh volume x 0.65 g/cm^3 (envelope density of
  roasted beans 0.62-0.75), so about 0.13 g each. Bullet multiplies the two bodies' values: bean 0.8 x granite 0.5 =
  0.4 sliding friction (seeds on polished stone 0.35-0.45), restitution 0.5 x 0.6 = 0.3 (hard seeds on stone). The
  resting poses are baked to keyframes.
- Myrtle (Myrtus communis): leaves ovate-lanceolate, acuminate, 2-3.6 x 0.9-1.4 cm and ~0.3 mm thick, slightly convex
  with a sunken midrib; berries 8-10 mm ellipsoids, blue-black with a waxy bloom and a ring of persistent sepals.
  The sprig lies on the table: each leaf pivots down about its petiole until it rests on the table, the twig, a berry
  or a leaf already lying there (a height field of everything placed before it), so nothing floats or
  interpenetrates.
- Steam: espresso at ~70 C under 22 C air drives a buoyant plume, w ~ 0.3 (g beta dT L)^0.5 ~ 6 cm/s for a 6 cm cup;
  it widens with height (turbulent plume half-angle ~12 degrees). What is visible are 2-20 um condensed droplets: a
  sparse, white, strongly forward-scattering medium (Mie, g ~ 0.65 after multiple scattering) so the rim light behind
  the cup makes it glow against the dark room. Density is 4D noise advected upward with the plume velocity and folded
  into thin sheets (|n - 0.5| ridges), the way the shear layers of a laminar-to-turbulent plume roll up; a keyed
  Value node carries the time, another the amount (thin over the crema, stronger once the camera is on the side).
- Sparks (1000): glowing gold specks carried along the streamlines of a sink vortex wrapped around the cup (log
  spirals: radius and height decay as the angle grows), decelerating as they settle on the glaze exactly where the
  print front is at that moment; afterwards they cool with an exponential decay of 2.2/s and twinkle. Closed form in
  time, evaluated at every (sub)frame.
"""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

from . import bean as B
from . import common as C
from . import crema as CR
from . import materials as M
from . import props as P
from . import stage as S

NAME = 'cup'
T0, T1 = [(a, b) for n, a, b in C.SHOTS if n == NAME][0]
CRANE, REVEAL = C.T['crane'], C.T['reveal']
GLINT = (9.7, 10.7)

CORK_R, CORK_H = 8.4, 0.55
SAUCER_WELL = 0.64                      # top of the saucer's flat well (props.build_saucer profile)
CUP_Z = CORK_H + SAUCER_WELL + 0.002    # cup foot resting on the saucer
CREMA_Z = CUP_Z + P.CUP_FILL
CREMA_SPIN = -0.1                       # rad/s
LOGO_PT = np.array([0.0, -P.interp(P.CUP_OUTER, P.LOGO_Y), CUP_Z + P.LOGO_Y])

BEAN_DENSITY = 0.65
N_SPARKS = 1000
SPARK_GLOW = 0.22                       # fraction of gold_spark's emission while flying (keeps them gold, not white)
SPARK_DECAY = 2.2                       # 1/s
STEAM_RISE = 6.0                        # cm/s
GLINT_POWER = 0.22                      # W, the strip's peak power
HANDLE_ANGLE = 0.62                     # props.build_cup rotates the handle by this about Z


# ------------------------------------------------------------------ timeline helpers
def reveal(t):
    return C.smooth(REVEAL[0], REVEAL[1], t)


def reveal_time(v):
    """Inverse of reveal(): when the print reaches value v (array)."""
    ts = np.linspace(REVEAL[0], REVEAL[1], 2001)
    vs = np.array([reveal(x) for x in ts])
    return np.interp(v, vs, ts)


def crane(t):
    return C.smoother(CRANE[0], CRANE[1], t)


# ------------------------------------------------------------------ geometry helpers
def _mesh_obj(name, verts, faces, col, mat, smooth=True):
    me = C.mesh_from_arrays(name, verts, faces, smooth_shade=smooth)
    me.materials.append(mat)
    return C.obj_new(name, me, col)


def _closed(me):
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(me)
    bm.free()
    me.shade_smooth()
    return me


def _slab(name, size, loc, col, mat, bevel=0.25):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    bmesh.ops.bevel(bm, geom=bm.edges[:], offset=bevel, segments=4, affect='EDGES')
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    ob = C.obj_new(name, me, col)
    ob.location = loc
    return ob


def _spline(points, n):
    """Centripetal-free Catmull-Rom through points (k, d), sampled at n points evenly in parameter."""
    Pp = np.asarray(points, float)
    m = len(Pp)
    out = []
    for t in np.linspace(0, m - 1 - 1e-9, n):
        i = int(t)
        u = t - i
        p0, p1, p2, p3 = Pp[max(i - 1, 0)], Pp[i], Pp[i + 1], Pp[min(i + 2, m - 1)]
        out.append(0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3))
    return np.array(out)


def _tube(path, radii, segs=12):
    """Closed tube with a varying radius along a polyline (parallel-transport frames), capped at both ends."""
    path = np.asarray(path, float)
    n = len(path)
    T = np.gradient(path, axis=0)
    T /= np.linalg.norm(T, axis=1, keepdims=True)
    nrm = np.cross(T[0], (0, 0, 1.0))
    if np.linalg.norm(nrm) < 1e-3:
        nrm = np.cross(T[0], (1.0, 0, 0))
    nrm /= np.linalg.norm(nrm)
    verts = []
    a = np.linspace(0, 2 * np.pi, segs, endpoint=False)
    for k in range(n):
        nrm = nrm - T[k] * np.dot(nrm, T[k])
        nrm /= np.linalg.norm(nrm)
        b = np.cross(T[k], nrm)
        verts.extend(path[k] + radii[k] * (np.cos(a)[:, None] * nrm + np.sin(a)[:, None] * b))
    faces = [(k * segs + j, k * segs + (j + 1) % segs, (k + 1) * segs + (j + 1) % segs, (k + 1) * segs + j)
             for k in range(n - 1) for j in range(segs)]
    faces.append(tuple(range(segs))[::-1])
    faces.append(tuple((n - 1) * segs + j for j in range(segs)))
    return np.array(verts), faces


# ------------------------------------------------------------------ table set
def _table(col):
    # slab edge 22 cm behind the cup: the room shows above it as a soft background
    _slab('granite_table', (160.0, 82.0, 3.0), (0.0, -19.0, -1.5), col, M.get('granite'), 0.35)
    v, f, uv = C.lathe([(0.001, 0.0), (CORK_R - 0.06, 0.0), (CORK_R, 0.05), (CORK_R, CORK_H - 0.05), (CORK_R - 0.06, CORK_H),
                        (0.001, CORK_H)], 256)
    C.obj_new('coaster', C.mesh_from_arrays('coaster', v, f, uv), col).data.materials.append(M.get('cork'))
    saucer = P.build_saucer(col)
    saucer.location.z = CORK_H
    cup = P.build_cup(col, logo=True)
    cup['root'].location.z = CUP_Z
    c = CR.build_crema(col, cup['root'])
    c.set_level(P.CUP_FILL)
    CR.fit_bubbles(c, c.radius_at(P.CUP_FILL))
    return cup, c


class HeightField:
    """Top surface of everything lying on the table, sampled on a grid (cm). Used to rest leaves on what is under them."""

    def __init__(self, x0, x1, y0, y1, h=0.025):
        self.x0, self.y0, self.h = x0, y0, h
        self.H = np.zeros((int((y1 - y0) / h) + 1, int((x1 - x0) / h) + 1))

    def _ij(self, xy):
        i = np.clip(((xy[:, 1] - self.y0) / self.h).astype(int), 0, self.H.shape[0] - 1)
        j = np.clip(((xy[:, 0] - self.x0) / self.h).astype(int), 0, self.H.shape[1] - 1)
        return i, j

    def at(self, xy):
        return self.H[self._ij(xy)]

    def add(self, pts, grow=1):
        i, j = self._ij(pts)
        for di in range(-grow, grow + 1):
            for dj in range(-grow, grow + 1):
                ii = np.clip(i + di, 0, self.H.shape[0] - 1)
                jj = np.clip(j + dj, 0, self.H.shape[1] - 1)
                np.maximum.at(self.H, (ii, jj), pts[:, 2])


def _leaf_surface(L, W, rng, nu=30, nv=14):
    """Leaf in local coordinates: x along the blade from the petiole (0) to the tip (L), y across, z up.
    Returns (top, bottom) grids of shape (nu+1, nv+1, 3); they share the margin, so the merged mesh is closed."""
    u = (np.linspace(0, 1, nu + 1) ** 0.9)[:, None]
    v = np.linspace(-1, 1, nv + 1)[None, :]
    shape = u ** 0.55 * (1 - u) ** 0.85
    half = 0.5 * W * shape / shape.max()
    y = v * half
    x = u * L * np.ones_like(v)
    arch = rng.uniform(0.03, 0.07) * L
    twist = rng.uniform(-0.25, 0.25)
    z = arch * np.sin(np.pi * u) + 0.12 * half * (1 - v ** 2)                  # convex blade, arched along its length
    z = z - 0.012 * np.exp(-(y / 0.035) ** 2) * (1 - u)                          # sunken midrib on the upper side
    yt, zt = y * np.cos(twist * u) - z * np.sin(twist * u), y * np.sin(twist * u) + z * np.cos(twist * u)
    th = 0.015 * np.sqrt(np.clip(1 - v ** 2, 0, 1)) * np.sqrt(np.clip(np.sin(np.pi * u), 0, 1))
    top = np.stack([x, yt, zt + th], -1)
    bot = np.stack([x, yt, zt - th], -1)
    return top, bot


def _grid_faces(nu, nv, off=0, flip=False):
    f = []
    for i in range(nu):
        for j in range(nv):
            a = off + i * (nv + 1) + j
            q = (a, a + nv + 1, a + nv + 2, a + 1)
            f.append(q[::-1] if flip else q)
    return f


def _myrtle(col, rng):
    """Sprig lying on the table, front left of the coaster: tapered twig, 18 leaves on alternating sides, 4 berries."""
    hf = HeightField(-14.0, 4.0, -16.0, -6.0)
    ctrl = [(-11.6, -9.4), (-8.8, -10.5), (-6.0, -10.0), (-3.6, -11.0), (-1.5, -10.8)]
    n = 140
    c2 = _spline(ctrl, n)
    s = np.linspace(0, 1, n)
    radii = 0.085 - 0.04 * s
    path = np.column_stack([c2, radii + 0.001])
    v, f = _tube(path, radii, 12)
    _mesh_obj('myrtle_twig', v, f, col, M.get('twig'))
    hf.add(np.column_stack([c2, 2 * radii]), grow=3)
    tang = np.gradient(c2, axis=0)
    tang /= np.linalg.norm(tang, axis=1, keepdims=True)
    side_n = np.column_stack([-tang[:, 1], tang[:, 0]])

    # berries on short pedicels from the last nodes, resting on the table
    berry_v, berry_f = _berry_mesh()
    for k, (sk, side, ang, plen) in enumerate([(0.97, 1, 0.25, 0.9), (0.9, -1, 0.7, 1.1), (0.84, 1, 0.95, 1.2), (0.93, -1, 0.15, 0.7)]):
        i = int(sk * (n - 1))
        d = tang[i] * math.cos(ang) + side * side_n[i] * math.sin(ang)
        base = np.array([*c2[i], radii[i] + 0.001])
        a_len, b_r = 0.47 + 0.04 * rng.random(), 0.36 + 0.03 * rng.random()
        ctr = base[:2] + d * (plen + a_len)
        ctr = np.array([*ctr, b_r])
        yaw = math.atan2(d[1], d[0])
        R = Matrix.Rotation(yaw, 4, 'Z') @ Matrix.Rotation(math.pi / 2, 4, 'Y')   # berry axis (local z) along d
        vv = np.array([R @ Vector((x * b_r, y * b_r, z * a_len)) for x, y, z in berry_v]) + ctr
        _mesh_obj(f'myrtle_berry{k}', vv, berry_f, col, M.get('berry'))
        hf.add(vv, grow=2)
        stalk_end = ctr - np.array([*d, 0.0]) * a_len * 0.92
        sp = _spline([base, (base + stalk_end) / 2 + np.array([0, 0, 0.06]), stalk_end], 24)
        tv, tf = _tube(sp, np.full(24, 0.022), 8)
        _mesh_obj(f'myrtle_pedicel{k}', tv, tf, col, M.get('twig'))

    # leaves, base to tip; each rests on what is already there
    leaf_mat = M.get('leaf')
    for k in range(18):
        sk = 0.06 + 0.86 * k / 17 + rng.uniform(-0.01, 0.01)
        i = int(sk * (n - 1))
        side = 1 if k % 2 else -1
        L = (3.5 - 1.5 * sk) * rng.uniform(0.88, 1.08)
        W = L * rng.uniform(0.36, 0.44)
        top, bot = _leaf_surface(L, W, rng)
        yaw = math.atan2(tang[i, 1], tang[i, 0]) + side * rng.uniform(0.75, 1.1)
        roll = rng.uniform(-0.12, 0.12)
        base = np.array([*(c2[i] + side * side_n[i] * radii[i] * 0.8), radii[i] * 1.3])
        pts = np.concatenate([top.reshape(-1, 3), bot.reshape(-1, 3)])
        far = np.concatenate([top[..., 0].ravel(), bot[..., 0].ravel()]) > 0.15 * L
        pitch = _rest_pitch(pts, far, base, yaw, roll, hf)
        R = np.array(Matrix.Rotation(yaw, 3, 'Z') @ Matrix.Rotation(pitch, 3, 'Y') @ Matrix.Rotation(roll, 3, 'X'))
        world = pts @ R.T + base
        nu, nv = top.shape[0] - 1, top.shape[1] - 1
        faces = _grid_faces(nu, nv) + _grid_faces(nu, nv, (nu + 1) * (nv + 1), flip=True)
        me = _closed(C.mesh_from_arrays(f'myrtle_leaf{k}', world, faces))
        me.materials.append(leaf_mat)
        C.obj_new(f'myrtle_leaf{k}', me, col)
        hf.add(world[:len(world) // 2], grow=1)
    return hf


def _rest_pitch(pts, far, base, yaw, roll, hf, eps=0.004):
    """Largest downward pitch about the petiole before the blade touches the table or something lying on it."""
    best = -0.5
    for pitch in np.arange(-0.5, 0.7, 0.01):
        R = np.array(Matrix.Rotation(yaw, 3, 'Z') @ Matrix.Rotation(pitch, 3, 'Y') @ Matrix.Rotation(roll, 3, 'X'))
        w = pts[far] @ R.T + base
        if np.any(w[:, 2] < hf.at(w[:, :2]) + eps):
            break
        best = pitch
    return best


def _berry_mesh():
    """Unit berry around +z: ellipsoid with the crown of persistent sepals at the tip (+z)."""
    prof = [(0.001, -1.0)]
    for a in np.linspace(-math.pi / 2 + 0.12, math.pi / 2 - 0.3, 22):
        prof.append((math.cos(a), math.sin(a)))
    prof += [(0.3, 0.97), (0.27, 1.06), (0.22, 1.02), (0.14, 0.94), (0.001, 0.93)]
    v, f, _ = C.lathe(prof, 40)
    # five sepal lobes on the crown ring
    ang = np.arctan2(v[:, 1], v[:, 0])
    crown = v[:, 2] > 0.95
    v[crown, 2] += 0.05 * np.clip(np.cos(5 * ang[crown]), 0, 1)
    return v, f


# ------------------------------------------------------------------ beans (rigid-body drop, baked)
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
    rb.mesh_source = 'BASE'
    rb.use_deactivation = False


def _volume(me):
    bm = bmesh.new()
    bm.from_mesh(me)
    v = bm.calc_volume()
    bm.free()
    return abs(v)


def _drop_points(rng, n, centre, spread, gap=1.2):
    """A handful let go just above the table: staggered heights, no two beans overlapping at the start."""
    pts = []
    while len(pts) < n:
        a, r = rng.uniform(0, 2 * math.pi), spread * math.sqrt(rng.random())
        p = np.array([centre[0] + r * math.cos(a), centre[1] + r * math.sin(a), 0.6 + 0.75 * len(pts) + 0.3 * rng.random()])
        if all(np.linalg.norm(p - q) > gap for q in pts):
            pts.append(p)
    return pts


def _beans(scene, col, rng, hf):
    """Eight beans dropped onto the granite in front of the coaster, clear of the sprig, settled with Bullet."""
    spots = _drop_points(rng, 8, (2.3, -10.9), 1.3)
    beans = []
    for k, (x, y, z) in enumerate(spots):
        me = B.bean_mesh(f'table_bean{k}', 300 + k, 40)
        me.materials.append(M.get('bean'))
        ob = C.obj_new(f'table_bean{k}', me, col)
        ob.rotation_mode = 'QUATERNION'
        # mostly flat side down (the +z face carries the cut), a few on their backs or edges
        flip = math.pi if rng.random() < 0.75 else rng.uniform(0.6, 1.2)
        q = (Matrix.Rotation(rng.uniform(0, 2 * math.pi), 3, 'Z') @ Matrix.Rotation(flip + rng.normal(0, 0.25), 3, 'X')).to_quaternion()
        ob.rotation_quaternion = q
        ob.location = (x, y, z)
        beans.append(ob)

    with bpy.context.temp_override(scene=scene):
        bpy.ops.rigidbody.world_add()
    rbw = scene.rigidbody_world
    rbw.collection = bpy.data.collections.new('rb_cup')
    rbw.substeps_per_frame = 20
    rbw.solver_iterations = 30
    rbw.use_split_impulse = True
    f0 = scene.frame_start - 150
    rbw.point_cache.frame_start = f0
    rbw.point_cache.frame_end = scene.frame_start
    # collision proxies: the table top and the coaster
    proxies = bpy.data.collections.new('cup_proxies')
    scene.collection.children.link(proxies)
    floor = _slab('table_proxy', (60.0, 60.0, 2.0), (0.0, 0.0, -1.0), proxies, M.get('granite'), 0.01)
    cork_v, cork_f, _ = C.lathe([(0.001, 0.0), (CORK_R, 0.0), (CORK_R, CORK_H), (0.001, CORK_H)], 64)
    cork = C.obj_new('coaster_proxy', C.mesh_from_arrays('coaster_proxy', cork_v, cork_f), proxies)
    for p in (floor, cork):
        p.hide_render = True
        p.display_type = 'WIRE'
        _rb(scene, p, 'PASSIVE', 'MESH' if p is cork else 'BOX', friction=0.5, restitution=0.6)
    for ob in beans:
        _rb(scene, ob, 'ACTIVE', 'CONVEX_HULL', mass=_volume(ob.data) * BEAN_DENSITY, friction=0.8, restitution=0.5, margin=0.002)
        ob.rigid_body.linear_damping = 0.04
        ob.rigid_body.angular_damping = 0.12        # stands in for the rolling resistance Bullet does not model
    rec = []
    for f in range(f0, scene.frame_start + 1):
        scene.frame_set(f)
        rec.append([ob.matrix_world.copy() for ob in beans])
    rbw.enabled = False
    for ob in beans + [floor, cork]:
        ob.rigid_body.enabled = False
    # the beans are at rest when the shot starts: bake the final pose (and report the residual motion)
    resid = max((rec[-1][i].translation - rec[-2][i].translation).length * C.FPS for i in range(len(beans)))
    for i, ob in enumerate(beans):
        loc, rot, _ = rec[-1][i].decompose()
        ob.location, ob.rotation_quaternion = loc, rot
        for f in (scene.frame_start - 1, scene.frame_end + 1):
            ob.keyframe_insert('location', frame=f)
            ob.keyframe_insert('rotation_quaternion', frame=f)
        C.set_interpolation(ob, 'CONSTANT')
    on_sprig = [i for i, ob in enumerate(beans) if hf.at(np.array([ob.location[:2]]))[0] > 0.0]
    if on_sprig:
        print(f'[cup] WARNING beans {on_sprig} came to rest on the sprig footprint', flush=True)
    print(f'[cup] beans settled, residual speed {resid:.4f} cm/s, masses '
          f'{", ".join(f"{_volume(b.data) * BEAN_DENSITY:.3f}" for b in beans)} g', flush=True)
    return beans


# ------------------------------------------------------------------ steam
def _steam_material():
    g = M.Graph('cup_steam', principled=False)
    tm = g.node('ShaderNodeValue')
    tm.name = 'steam_time'
    amt = g.node('ShaderNodeValue')
    amt.name = 'steam_amount'
    co = g.node('ShaderNodeSeparateXYZ', {'Vector': g.coord('Object')})
    x, y, h = co.outputs['X'], co.outputs['Y'], co.outputs['Z']
    rise = g.math('MULTIPLY', tm.outputs[0], STEAM_RISE)
    hr = g.math('SUBTRACT', h, rise)                         # coordinate carried up with the plume
    # slow sway of the column, growing with height
    sway_in = g.node('ShaderNodeCombineXYZ', {'X': 0.0, 'Y': 3.0, 'Z': g.math('MULTIPLY', hr, 0.12)})
    sway = g.noise(sway_in.outputs[0], 1.0, detail=1.0, dims='4D', w=g.math('MULTIPLY', tm.outputs[0], 0.08))
    sw = g.node('ShaderNodeSeparateXYZ', {'Vector': sway.outputs['Color']})
    amp = g.math('MULTIPLY', h, 0.45)
    xs = g.math('SUBTRACT', x, g.math('MULTIPLY', g.math('SUBTRACT', sw.outputs['X'], 0.5), amp))
    ys = g.math('SUBTRACT', y, g.math('MULTIPLY', g.math('SUBTRACT', sw.outputs['Y'], 0.5), amp))
    q = g.node('ShaderNodeCombineXYZ', {'X': xs, 'Y': ys, 'Z': g.math('MULTIPLY', hr, 0.45)}).outputs[0]
    # thin rolled-up sheets: ridges of 4D noise, broken into patches by a coarser noise
    n = g.noise(q, 0.8, detail=4.0, rough=0.5, distortion=0.9, dims='4D', w=g.math('MULTIPLY', tm.outputs[0], 0.22))
    ridge = g.math('SUBTRACT', 1.0, g.math('MULTIPLY', g.math('ABSOLUTE', g.math('SUBTRACT', n.outputs[0], 0.5)), 10.0), clamp=True)
    sheet = g.math('POWER', ridge, 3.0)
    patch = g.noise(q, 0.33, detail=2.0, dims='4D', w=g.math('ADD', g.math('MULTIPLY', tm.outputs[0], 0.12), 5.0))
    body = g.map_range(patch.outputs[0], 0.5, 0.68, 0.0, 1.0)
    # plume envelope: radius widens ~0.2 cm per cm of height, fades in above the crema and out higher up
    r = g.math('SQRT', g.math('ADD', g.math('MULTIPLY', xs, xs), g.math('MULTIPLY', ys, ys)))
    R = g.math('ADD', 1.9, g.math('MULTIPLY', h, 0.21))
    radial = _smoothstep(g, g.math('DIVIDE', r, R), 1.0, 0.35)
    vert = g.math('MULTIPLY', _smoothstep(g, h, 0.2, 1.2), _smoothstep(g, h, 11.0, 4.5))
    dens = g.math('MULTIPLY', g.math('MULTIPLY', sheet, body), g.math('MULTIPLY', radial, vert))
    dens = g.math('MULTIPLY', dens, g.math('MULTIPLY', amt.outputs[0], 0.28))
    vol = g.node('ShaderNodeVolumePrincipled', {'Color': (0.96, 0.95, 0.93), 'Density': dens, 'Anisotropy': 0.5})
    g.link(vol.outputs[0], g.out.inputs['Volume'])
    return g.mat


def _smoothstep(g, v, a, b):
    """Smooth 0..1 from a to b (a > b gives a falling edge)."""
    nd = g.node('ShaderNodeMapRange', interpolation_type='SMOOTHSTEP', clamp=True)
    g.set(nd.inputs['Value'], v)
    lo, hi, o0, o1 = (a, b, 0.0, 1.0) if a < b else (b, a, 1.0, 0.0)
    for name, val in zip(('From Min', 'From Max', 'To Min', 'To Max'), (lo, hi, o0, o1)):
        g.set(nd.inputs[name], val)
    return nd.outputs['Result']


def _steam(col):
    """Domain hugging the plume: inside the cup above the crema, then widening above the rim."""
    prof = [(0.001, 0.2), (2.96, 0.2), (2.96, 1.45), (5.0, 3.2), (6.2, 12.5), (0.001, 12.5)]
    v, f, uv = C.lathe(prof, 64)
    ob = C.obj_new('steam', C.mesh_from_arrays('steam', v, f, uv, smooth_shade=False), col)
    ob.location = (0.0, 0.0, CREMA_Z)
    ob.data.materials.append(_steam_material())
    return ob


def steam_amount(t):
    return C.lerp(0.35, 1.0, C.smooth(CRANE[0] + 0.2, CRANE[1], t))


# ------------------------------------------------------------------ sparks
def _spark_targets(rng, n):
    """Points on the printed logo (logo-normalised radius rho 0..1) and when the print front passes them."""
    rho = 0.97 * np.sqrt(rng.random(n))
    ang = rng.random(n) * 2 * np.pi
    du, dv = 0.5 * rho * np.cos(ang), 0.5 * rho * np.sin(ang)
    zl = P.LOGO_Y + dv * P.LOGO_D
    zs, rs = [p[1] for p in P.CUP_OUTER], [p[0] for p in P.CUP_OUTER]
    rsurf = np.interp(zl, zs, rs)
    a = du * P.LOGO_D / rsurf
    # the material's print front sits at 1.3 v - 0.12 (props.logo_material); land just inside its glowing edge
    t_arr = reveal_time(np.clip((rho + 0.14) / 1.3, 0, 1))
    return rho, a - np.pi / 2, rsurf, CUP_Z + zl, t_arr


def _spark_data(rng):
    n = N_SPARKS
    rho, phi_t, rsurf, z_t, t_arr = _spark_targets(rng, n)
    size = 0.012 + 0.022 * rng.random(n) ** 2
    dur = 0.5 + 0.4 * rng.random(n)
    # counter-clockwise seen from above, never sweeping through the handle (at +0.62 rad)
    turn = 0.6 + rng.random(n) * (np.minimum(3.4, phi_t + 2 * np.pi - HANDLE_ANGLE - 0.6) - 0.6)
    return dict(phi_t=phi_t, r_t=rsurf + 0.006 + size, z_t=z_t, t_arr=t_arr, t0=t_arr - dur, dur=dur, size=size,
                phi0=phi_t - turn, r0=5.5 + 6.5 * rng.random(n), z0=CUP_Z + 1.2 + 9.5 * rng.random(n),
                tw=rng.random(n) * 2 * np.pi, twf=14.0 + 18.0 * rng.random(n), seed=rng.random(n) * 50, rho=rho)


def spark_state(t, d):
    """Positions (N, 3), render radii (N,) and glow (N,, emission scale) of the sparks at time t."""
    s = np.clip((t - d['t0']) / d['dur'], 0.0, 1.0)
    e = s ** 1.7                                           # sink vortex: slow far out, rushing in near the cup
    phi = d['phi0'] + (d['phi_t'] - d['phi0']) * e
    r = d['r_t'] + (d['r0'] - d['r_t']) * (1 - e) ** 1.6
    z = d['z_t'] + (d['z0'] - d['z_t']) * (1 - e) ** 1.3
    # small eddies along the way, gone on arrival
    k = 0.45 * (1 - e) ** 1.5
    tt = t * 0.9
    r = r + k * C.NOISE(d['seed'], tt, 0.3)
    z = z + k * C.NOISE(d['seed'] + 7.1, tt, 1.7)
    phi = phi + k * 0.15 * C.NOISE(d['seed'] + 3.3, tt, 2.9)
    # stay outside the porcelain
    zs, rs = [p[1] + CUP_Z for p in P.CUP_OUTER], [p[0] for p in P.CUP_OUTER]
    inside = (z > CUP_Z) & (z < CUP_Z + 6.2)
    r = np.where(inside, np.maximum(r, np.interp(z, zs, rs) + 0.006 + d['size']), r)
    pos = np.stack([r * np.cos(phi), r * np.sin(phi), z], -1)
    # glow: fade in while flying, flash on landing, then cool exponentially and twinkle
    da = np.maximum(t - d['t_arr'], 0.0)
    cool = np.exp(-SPARK_DECAY * da)
    fly = np.clip(s / 0.25, 0, 1) ** 2 * (0.8 + 0.2 * np.sin(t * d['twf'] + d['tw']))
    land = cool * (0.55 + 0.45 * np.sin(da * d['twf'] + d['tw'])) * (1 + 2.0 * np.exp(-da / 0.06))
    glow = SPARK_GLOW * np.where(t < d['t0'], 0.0, np.where(t < d['t_arr'], fly, land))
    rad = d['size'] * np.where(t < d['t_arr'], 1.0, 0.55 + 0.45 * cool)
    rad = np.where(glow < 0.004, 0.0, rad)
    return pos, rad, glow


def _spark_material():
    """The shared gold_spark emission, scaled per spark by its 'glow' attribute and reddening as the speck cools."""
    em0 = next(n for n in M.get('gold_spark').node_tree.nodes if n.type == 'EMISSION')
    g = M.Graph('cup_spark', principled=False)
    glow = g.attr('glow', 'Fac')
    hot = tuple(em0.inputs['Color'].default_value)
    col = g.mix_rgb(g.math('MULTIPLY', glow, 1.0 / SPARK_GLOW, clamp=True), (1.0, 0.36, 0.07), hot)
    em = g.node('ShaderNodeEmission', {'Color': col, 'Strength': g.math('MULTIPLY', glow, em0.inputs['Strength'].default_value)})
    g.link(em.outputs[0], g.out.inputs['Surface'])
    return g.mat


def _spark_points_group(material):
    ng = bpy.data.node_groups.new('spark_points', 'GeometryNodeTree')
    ng.interface.new_socket('Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')
    ng.interface.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
    N, L = ng.nodes.new, ng.links.new
    gi, go = N('NodeGroupInput'), N('NodeGroupOutput')
    m2p = N('GeometryNodeMeshToPoints')
    rad = N('GeometryNodeInputNamedAttribute')
    rad.data_type = 'FLOAT'
    rad.inputs['Name'].default_value = 'radius'
    setm = N('GeometryNodeSetMaterial')
    setm.inputs['Material'].default_value = material
    L(gi.outputs[0], m2p.inputs['Mesh'])
    L(rad.outputs['Attribute'], m2p.inputs['Radius'])
    L(m2p.outputs[0], setm.inputs['Geometry'])
    L(setm.outputs[0], go.inputs[0])
    return ng


def _sparks(col, rng):
    d = _spark_data(rng)
    np.savez(C.CACHE / 'cup_sparks.npz', **d)
    me = bpy.data.meshes.new('cup_sparks')
    me.vertices.add(N_SPARKS)
    me.attributes.new('radius', 'FLOAT', 'POINT')
    me.attributes.new('glow', 'FLOAT', 'POINT')
    ob = C.obj_new('cup_sparks', me, col)
    ob.modifiers.new('points', 'NODES').node_group = _spark_points_group(_spark_material())
    return ob


# ------------------------------------------------------------------ camera, lights, world
def _cam(t):
    k0 = C.smooth(T0, CRANE[0], t)
    k1 = crane(t)
    push = C.smooth(CRANE[1] - 0.1, T1 + 0.4, t)
    tgt = np.array([0.0, 0.0, C.lerp(CREMA_Z, 3.6, k1)])
    d = math.exp(C.lerp(math.log(C.lerp(17.0, 15.5, k0)), math.log(40.0), k1)) - 3.8 * push
    el = math.radians(C.lerp(89.3, 11.0, k1) - 1.0 * push)
    az = C.lerp(0.34 - 0.08 * k0, 0.0, k1) - 0.05 * push
    pos = tgt + d * np.array([math.cos(el) * math.sin(az), -math.cos(el) * math.cos(az), math.sin(el)])
    pos = pos + np.array([C.noise1(t * 1.3, 21), C.noise1(t * 1.3, 22), C.noise1(t * 1.3, 23)]) * 0.012 * d / 20
    crema_c = np.array([0.0, 0.0, CREMA_Z])
    w = C.smooth(0.35, 0.85, k1)
    focus = C.lerp(float(np.linalg.norm(pos - crema_c)), float(np.linalg.norm(pos - LOGO_PT)), w)
    return dict(pos=pos, target=tgt, roll=0.015 * math.sin(0.9 * t) * (1 - 0.5 * k1), fov=C.lerp(36.0, 26.0, k1),
                focus=focus, fstop=C.lerp(5.6, 8.0, k1))


def _lights(scene, cup):
    frames = range(scene.frame_start - 1, scene.frame_end + 2)
    # softbox with a grid: the beam keeps to the cup and falls off over the foreground (the title sits there)
    key = S.area_light(scene, 'key', 7.0, 1.0, (1.0, 0.92, 0.83), size_y=9.0, spread=38.0)
    key.location = (-21.0, -17.0, 28.0)
    S.aim(key, (0.0, 0.0, 6.5))
    rim = S.area_light(scene, 'rim', 4.0, 0.15, (1.0, 0.76, 0.52), size_y=14.0)
    rim.location = (12.0, 15.0, 11.0)
    S.aim(rim, (0.0, 0.0, 7.0))
    # low behind the cup: shines through the steam towards the lens (forward scattering), the rim shades the crema
    back = S.area_light(scene, 'steam_back', 6.0, 0.12, (1.0, 0.78, 0.55), spread=60.0)
    back.location = (-6.0, 20.0, 9.5)
    S.aim(back, (0.0, 0.0, 11.0))
    fill = S.area_light(scene, 'fill', 26.0, 0.02, (0.92, 0.95, 1.0))
    fill.location = (25.0, -17.0, 9.0)
    S.aim(fill, (0.0, 0.0, 4.0))
    # small overhead softbox mirrored in the crema while the camera looks straight down: the wet sheen of fresh foam
    top = S.area_light(scene, 'top', 4.0, 0.06, (1.0, 0.95, 0.9))
    top.location = (4.9, 4.9, 40.0)
    S.aim(top, (0.0, 0.0, CREMA_Z))
    # glint: a narrow vertical strip swung around the cup. The body's normals face slightly down (the cup widens
    # upwards), so only a source low in front can be mirrored in it; light-linked to the cup and specular only, as a
    # studio would flag it off everything else
    glint = S.area_light(scene, 'glint', 0.9, 1.0, (1.0, 0.96, 0.9), size_y=11.0)
    glint.data.diffuse_factor = 0.0
    recv = bpy.data.collections.new('glint_receivers')
    for k in ('body', 'handle', 'decal'):
        recv.objects.link(cup[k])
    glint.light_linking.receiver_collection = recv
    for f in frames:
        t = C.time_of(f)
        k1 = crane(t)
        # darker on the crema (reads rich, not orange), full key once on the side
        key.data.energy = S.real_watts(C.lerp(0.04, 0.16, C.smooth(0.0, 0.6, k1)))
        key.data.keyframe_insert('energy', frame=f)
        top.data.energy = S.real_watts(0.07 * (1 - C.smooth(0.0, 0.45, k1)))
        top.data.keyframe_insert('energy', frame=f)
        gs = C.smooth(GLINT[0], GLINT[1], t)
        a = math.radians(C.lerp(-115.0, 115.0, gs))           # around the cup, from the front (-y), left to right
        glint.location = (12.0 * math.sin(a), -12.0 * math.cos(a), 5.5)
        S.aim(glint, (0.0, 0.0, 5.5))
        glint.data.energy = S.real_watts(GLINT_POWER * math.sin(math.pi * gs))
        glint.keyframe_insert('location', frame=f)
        glint.keyframe_insert('rotation_quaternion', frame=f)
        glint.data.keyframe_insert('energy', frame=f)
    for ob in (key, top, glint):
        C.set_interpolation(ob, 'LINEAR')
        C.set_interpolation(ob.data, 'LINEAR')


def _world(t):
    # rotation puts the warm wall of photo frames and sconces of the cafe behind the cup
    return (-2.04, 0.04, C.lerp(0.0, 0.2, crane(t)))


# ------------------------------------------------------------------ build
def build(scene):
    col = scene.collection
    rng = np.random.default_rng(55)
    cup, crema = _table(col)
    hf = _myrtle(col, rng)
    _beans(scene, col, rng, hf)
    steam = _steam(col)
    scene['sparks'] = _sparks(col, rng).name
    _animate(scene, cup, crema, steam)
    _lights(scene, cup)
    S.make_camera(scene, 'cam_cup', _cam)
    S.key_world(scene.world, _world, range(scene.frame_start - 1, scene.frame_end + 2))
    attach(scene)


def _animate(scene, cup, crema, steam):
    """Keyed on every frame (and one either side for the shutter): crema spin, print reveal, steam time and amount."""
    crema_ob = crema.ob
    reveal_node = cup['decal_value']
    steam_nt = steam.data.materials[0].node_tree
    tm, amt = steam_nt.nodes['steam_time'], steam_nt.nodes['steam_amount']
    for f in range(scene.frame_start - 1, scene.frame_end + 2):
        t = C.time_of(f)
        crema_ob.rotation_euler.z = CREMA_SPIN * (t - T0)
        crema_ob.keyframe_insert('rotation_euler', index=2, frame=f)
        reveal_node.outputs[0].default_value = reveal(t)
        reveal_node.outputs[0].keyframe_insert('default_value', frame=f)
        tm.outputs[0].default_value = t
        tm.outputs[0].keyframe_insert('default_value', frame=f)
        amt.outputs[0].default_value = steam_amount(t)
        amt.outputs[0].keyframe_insert('default_value', frame=f)
    C.set_interpolation(crema_ob, 'LINEAR')
    C.set_interpolation(reveal_node.id_data, 'LINEAR')
    C.set_interpolation(steam_nt, 'LINEAR')


# ------------------------------------------------------------------ render-time updates
def attach(scene):
    data = dict(np.load(C.CACHE / 'cup_sparks.npz'))
    me = scene.objects[scene.get('sparks', 'cup_sparks')].data

    def update(t):
        pos, rad, glow = spark_state(t, data)
        me.vertices.foreach_set('co', pos.astype(np.float32).ravel())
        me.attributes['radius'].data.foreach_set('value', rad.astype(np.float32))
        me.attributes['glow'].data.foreach_set('value', glow.astype(np.float32))
        me.update()

    C.on_frame(scene.name, update)
    update(C.time_of(scene.frame_current))
