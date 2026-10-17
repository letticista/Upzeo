"""Shared timeline, maths, mesh and scene helpers for the v4 (Blender / Cycles) outro.

Units: 1 Blender unit = 1 cm. Gravity is therefore 981 units/s^2. Time is always in seconds of the final
edit; frame f shows time (f - 1) / FPS, so shots can be re-timed or re-rendered at another frame rate
without touching the shot code.
"""
import math
import os
from pathlib import Path

import bpy
import numpy as np

V4 = Path(__file__).resolve().parents[1]
ROOT = V4.parent                       # sardinian-coffee/
ASSETS = V4 / 'assets'
V3_ASSETS = ROOT / 'v3' / 'assets'     # HDRI, walnut, scanned grounds, logo (already in the repo)
FONT = ROOT / 'assets' / 'Cinzel-Regular.ttf'
CACHE = V4 / 'cache'
FRAMES = V4 / 'frames'
PREVIEW = V4 / 'preview'

FPS = int(os.environ.get('COFFEE_FPS', '60'))
DUR = 12.0
WIDTH, HEIGHT = 1080, 1920             # Full HD, vertical
GRAVITY = 981.0                        # cm/s^2

# edit points (seconds)
T = {
    'beans': 0.0,
    'burrs': 1.0,
    'dose': 2.6,
    'tamp': 3.62,
    'extract': 4.0,
    'cup': 7.2,
    'crane': (7.6, 8.7),
    'reveal': (8.75, 9.7),
    'tag': 9.75,
    'fade': (10.8, 12.0),
}
SHOTS = [('beans', 0.0, 1.0), ('burrs', 1.0, 2.6), ('dose', 2.6, 4.0), ('extract', 4.0, 7.2), ('cup', 7.2, DUR)]


def frame_of(t):
    return int(round(t * FPS)) + 1


def time_of(frame):
    return (frame - 1) / FPS


def shot_range(name):
    """First and last frame (inclusive) of a shot."""
    for n, a, b in SHOTS:
        if n == name:
            return frame_of(a), frame_of(b) - 1
    raise KeyError(name)


# ------------------------------------------------------------------ easing and splines
def clamp(v, a=0.0, b=1.0):
    return min(b, max(a, v))


def lerp(a, b, t):
    return a + (b - a) * t


def smooth(a, b, x):
    t = clamp((x - a) / (b - a))
    return t * t * (3 - 2 * t)


def smoother(a, b, x):
    t = clamp((x - a) / (b - a))
    return t * t * t * (t * (t * 6 - 15) + 10)


def hermite(keys, t):
    """Catmull-Rom style spline through keys [(time, (v0, v1, ...)), ...] with zero end tangents."""
    n = len(keys)
    if t <= keys[0][0]:
        return np.array(keys[0][1], float)
    if t >= keys[-1][0]:
        return np.array(keys[-1][1], float)
    i = 0
    while t > keys[i + 1][0]:
        i += 1
    t0, t1 = keys[i][0], keys[i + 1][0]
    h, s = t1 - t0, (t - t0) / (t1 - t0)

    def tan(k):
        if k == 0 or k == n - 1:
            return np.zeros(len(keys[k][1]))
        a, b = keys[k - 1], keys[k + 1]
        return (np.array(b[1], float) - np.array(a[1], float)) / (b[0] - a[0])

    p0, p1 = np.array(keys[i][1], float), np.array(keys[i + 1][1], float)
    h00, h10, h01, h11 = 2 * s**3 - 3 * s**2 + 1, s**3 - 2 * s**2 + s, -2 * s**3 + 3 * s**2, s**3 - s**2
    return h00 * p0 + h10 * h * tan(i) + h01 * p1 + h11 * h * tan(i + 1)


# ------------------------------------------------------------------ deterministic noise (numpy, vectorised)
class Simplex3:
    """3D simplex noise, seeded, vectorised over numpy arrays. Range about [-1, 1]."""
    _G = np.array([[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
                   [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]], float)

    def __init__(self, seed=0):
        p = np.random.default_rng(seed).permutation(256)
        self.perm = np.concatenate([p, p]).astype(np.int64)

    def __call__(self, x, y, z):
        x, y, z = (np.asarray(v, float) for v in (x, y, z))
        F3, G3 = 1 / 3, 1 / 6
        s = (x + y + z) * F3
        i, j, k = np.floor(x + s), np.floor(y + s), np.floor(z + s)
        t = (i + j + k) * G3
        x0, y0, z0 = x - (i - t), y - (j - t), z - (k - t)
        # simplex corner ordering, same branches as the JS version used in v3
        A, B, C = x0 >= y0, y0 >= z0, x0 >= z0
        a1, a2, a3 = A & B, A & ~B & C, A & ~B & ~C
        b1, b2, b3 = ~A & ~B, ~A & B & ~C, ~A & B & C
        f = lambda m: m.astype(float)
        i1, j1, k1 = f(a1 | a2), f(b2 | b3), f(a3 | b1)
        i2, j2, k2 = f(A | b3), f(a1 | ~A), f(a2 | a3 | b1 | b2)
        ii, jj, kk = i.astype(np.int64) & 255, j.astype(np.int64) & 255, k.astype(np.int64) & 255
        P = self.perm

        def corner(dx, dy, dz, gi):
            tt = 0.6 - dx * dx - dy * dy - dz * dz
            g = self._G[gi % 12]
            v = (tt > 0) * tt**4 * (g[..., 0] * dx + g[..., 1] * dy + g[..., 2] * dz)
            return v

        n0 = corner(x0, y0, z0, P[ii + P[jj + P[kk]]])
        x1, y1, z1 = x0 - i1 + G3, y0 - j1 + G3, z0 - k1 + G3
        n1 = corner(x1, y1, z1, P[ii + i1.astype(np.int64) + P[jj + j1.astype(np.int64) + P[kk + k1.astype(np.int64)]]])
        x2, y2, z2 = x0 - i2 + 2 * G3, y0 - j2 + 2 * G3, z0 - k2 + 2 * G3
        n2 = corner(x2, y2, z2, P[ii + i2.astype(np.int64) + P[jj + j2.astype(np.int64) + P[kk + k2.astype(np.int64)]]])
        x3, y3, z3 = x0 - 1 + 3 * G3, y0 - 1 + 3 * G3, z0 - 1 + 3 * G3
        n3 = corner(x3, y3, z3, P[ii + 1 + P[jj + 1 + P[kk + 1]]])
        return 32.0 * (n0 + n1 + n2 + n3)


NOISE = Simplex3(21)


def fbm(x, y, z, octaves=4, noise=NOISE):
    s, a, f = 0.0, 0.5, 1.0
    for _ in range(octaves):
        s = s + a * noise(x * f, y * f, z * f)
        a *= 0.5
        f *= 2.03
    return s


def noise1(t, seed):
    """Smooth scalar noise of time for camera shake and wobble."""
    return float(NOISE(t, seed * 3.1, 0.5 + seed * 0.17))


# ------------------------------------------------------------------ mesh helpers
def mesh_from_arrays(name, verts, faces, uv=None, smooth_shade=True):
    """Build a mesh from a (N, 3) vertex array and a list or (M, k) array of polygons."""
    verts = np.asarray(verts, np.float32).reshape(-1, 3)
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(verts))
    me.vertices.foreach_set('co', verts.ravel())
    if isinstance(faces, np.ndarray):
        loops = faces.reshape(-1).astype(np.int32)
        sizes = np.full(len(faces), faces.shape[1], np.int32)
    else:
        loops = np.fromiter((i for f in faces for i in f), np.int32)
        sizes = np.fromiter((len(f) for f in faces), np.int32)
    me.loops.add(len(loops))
    me.loops.foreach_set('vertex_index', loops)
    me.polygons.add(len(sizes))
    starts = np.concatenate([[0], np.cumsum(sizes)[:-1]]).astype(np.int32)
    me.polygons.foreach_set('loop_start', starts)
    if uv is not None:
        uv = np.asarray(uv, np.float32).reshape(-1, 2)
        layer = me.uv_layers.new(name='UVMap')
        layer.data.foreach_set('uv', uv[loops].ravel())
    me.update(calc_edges=True)
    me.validate(clean_customdata=False)
    if smooth_shade:
        me.shade_smooth()
    return me


def obj_new(name, data, collection, parent=None):
    ob = bpy.data.objects.new(name, data)
    collection.objects.link(ob)
    if parent is not None:
        ob.parent = parent
    return ob


def lathe(profile, segs=128):
    """Surface of revolution around +Z (Blender up) from [(r, z), ...]. Outward normals when the profile
    runs from the axis outward and upward (like a cup seen from outside). Returns verts, quads, uvs per vertex."""
    prof = np.asarray(profile, float)
    n = len(prof)
    a = np.linspace(0, 2 * np.pi, segs, endpoint=False)
    r, z = prof[:, 0][None, :], prof[:, 1][None, :]
    verts = np.stack([np.cos(a)[:, None] * r, np.sin(a)[:, None] * r, np.repeat(z, segs, 0)], -1).reshape(-1, 3)
    faces = []
    for i in range(segs):
        i2 = (i + 1) % segs
        for j in range(n - 1):
            faces.append((i * n + j, i2 * n + j, i2 * n + j + 1, i * n + j + 1))
    length = np.concatenate([[0], np.cumsum(np.hypot(np.diff(prof[:, 0]), np.diff(prof[:, 1])))])
    uv = np.stack([np.repeat((np.arange(segs) / segs)[:, None], n, 1), np.repeat((length / max(length[-1], 1e-9))[None, :], segs, 0)], -1).reshape(-1, 2)
    return verts, np.array(faces, np.int32), uv


def grid_disk(rings, segs, radius=1.0, power=1.0):
    """Polar grid disk in the XY plane facing +Z: centre vertex, then rings. power > 1 packs rings near the centre."""
    verts = [(0.0, 0.0, 0.0)]
    for k in range(1, rings + 1):
        rr = radius * (k / rings) ** power
        a = np.linspace(0, 2 * np.pi, segs, endpoint=False)
        verts.extend(zip(np.cos(a) * rr, np.sin(a) * rr, np.zeros(segs)))
    vid = lambda k, s: 0 if k == 0 else 1 + (k - 1) * segs + (s % segs)
    faces = [(0, vid(1, s), vid(1, s + 1)) for s in range(segs)]
    for k in range(1, rings):
        for s in range(segs):
            faces.append((vid(k, s), vid(k + 1, s), vid(k + 1, s + 1), vid(k, s + 1)))
    return np.array(verts, float), faces


# ------------------------------------------------------------------ animation helpers
def fcurves(id_data):
    from bpy_extras import anim_utils
    ad = id_data.animation_data
    if ad is None or ad.action is None:
        return []
    cb = anim_utils.animdata_get_channelbag_for_assigned_slot(ad)
    return list(cb.fcurves) if cb else []


def set_interpolation(id_data, kind='LINEAR'):
    for fc in fcurves(id_data):
        for kp in fc.keyframe_points:
            kp.interpolation = kind


def key(id_data, path, frame, value=None, index=-1):
    if value is not None:
        target = id_data
        attr = path
        if '.' in path:
            *parts, attr = path.split('.')
            for p in parts:
                target = getattr(target, p)
        setattr(target, attr, value)
    id_data.keyframe_insert(path, frame=frame, index=index)


def key_visibility(ob, shown):
    """shown: list of (frame, bool). Constant interpolation of hide_render / hide_viewport."""
    for f, v in shown:
        ob.hide_render = not v
        ob.keyframe_insert('hide_render', frame=f)
    set_interpolation(ob, 'CONSTANT')


def look_at_quaternion(pos, target, roll=0.0):
    from mathutils import Vector
    d = Vector(target) - Vector(pos)
    q = d.to_track_quat('-Z', 'Y')
    if roll:
        from mathutils import Quaternion
        q = q @ Quaternion((0, 0, 1), roll)
    return q


def fov_to_lens(fov_deg_vertical, sensor_h=36.0):
    """Focal length for a vertical field of view on a sensor fitted vertically (portrait 9:16)."""
    return sensor_h / (2 * math.tan(math.radians(fov_deg_vertical) / 2))


# ------------------------------------------------------------------ per-frame updates during render
_UPDATERS = {}


def on_frame(scene_name, fn):
    """Register fn(t) to run before every (sub)frame of that scene, including motion blur sub-frames."""
    _UPDATERS.setdefault(scene_name, []).append(fn)


def _dispatch(scene, *_):
    fns = _UPDATERS.get(scene.name)
    if fns:
        t = time_of(scene.frame_current_final)
        for fn in fns:
            fn(t)


def install_handlers():
    hs = bpy.app.handlers.frame_change_pre
    for h in list(hs):
        if getattr(h, '__name__', '') == '_dispatch':
            hs.remove(h)
    hs.append(_dispatch)


def clear_updaters():
    _UPDATERS.clear()
