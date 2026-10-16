"""Props shared by several shots: espresso cup with logo decal, saucer, bottomless portafilter, group head and
machine front, tamper, table set pieces. Real dimensions in cm, Z up."""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Vector

from . import common as C
from . import materials as M

# espresso cup: outer and inner wall profiles (r, z)
CUP_OUTER = [(2.2, 0.6), (2.55, 0.9), (2.85, 1.6), (3.05, 2.6), (3.2, 3.8), (3.28, 5.0), (3.32, 5.8), (3.335, 6.0)]
CUP_INNER = [(0.001, 0.84), (1.3, 0.88), (2.05, 1.07), (2.48, 1.6), (2.75, 2.6), (2.92, 3.8), (3.01, 5.0), (3.07, 5.8)]
CUP_FILL = 4.85        # level of a full espresso
LOGO_D, LOGO_Y = 4.6, 3.45

FLOOR_Z = -2.4         # underside of the basket floor, portafilter local
BASKET_R = 2.82


def interp(profile, z):
    """Radius of a (r, z) profile at height z."""
    rs = [p[0] for p in profile]
    zs = [p[1] for p in profile]
    return float(np.interp(z, zs, rs))


def mesh_obj(name, verts, faces, col, mat=None, uv=None, smooth=True, parent=None):
    me = C.mesh_from_arrays(name, verts, faces, uv, smooth)
    if mat is not None:
        me.materials.append(mat)
    return C.obj_new(name, me, col, parent)


def lathe_obj(name, profile, col, mat, segs=192, parent=None):
    v, f, uv = C.lathe(profile, segs)
    return mesh_obj(name, v, f, col, mat, uv, True, parent)


def tube_along(points, radius, segs_len=96, segs_round=24, scale=(1.0, 1.0)):
    """Closed-section tube along a Catmull-Rom spline through points (list of xyz)."""
    P = np.asarray(points, float)
    n = len(P)

    def cr(t):
        i = min(int(t), n - 2)
        u = t - i
        p0, p1, p2, p3 = P[max(i - 1, 0)], P[i], P[i + 1], P[min(i + 2, n - 1)]
        return 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3)

    ts = np.linspace(0, n - 1 - 1e-6, segs_len)
    C_ = np.array([cr(t) for t in ts])
    T = np.gradient(C_, axis=0)
    T /= np.linalg.norm(T, axis=1, keepdims=True)
    ref = np.array([0.0, 0.0, 1.0]) if abs(T[0][2]) < 0.9 else np.array([1.0, 0.0, 0.0])
    verts = []
    nprev = None
    for k in range(segs_len):
        nrm = np.cross(T[k], ref) if nprev is None else nprev - T[k] * np.dot(nprev, T[k])
        nrm /= np.linalg.norm(nrm)
        b = np.cross(T[k], nrm)
        nprev = nrm
        for j in range(segs_round):
            a = 2 * math.pi * j / segs_round
            verts.append(C_[k] + radius * (scale[0] * math.cos(a) * nrm + scale[1] * math.sin(a) * b))
    faces = []
    for k in range(segs_len - 1):
        for j in range(segs_round):
            j2 = (j + 1) % segs_round
            faces.append((k * segs_round + j, k * segs_round + j2, (k + 1) * segs_round + j2, (k + 1) * segs_round + j))
    # end caps
    faces.append(tuple(range(segs_round))[::-1])
    faces.append(tuple((segs_len - 1) * segs_round + j for j in range(segs_round)))
    return np.array(verts), faces


# ------------------------------------------------------------------ cup, saucer
def build_cup(col, name='cup', logo=True):
    """Glazed porcelain espresso cup. Returns dict(root, body, decal, decal_value, crema)."""
    root = bpy.data.objects.new(name, None)
    col.objects.link(root)
    prof = [(0.001, 0.0), (1.55, 0.0), (1.72, 0.04), (1.8, 0.2), (1.82, 0.38), (1.95, 0.5), *CUP_OUTER,
            (3.32, 6.1), (3.26, 6.16), (3.18, 6.15), (3.12, 6.08), *reversed(CUP_INNER)]
    body = lathe_obj(f'{name}_body', prof, col, M.get('porcelain'), 256, root)
    hv, hf = tube_along([(3.1, 0, 5.15), (4.35, 0, 5.3), (5.2, 0, 4.6), (5.25, 0, 3.35), (4.5, 0, 2.35), (2.8, 0, 2.0)], 0.36, 120, 28, (0.8, 1.0))
    handle = mesh_obj(f'{name}_handle', hv, hf, col, M.get('porcelain'), parent=root)
    handle.rotation_euler = (0, 0, 0.62)
    out = {'root': root, 'body': body, 'handle': handle}
    if logo:
        out.update(build_logo_decal(col, root, name))
    return out


def build_logo_decal(col, parent, name):
    """Logo printed on the cup wall: a thin shell following the tapered wall, UVs by arc length so the round logo stays
    round. The reveal is a keyable value node 'reveal' (0 hidden .. 1 printed) with a glowing edge."""
    NA, NZ, half = 140, 110, LOGO_D / 2 + 0.05
    amax = (half + 0.05) / interp(CUP_OUTER, LOGO_Y - half)
    verts, uvs = [], []
    for j in range(NZ + 1):
        z = LOGO_Y - half + 2 * half * j / NZ
        r = interp(CUP_OUTER, z) + 0.004
        for i in range(NA + 1):
            a = -amax + 2 * amax * i / NA
            verts.append((r * math.sin(a), -r * math.cos(a), z))
            uvs.append((0.5 + a * r / LOGO_D, 0.5 + (z - LOGO_Y) / LOGO_D))
    faces = []
    for j in range(NZ):
        for i in range(NA):
            a = j * (NA + 1) + i
            b = a + NA + 1
            faces.append((a, a + 1, b + 1, b))
    me = C.mesh_from_arrays(f'{name}_logo', verts, faces)
    uvl = me.uv_layers.new(name='UVMap')
    loops = np.zeros(len(me.loops), np.int32)
    me.loops.foreach_get('vertex_index', loops)
    uvl.data.foreach_set('uv', np.asarray(uvs, np.float32)[loops].ravel())
    mat = logo_material(name)
    me.materials.append(mat)
    ob = C.obj_new(f'{name}_logo', me, col, parent)
    return {'decal': ob, 'decal_value': mat.node_tree.nodes['reveal']}


def logo_material(name):
    g = M.Graph(f'{name}_logo_print')
    img = g.image(C.V3_ASSETS / 'logo.png', 'sRGB', g.coord('UV'), 'Cubic', 'CLIP')
    reveal = g.node('ShaderNodeValue')
    reveal.name = 'reveal'
    reveal.outputs[0].default_value = 0.0
    uv = g.node('ShaderNodeSeparateXYZ', {'Vector': g.coord('UV')})
    dx = g.math('SUBTRACT', uv.outputs['X'], 0.5)
    dy = g.math('SUBTRACT', uv.outputs['Y'], 0.5)
    rr = g.math('MULTIPLY', g.math('SQRT', g.math('ADD', g.math('MULTIPLY', dx, dx), g.math('MULTIPLY', dy, dy))), 2.0)
    wob = g.noise(g.coord('UV'), 9.0, detail=2.0)
    rw = g.math('ADD', rr, g.map_range(wob.outputs['Fac'], 0.3, 0.7, -0.03, 0.03))
    front = g.math('SUBTRACT', g.math('MULTIPLY', reveal.outputs[0], 1.3), 0.12)
    mask = g.math('SUBTRACT', 1.0, g.map_range(g.math('SUBTRACT', rw, front), -0.025, 0.005, 0.0, 1.0))
    edge = g.math('MULTIPLY', g.map_range(g.math('SUBTRACT', rw, front), -0.16, -0.05, 0.0, 1.0),
                  g.map_range(g.math('SUBTRACT', rw, front), -0.05, -0.01, 1.0, 0.0))
    alpha = g.math('MULTIPLY', img.outputs['Alpha'], mask)
    # ceramic transfer: printed colour under the glaze; the edge of the print glows while it spreads
    glow = g.math('MULTIPLY', g.math('MULTIPLY', edge, img.outputs['Alpha']), g.math('SUBTRACT', 1.0, g.map_range(reveal.outputs[0], 0.9, 1.0, 0.0, 1.0)))
    g.p(Base_Color=img.outputs['Color'], Roughness=0.12, Coat_Weight=1.0, Coat_Roughness=0.02, IOR=1.5,
        Emission_Color=(1.0, 0.62, 0.25), Emission_Strength=g.math('MULTIPLY', glow, 6.0))
    transp = g.node('ShaderNodeBsdfTransparent')
    mix = g.node('ShaderNodeMixShader')
    g.link(alpha, mix.inputs[0])
    g.link(transp.outputs[0], mix.inputs[1])
    g.link(g.bsdf.outputs[0], mix.inputs[2])
    g.link(mix.outputs[0], g.out.inputs['Surface'])
    return g.mat


def build_saucer(col, name='saucer'):
    prof = [(0.001, 0.0), (3.5, 0.0), (3.7, 0.06), (3.8, 0.28), (4.3, 0.34), (6.2, 0.56), (7.05, 0.9), (7.25, 1.08),
            (7.22, 1.17), (7.05, 1.12), (6.2, 0.82), (4.4, 0.66), (3.9, 0.7), (3.3, 0.64), (0.001, 0.64)]
    return lathe_obj(name, prof, col, M.get('porcelain'), 256)


# ------------------------------------------------------------------ portafilter (bottomless), tamper, machine
def build_portafilter(col, name='portafilter'):
    """Bottomless portafilter: copper ring with a lip, stainless basket, perforated floor, walnut grip.
    Local origin at the basket rim centre; the floor underside is at z = FLOOR_Z."""
    root = bpy.data.objects.new(name, None)
    col.objects.link(root)
    lathe_obj(f'{name}_ring', [(2.4, -2.34), (2.4, -2.5), (2.5, -2.82), (2.74, -2.97), (3.06, -2.82), (3.25, -2.3),
                               (3.45, -1.2), (3.55, -0.2), (3.62, 0.0), (3.62, 0.18), (3.45, 0.26), (3.1, 0.22)], col, M.get('copper'), 256, root)
    lathe_obj(f'{name}_basket', [(3.09, 0.24), (2.98, 0.12), (2.93, -0.5), (2.86, -1.8), (2.76, -2.25), (2.5, -2.32), (0.001, -2.33)],
              col, M.get('steel'), 256, root)
    # perforated floor seen from below, UV 0..1 over 4.8 cm (matches the hole mask)
    v, f = C.grid_disk(64, 256, 2.62)
    v[:, 2] = FLOOR_Z
    uv = v[:, :2] / 4.8 + 0.5
    floor = mesh_obj(f'{name}_floor', v, [tuple(reversed(x)) for x in f], col, M.get('basket_floor'), uv, True, root)
    for s in (-1, 1):
        lug_me = bpy.data.meshes.new(f'{name}_lug')
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=(1.0, 1.5, 0.42), verts=bm.verts)
        bmesh.ops.bevel(bm, geom=bm.edges[:], offset=0.16, segments=4, affect='EDGES')
        bm.to_mesh(lug_me)
        bm.free()
        lug_me.shade_smooth()
        lug_me.materials.append(M.get('copper'))
        lug = C.obj_new(f'{name}_lug{s}', lug_me, col, root)
        lug.location = (0, s * 3.9, -0.32)
    arm = bpy.data.objects.new(f'{name}_arm', None)
    col.objects.link(arm)
    arm.parent = root
    arm.location = (3.2, 0, -1.3)
    arm.rotation_euler = (0, 0.12, 0)
    lathe_obj(f'{name}_neck', [(0.001, 0), (0.72, 0), (0.62, 3.2), (0.001, 3.2)], col, M.get('copper'), 96, arm).rotation_euler = (0, math.pi / 2, 0)
    lathe_obj(f'{name}_grip', [(0.001, 0), (0.78, 0), (0.98, 0.6), (1.16, 3.4), (1.22, 6.0), (1.08, 8.4), (0.82, 9.3), (0.001, 9.5)],
              col, M.get('walnut'), 128, arm)
    grip = bpy.data.objects[f'{name}_grip']
    grip.location = (3.3, 0, 0)
    grip.rotation_euler = (0, math.pi / 2, 0)
    return {'root': root, 'floor': floor}


def build_tamper(col, name='tamper'):
    root = bpy.data.objects.new(name, None)
    col.objects.link(root)
    lathe_obj(f'{name}_base', [(0.001, 0.0), (2.78, 0.0), (2.8, 0.03), (2.8, 0.78), (2.7, 0.8), (0.001, 0.8)], col, M.get('chrome'), 192, root)
    lathe_obj(f'{name}_neck', [(0.001, 0.8), (0.85, 0.8), (0.55, 3.0), (0.001, 3.0)], col, M.get('copper'), 96, root)
    lathe_obj(f'{name}_knob', [(0.001, 2.9), (0.9, 2.95), (1.5, 3.8), (1.75, 5.1), (1.55, 6.3), (0.9, 6.9), (0.001, 7.0)], col, M.get('walnut'), 128, root)
    return root


def build_group_head(col, name='machine'):
    root = bpy.data.objects.new(name, None)
    col.objects.link(root)
    lathe_obj(f'{name}_group', [(0.001, 0.28), (3.35, 0.28), (3.72, 0.38), (3.86, 0.7), (3.86, 2.6), (4.3, 3.0), (4.55, 3.4), (4.55, 12)], col, M.get('chrome'), 192, root)
    tv, tf = tube_along([(3.45 * math.cos(a), 3.45 * math.sin(a), 0.3) for a in np.linspace(0, 2 * math.pi, 64)], 0.12, 200, 12)
    mesh_obj(f'{name}_gasket', tv, tf, col, M.get('rubber'), parent=root)
    box = lambda n, size, loc, mat: _box(f'{name}_{n}', size, loc, col, mat, root)
    box('body', (34, 18, 14), (0, 4, 17), M.get('steel_dark'))
    box('splash', (40, 0.4, 30), (0, 9, -6), M.get('backsplash'))
    box('tray', (30, 16, 1), (0, 0, -16.0), M.get('steel_dark'))
    for i in range(-7, 8):
        box(f'slot{i}', (1.0, 14, 0.1), (i * 1.9, 0, -15.46), M.get('rubber'))
    return root


def _box(name, size, loc, col, mat, parent):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    bmesh.ops.bevel(bm, geom=bm.edges[:], offset=min(min(size) * 0.2, 0.15), segments=3, affect='EDGES')
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    ob = C.obj_new(name, me, col, parent)
    ob.location = loc
    return ob
