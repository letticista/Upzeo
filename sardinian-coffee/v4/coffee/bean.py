"""Roasted coffee bean geometry and Voronoi fracture (bmesh bisect, no add-on needed).

A roasted arabica bean is about 11.2 x 8.2 x 4.7 mm (calliper means of five lots): an ellipsoid with one flattened side carrying the centre cut
(the groove, lined with silverskin). Fragments are convex Voronoi cells clipped by the bean surface; the cut faces
get material slot 1 (the porous inside of the bean).
"""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Vector

from .common import NOISE

BEAN_SIZE = (1.12, 0.82, 0.47)  # cm: length (y), width (x), thickness (z)


def bean_bmesh(seed=0, res=48):
    """Closed bean surface, y = long axis, +z = flat side with the groove. Vertex float layer 'groove' (0..1)."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=res, v_segments=res // 2, radius=1.0)
    rng = np.random.default_rng(seed)
    sx, sy, sz = BEAN_SIZE[1] / 2, BEAN_SIZE[0] / 2, BEAN_SIZE[2] / 2
    jitter = 1.0 + 0.05 * (rng.random(3) - 0.5)
    sx, sy, sz = sx * jitter[0], sy * jitter[1], sz * jitter[2]
    bend = 0.06 * (rng.random() - 0.5)
    gl = bm.verts.layers.float.new('groove')
    off = rng.random(3) * 50
    for v in bm.verts:
        x, y, z = v.co
        # flatten the cut side, keep the back domed
        if z > 0:
            z *= 0.55 + 0.2 * (1 - abs(y))
        # the centre cut: a narrow S-shaped valley along y on the flat side
        cx = 0.07 * math.sin(y * 2.4 + bend * 20)
        ends = 1 - abs(y) ** 5
        groove = math.exp(-((x - cx) / 0.075) ** 2) * ends * (1.0 if z > -0.1 else 0.0)
        z -= groove * 0.32 * max(0.0, min(1.0, (z + 0.05) / 0.3))
        # lumpy, not a perfect ellipsoid
        lump = 1 + 0.045 * float(NOISE(x * 2.2 + off[0], y * 2.2 + off[1], z * 2.2 + off[2]))
        v.co = Vector((x * sx * lump, (y + bend * x * x) * sy * lump, z * sz * lump))
        v[gl] = groove
    for f in bm.faces:
        f.smooth = True
    return bm


def bean_mesh(name, seed=0, res=48):
    bm = bean_bmesh(seed, res)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return me


def _inside_ellipsoid_points(n, rng, scale=0.8):
    pts = []
    while len(pts) < n:
        p = (rng.random(3) * 2 - 1)
        if np.dot(p, p) <= 1:
            pts.append(p * scale * np.array([BEAN_SIZE[1] / 2, BEAN_SIZE[0] / 2, BEAN_SIZE[2] / 2 * 0.7]))
    return np.array(pts)


def fracture(src_bm, n_cells=10, seed=0, shrink=0.0015):
    """Split a closed bmesh into convex-cell fragments. Returns [(bmesh, centroid Vector)], fragment meshes in the
    original coordinates. Cut faces get material_index 1. Each fragment is shrunk by `shrink` cm towards its centroid
    so neighbouring convex hulls do not start interpenetrating."""
    rng = np.random.default_rng(seed)
    seeds = _inside_ellipsoid_points(n_cells, rng)
    out = []
    for i, si in enumerate(seeds):
        bm = src_bm.copy()
        for f in bm.faces:
            f.material_index = 0
        for j, sj in enumerate(seeds):
            if i == j:
                continue
            mid = (si + sj) / 2
            nrm = sj - si
            nrm = nrm / np.linalg.norm(nrm)
            geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
            res = bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-6, plane_co=Vector(mid), plane_no=Vector(nrm), clear_outer=True, clear_inner=False)
            cut_edges = [e for e in res['geom_cut'] if isinstance(e, bmesh.types.BMEdge)]
            if not bm.verts:
                break
            boundary = [e for e in cut_edges if e.is_boundary]
            if boundary:
                filled = bmesh.ops.holes_fill(bm, edges=boundary, sides=0)
                for f in filled['faces']:
                    f.material_index = 1
                    f.smooth = False
        if len(bm.verts) < 4:
            bm.free()
            continue
        bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4 and f.material_index == 1])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        c = Vector((0, 0, 0))
        for v in bm.verts:
            c += v.co
        c /= len(bm.verts)
        if shrink:
            for v in bm.verts:
                d = v.co - c
                L = d.length
                if L > 1e-6:
                    v.co = c + d * max(0.0, (L - shrink) / L)
        out.append((bm, c))
    return out


def fragment_meshes(name, src_bm, n_cells=10, seed=0, materials=()):
    """Meshes of the fragments with origin at each fragment's centroid. Returns [(mesh, centroid)]."""
    res = []
    for k, (bm, c) in enumerate(fracture(src_bm, n_cells, seed)):
        for v in bm.verts:
            v.co -= c
        me = bpy.data.meshes.new(f'{name}_frag{k}')
        bm.to_mesh(me)
        bm.free()
        for m in materials:
            me.materials.append(m)
        res.append((me, c.copy()))
    return res
