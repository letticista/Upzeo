"""Crema in the cup: a closed foam slab (random-walk subsurface needs a closed mesh) floating on the coffee, with a
few large bubbles at the wall and on the surface. Shared by the extraction shot (crema forming under the stream) and the
cup shot (settled crema).

    c = build_crema(col, parent, name='crema')        # radius follows the cup's inner wall at the current level
    c.set_level(z)                                      # move to a fill level (keyable through the returned object)
    c.write_top(heights, fresh, age)                    # per-vertex top surface update (extraction), arrays of len(c.top)
"""
import math

import bmesh
import bpy
import numpy as np

from . import common as C
from . import materials as M
from .props import CUP_INNER, interp

THICK = 0.3      # 3 mm of foam on a fresh double


class Crema:
    def __init__(self, ob, top_count, rings, segs, bubbles):
        self.ob, self.top_count, self.rings, self.segs, self.bubbles = ob, top_count, rings, segs, bubbles
        me = ob.data
        co = np.zeros(len(me.vertices) * 3, np.float32)
        me.vertices.foreach_get('co', co)
        self.base = co.reshape(-1, 3)                     # unit-radius layout, z = 0 top / -THICK bottom
        self.unit_r = np.hypot(self.base[:self.top_count, 0], self.base[:self.top_count, 1])
        self.theta = np.arctan2(self.base[:self.top_count, 1], self.base[:self.top_count, 0])

    def radius_at(self, level):
        return interp(CUP_INNER, level) - 0.012

    def set_level(self, level, frame=None):
        R = self.radius_at(level)
        self.ob.location.z = level
        self.ob.scale = (R, R, 1.0)
        if frame is not None:
            self.ob.keyframe_insert('location', index=2, frame=frame)
            self.ob.keyframe_insert('scale', frame=frame)

    def write_top(self, heights, fresh=None, age=None, rim=None):
        me = self.ob.data
        co = self.base.copy()
        co[:self.top_count, 2] = heights
        me.vertices.foreach_set('co', co.ravel())
        for name, arr in (('fresh', fresh), ('age', age), ('rim', rim)):
            if arr is not None:
                full = np.zeros(len(me.vertices), np.float32)
                full[:self.top_count] = arr
                full[self.top_count:] = arr if name != 'fresh' else 0.0
                me.attributes[name].data.foreach_set('value', full)
        me.update()


def build_crema(col, parent=None, name='crema', rings=140, segs=420, n_bubbles=160, seed=5):
    """Closed slab: top grid (unit radius, z=0), bottom grid (z=-THICK), side wall. Scale x/y by the cup radius."""
    v, f = C.grid_disk(rings, segs, 1.0, power=0.9)
    top = v.copy()
    # meniscus: foam climbs ~1 mm up the porcelain, and the centre is a hair lower
    r = np.hypot(top[:, 0], top[:, 1])
    top[:, 2] = 0.1 * r ** 14 - 0.02 * (1 - r ** 2)
    bot = v.copy()
    bot[:, 2] = -THICK
    n = len(v)
    faces = [tuple(x) for x in f] + [tuple(i + n for i in reversed(x)) for x in f]
    outer0 = 1 + (rings - 1) * segs
    for s in range(segs):
        a, b = outer0 + s, outer0 + (s + 1) % segs
        faces.append((a, b, b + n, a + n)[::-1])
    me = C.mesh_from_arrays(name, np.concatenate([top, bot]), faces)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(me)
    bm.free()
    me.shade_smooth()
    for a in ('rim', 'fresh', 'age'):
        me.attributes.new(a, 'FLOAT', 'POINT')
    rr = np.concatenate([r, r]).astype(np.float32)
    me.attributes['rim'].data.foreach_set('value', rr)
    me.attributes['age'].data.foreach_set('value', (rr ** 3 * 0.6).astype(np.float32))
    me.materials.append(M.get('crema'))
    ob = C.obj_new(name, me, col, parent)
    bubbles = _bubbles(col, ob, n_bubbles, seed, name)
    return Crema(ob, n, rings, segs, bubbles)


def _bubbles(col, crema_ob, n, seed, name):
    """A few large bubbles (0.2-1.5 mm): most along the wall meniscus, some scattered. Children of the slab, so they follow
    its level and radius; they sit on the top surface (unit radius coordinates, compensated for the slab's x/y scale)."""
    rng = np.random.default_rng(seed)
    me = bpy.data.meshes.new(f'{name}_bubble')
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=12, radius=1.0)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -0.05], context='VERTS')   # a cap sitting on the foam
    bm.to_mesh(me)
    bm.free()
    me.shade_smooth()
    me.materials.append(M.get('bubble'))
    obs = []
    for i in range(n):
        wall = rng.random() < 0.65
        rr = 0.93 + 0.06 * rng.random() if wall else math.sqrt(rng.random()) * 0.9
        a = rng.random() * 2 * math.pi
        size = (0.01 + 0.065 * rng.random() ** 2.5) if wall else (0.008 + 0.03 * rng.random() ** 3)
        ob = C.obj_new(f'{name}_bubble{i}', me, col, crema_ob)
        z = 0.1 * rr ** 14 - 0.02 * (1 - rr ** 2)
        ob.location = (rr * math.cos(a), rr * math.sin(a), z)
        ob['size'] = size
        obs.append(ob)
    return obs


def fit_bubbles(crema, R):
    """Keep bubbles round although the slab is scaled by the cup radius R in x and y."""
    for ob in crema.bubbles:
        s = ob['size']
        ob.scale = (s / R, s / R, s * 0.8)
