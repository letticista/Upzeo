"""Shot 3: the dose. Freshly ground espresso falls from the grinder's chute into a bottomless portafilter, builds a heap,
the flow tapers off, a tamper comes down, presses the bed into a flat puck and lifts away.

Time scale: gentle slow motion, SLOWMO = 0.5 real seconds per screen second (120 fps footage played at 60), so a grain
takes ~9 frames to fall from the spout to the heap. The one cheat is the grinder's throughput: a real E6C delivers
2.5-3.5 g/s at espresso settings, i.e. 6 s for an 18 g dose; the edit allows ~0.85 s of screen (0.43 s real), so the
stream carries the dose about 14x faster than the grinder would. Every rendered grain or clump is a super-particle that
stands for ~13 identical copies of itself (all of them carry the 18 g together); everything else is physical.

Physics (numpy, coffee/dose_sim.py, 16 sub-steps per frame, all forces in real seconds):
- emission: grains leave the 12 mm stainless spout at 0.3-0.6 m/s along its 12 degree lean, off-centre (they slide down
  the lower wall of the inclined bore), with 2.5-4 degrees of spread; the stream pulses at the burr carrier frequency
  (1480 rpm = 24.7 Hz real) and sways slightly as the chute empties. Bimodal grind: coarse mode 0.25-0.35 mm chips
  (envelope density 0.65 g/cm^3 like the bean, cells keep their roast pores), clumps 0.5-1.5 mm (0.42 g/cm^3, half the
  mass, commoner in the last grams), airborne fines agglomerates 60-120 um (1.2 g/cm^3, cell wall fragments).
- flight: gravity 981 cm/s^2 and Schiller-Naumann drag, Cd = 24/Re (1 + 0.15 Re^0.687) x 1.3 for non-spherical chips,
  air 1.2 kg/m^3, 1.81e-5 Pa s. A lone 0.3 mm grain has a terminal speed of ~0.8 m/s, so it lags behind the stream; the
  stream drags air along (co-flow at half its speed in a Gaussian core that widens with the fall, entrainment towards
  it, radial outflow where it stagnates on the heap) and the fines trace that air plus synthetic turbulence (random
  divergence-free Fourier modes, Kolmogorov amplitudes): they haze around the stream and puff out over the heap.
- bed: a 0.47 mm height field inside the basket. Each step's landed mass becomes volume at the loose bulk density
  0.33 g/cm^3 (18 g -> 54.5 cm^3) and coats the heap as a cone at the local angle of repose (45 +- 2.5 degrees:
  fine, slightly cohesive grounds), clipped by the old surface and the basket wall - the fast-avalanche limit of a
  sandpile, since surface flows (0.2-0.5 m/s) outrun the heap's growth. Volume is conserved exactly (apex by bisection).
  Landed grains slide (mu 0.72) and clumps roll (mu 0.45) down the slopes until new grounds cover them.
- tamp: the tamper face is a ceiling for the field; material above it is plowed sideways into free space under the
  face (a mobile layer diffusing cell to cell) and compacted once there is none. The puck ends flat at z = -0.62
  (0.86 cm below the rim), 42.5 cm^3: 0.42 g/cm^3, the measured density of a dry espresso puck (packing fraction 0.65
  of 0.65 g/cm^3 particles). The 1.2 mm gap between the 56 mm chrome base and the wall keeps a 0.6 mm ridge.
  Air pushed out through that gap as the base enters the basket blows a small puff of fines over the rim (gap jet
  ~0.6 m/s, decaying in 15 ms; fines relax to the air in 4 ms and settle at 4 cm/s).
Sources: Illy & Viani, Espresso Coffee (2005) for bean and grounds densities; Schiller & Naumann (1933) drag;
Corrochano et al. (2015) for dry espresso bed density; Ceado E37/E6 series data for throughput.
"""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Quaternion, Vector

from . import common as C
from . import dose_sim as DS
from . import gn
from . import materials as M
from . import props as P
from . import stage as S

NAME = 'dose'
CACHE_FILE = 'dose.npz'
BED_RINGS, BED_SEGS = 72, 288
UV_SPAN = 2 * P.BASKET_R       # the scanned grounds tile 1.5x across the basket (as in v3)
HIDE = 0.05                    # bare parts of the bed mesh sit this far under the steel (more than the 0.035 displacement)
CHUTE_CLEAR = (C.T['tamp'] - 0.32, C.T['tamp'] - 0.18)    # the grinder is cleared out of the tamper's way, out of frame


# ------------------------------------------------------------------ build
def build(scene):
    col = scene.collection
    rng = np.random.default_rng(31)
    P.build_portafilter(col, name='dose_pf')
    tamper = P.build_tamper(col, name='dose_tamper')
    grinder = _grinder(col)
    _bed(col)
    chips = _chips('dose_chips', 8, rng)
    clumps = _clumps('dose_clump_shapes', 6, rng)
    cfg = DS.schedule(C.T, C.FPS)
    sim = DS.Dose(cfg)
    rec = sim.run()
    data = DS.pack(rec, sim)
    data['apex'] = np.array([_apex(h, sim.bed) for h in rec['H']], np.float32)
    np.savez_compressed(C.CACHE / CACHE_FILE, **data)
    print(f'[dose] {sim.n} particles, {sim.copies:.1f} grains per rendered grain, puck volume {sim.bed.volume():.1f} cm^3 '
          f'({DS.DOSE / sim.bed.volume():.3f} g/cm^3), compacted {sim.bed.lost:.1f} cm^3, spilled {sim.spilled:.3f} g', flush=True)
    for name, kinds, shapes, mat in _CLOUDS:
        _points(col, name, int(np.isin(sim.kind, kinds).sum()), chips if shapes == 'chips' else clumps, mat())
    _puff_volume(col, int((sim.kind == DS.PUFF).sum()))
    _dress_tamper(tamper)
    _key_tamper(scene, tamper, cfg)
    _key_grinder(scene, grinder)
    _lights_camera(scene, data, cfg)
    attach(scene)


def _apex(H, bed):
    """Highest point of the heap under the tamper footprint (x, y, z)."""
    h = np.where(bed.R < DS.TAMPER_R, H, -9.0)
    i = int(np.argmax(h))
    return bed.X.flat[i], bed.Y.flat[i], h.flat[i]


# ------------------------------------------------------------------ grinder chute and spout
def _catmull(points, n):
    Pp = np.asarray(points, float)
    m = len(Pp)
    out = []
    for t in np.linspace(0, m - 1 - 1e-9, n):
        i = int(t)
        u = t - i
        p0, p1, p2, p3 = Pp[max(i - 1, 0)], Pp[i], Pp[i + 1], Pp[min(i + 2, m - 1)]
        out.append(0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3))
    return np.array(out)


def _loft(path, w, h, around=48, expo=4.0):
    """Closed duct with a superellipse section swept along a path in the YZ plane (side axis +X); end caps as fans."""
    T = np.gradient(path, axis=0)
    T /= np.linalg.norm(T, axis=1, keepdims=True)
    side = np.array([1.0, 0.0, 0.0])
    up = np.cross(T, side)
    a = np.linspace(0, 2 * np.pi, around, endpoint=False)
    u = np.sign(np.cos(a)) * np.abs(np.cos(a)) ** (2 / expo)
    v = np.sign(np.sin(a)) * np.abs(np.sin(a)) ** (2 / expo)
    rings = path[:, None, :] + side[None, None, :] * (u[None, :, None] * w[:, None, None] / 2) + up[:, None, :] * (v[None, :, None] * h[:, None, None] / 2)
    n = len(path)
    verts = list(rings.reshape(-1, 3)) + [path[0], path[-1]]
    c0, c1 = n * around, n * around + 1
    faces = []
    for k in range(n - 1):
        for j in range(around):
            j2 = (j + 1) % around
            faces.append((k * around + j, k * around + j2, (k + 1) * around + j2, (k + 1) * around + j))
    for j in range(around):
        j2 = (j + 1) % around
        faces.append((c0, j2, j))
        faces.append((c1, (n - 1) * around + j, (n - 1) * around + j2))
    return np.array(verts), faces


def _grinder(col):
    """The front of the grinder: a detachable black anodised chute sloping down to a short stainless spout whose exit
    is DS.SPOUT. Everything hangs from an empty that is animated out of the tamper's way."""
    root = bpy.data.objects.new('dose_grinder', None)
    col.objects.link(root)
    ctrl = [(0.1, 10.5, 12.0), (0.1, 6.4, 8.9), (0.1, 3.0, 6.95), (0.1, 1.0, 6.25), (0.1, 0.35, 6.12)]
    path = _catmull(ctrl, 60)
    s = np.linspace(0, 1, len(path))
    w, h = 3.1 - 0.5 * s, 2.1 - 0.35 * s
    # rounded nose: the section closes over the last 4 mm like a quarter ellipse
    nose = np.linspace(0, 1, 9)[1:]
    tip = path[-1] + np.outer(nose, [0.0, -0.4, -0.03])
    path = np.concatenate([path, tip])
    shrink = np.sqrt(np.maximum(1 - nose ** 2, 0.02))
    w = np.concatenate([w, w[-1] * shrink])
    h = np.concatenate([h, h[-1] * shrink])
    v, f = _loft(path, w, h)
    me = C.mesh_from_arrays('dose_chute', v, f)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(me)
    bm.free()
    me.materials.append(_chute_material())
    C.obj_new('dose_chute', me, col, root)
    # spout: lathe along +Z, exit at the origin, then turned so +Z runs back up its axis into the chute
    prof = [(0.6, 1.55), (0.6, 0.06), (0.63, 0.005), (0.7, 0.0), (0.77, 0.02), (0.8, 0.07), (0.8, 1.55)]
    sv, sf, suv = C.lathe(prof, 96)
    sp = C.obj_new('dose_spout', C.mesh_from_arrays('dose_spout', sv, sf, suv), col, root)
    sp.data.materials.append(_spout_material())
    sp.location = DS.SPOUT
    sp.rotation_mode = 'QUATERNION'
    sp.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(-Vector(DS.SPOUT_AXIS).normalized())
    return root


def _chute_material():
    """Black anodised aluminium (dyed oxide over the metal: a satin dielectric, IOR 1.65), bead-blasted, with coffee
    dust caught towards the outlet."""
    g = M.Graph('dose_chute')
    co = g.coord()
    xyz = g.node('ShaderNodeSeparateXYZ', {'Vector': co})
    near = g.map_range(xyz.outputs['Z'], 7.0, 5.6, 0.0, 1.0)
    speck = g.noise(co, 14.0, detail=6.0, rough=0.7)
    dust = g.math('MULTIPLY', near, g.map_range(speck.outputs['Fac'], 0.5, 0.72, 0.0, 0.8))
    col = g.mix_rgb(dust, (0.014, 0.0135, 0.013), (0.11, 0.065, 0.036))
    rough = g.math('ADD', M.varied_roughness(g, 0.32, 0.48, 3.0, 0.04), g.math('MULTIPLY', dust, 0.45))
    g.p(Base_Color=col, Roughness=rough, IOR=1.65, Normal=M.micro_normal(g, 90.0, 0.06))
    return g.mat


def _spout_material():
    """Lathe-turned stainless spout, circumferential tool marks, a rim of coffee dust at the lip."""
    g = M.Graph('dose_spout')
    co = g.coord()
    tan = g.node('ShaderNodeTangent', direction_type='RADIAL', axis='Z').outputs[0]
    xyz = g.node('ShaderNodeSeparateXYZ', {'Vector': co})
    speck = g.noise(co, 30.0, detail=5.0, rough=0.7)
    dust = g.math('MULTIPLY', g.map_range(xyz.outputs['Z'], 0.35, 0.05, 0.0, 1.0), g.map_range(speck.outputs['Fac'], 0.42, 0.62, 0.0, 1.0))
    col = g.mix_rgb(dust, (0.6, 0.59, 0.56), (0.1, 0.06, 0.035))
    rough = g.math('ADD', M.varied_roughness(g, 0.16, 0.28, 4.0, 0.04), g.math('MULTIPLY', dust, 0.6))
    g.p(Base_Color=col, Metallic=g.math('SUBTRACT', 1.0, dust), Roughness=rough, Anisotropic=0.6, Tangent=tan,
        Normal=M.micro_normal(g, 140.0, 0.02))
    return g.mat


# ------------------------------------------------------------------ the bed
def _bed_layout():
    """Polar grid of unit radius; per vertex: radius fraction, angle, and which outer segment sets its edge radius."""
    v, f = C.grid_disk(BED_RINGS, BED_SEGS, 1.0)
    rho = np.hypot(v[:, 0], v[:, 1])
    th = np.arctan2(v[:, 1], v[:, 0])
    seg = np.concatenate([[0], np.tile(np.arange(BED_SEGS), BED_RINGS)])
    return v, f, rho, th, seg


def _bed(col):
    v, f, rho, th, seg = _bed_layout()
    v = v * DS.wall_r(-2.0)
    v[:, 2] = -2.4
    me = C.mesh_from_arrays('dose_bed', v, f, uv=v[:, :2] / UV_SPAN + 0.5)
    me.attributes.new('tamped', 'FLOAT', 'POINT')
    me.materials.append(M.get('grounds'))
    ob = C.obj_new('dose_bed', me, col)
    # a zero displace marks the mesh as deforming, so Cycles exports its motion for the blur
    mod = ob.modifiers.new('deform_motion', 'DISPLACE')
    mod.strength = 0.0
    return ob


# ------------------------------------------------------------------ particle shapes and clouds
def _chips(name, n, rng):
    """Irregular fracture chips: convex hulls of 9-14 points on a flattened ellipsoid, radius ~1, faceted."""
    coll = bpy.data.collections.new(name)
    for i in range(n):
        bm = bmesh.new()
        _chip(bm, rng, np.zeros(3), 1.0)
        me = bpy.data.meshes.new(f'{name}{i}')
        bm.to_mesh(me)
        bm.free()
        coll.objects.link(bpy.data.objects.new(f'{name}{i}', me))
    return coll


def _chip(bm, rng, centre, scale):
    k = int(rng.integers(9, 15))
    p = rng.standard_normal((k, 3))
    p /= np.linalg.norm(p, axis=1, keepdims=True)
    p *= rng.uniform(0.7, 1.0, (k, 1)) * np.array([1.0, rng.uniform(0.6, 0.9), rng.uniform(0.4, 0.75)])
    q = Quaternion(Vector(rng.standard_normal(3)).normalized(), rng.uniform(0, 6.28))
    vs = [bm.verts.new(Vector(centre) + q @ Vector(x * scale)) for x in p]
    res = bmesh.ops.convex_hull(bm, input=vs)
    drop = {x for x in res['geom_interior'] + res['geom_unused'] if isinstance(x, bmesh.types.BMVert)}
    bmesh.ops.delete(bm, geom=list(drop), context='VERTS')


def _clumps(name, n, rng):
    """Clumps: 8-14 chips (and the fines between them) stuck together, about unit radius."""
    coll = bpy.data.collections.new(name)
    for i in range(n):
        bm = bmesh.new()
        for _ in range(int(rng.integers(8, 15))):
            c = rng.standard_normal(3)
            c *= rng.uniform(0.0, 0.55) / np.linalg.norm(c) * np.array([1.0, 0.85, 0.7])
            _chip(bm, rng, c, rng.uniform(0.3, 0.5))
        me = bpy.data.meshes.new(f'{name}{i}')
        bm.to_mesh(me)
        bm.free()
        coll.objects.link(bpy.data.objects.new(f'{name}{i}', me))
    return coll


def _points(col, name, n, shapes, material):
    me = bpy.data.meshes.new(name)
    me.vertices.add(n)
    me.attributes.new('size', 'FLOAT', 'POINT')
    me.attributes.new('pid', 'INT', 'POINT')
    me.attributes['pid'].data.foreach_set('value', np.arange(n, dtype=np.int32))
    ob = C.obj_new(name, me, col)
    mod = ob.modifiers.new('grains', 'NODES')
    mod.node_group = gn.grain_instancer(f'{name}_instancer', shapes, material)
    return ob


def _fines_material():
    """Airborne fines: 30-120 um porous agglomerates of cell-wall fragments. Fine powder scatters more than the coarse
    chips, so it reads lighter and redder; each speck covers well under a pixel, drawn as a partly covering (alpha)
    chip so that thousands of them add up to a faint haze."""
    if 'dose_fines' in bpy.data.materials:
        return bpy.data.materials['dose_fines']
    g = M.Graph('dose_fines')
    rnd = g.node('ShaderNodeObjectInfo').outputs['Random']
    col = g.ramp(rnd, [(0.0, (0.07, 0.038, 0.02)), (1.0, (0.2, 0.115, 0.062))])
    g.p(Base_Color=col, Roughness=M.varied_roughness(g, 0.75, 0.95, 400.0), Alpha=0.4, Normal=M.micro_normal(g, 600.0, 0.3))
    return g.mat


def _puff_volume(col, n):
    """The puff as a thin dust cloud: a fog volume of 0.8 mm spheres around the puff particles (radius follows their
    dilution), scattering like fine coffee dust."""
    me = bpy.data.meshes.new('dose_puff')
    me.vertices.add(n)
    me.attributes.new('size', 'FLOAT', 'POINT')
    ob = C.obj_new('dose_puff', me, col)
    ng = bpy.data.node_groups.new('dose_puff_volume', 'GeometryNodeTree')
    ng.interface.new_socket('Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')
    ng.interface.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
    N, L = ng.nodes.new, ng.links.new
    gi, go = N('NodeGroupInput'), N('NodeGroupOutput')
    m2p, p2v, setm = N('GeometryNodeMeshToPoints'), N('GeometryNodePointsToVolume'), N('GeometryNodeSetMaterial')
    size = N('GeometryNodeInputNamedAttribute')
    size.data_type = 'FLOAT'
    size.inputs['Name'].default_value = 'size'
    rad = N('ShaderNodeMath')
    rad.operation = 'MULTIPLY'
    rad.inputs[1].default_value = 0.08 / 0.003
    p2v.inputs['Resolution Mode'].default_value = 'Size'
    p2v.inputs['Voxel Size'].default_value = 0.03
    p2v.inputs['Density'].default_value = 1.0
    setm.inputs['Material'].default_value = _haze_material()
    L(gi.outputs[0], m2p.inputs['Mesh'])
    L(m2p.outputs[0], p2v.inputs['Points'])
    L(size.outputs['Attribute'], rad.inputs[0])
    L(rad.outputs[0], p2v.inputs['Radius'])
    L(p2v.outputs[0], setm.inputs['Geometry'])
    L(setm.outputs[0], go.inputs[0])
    ob.modifiers.new('puff', 'NODES').node_group = ng
    return ob


def _haze_material():
    """Fine coffee dust in air: a sparse, mostly scattering medium (light brown single-scattering albedo, mild forward
    scattering), wispy where turbulence has thinned it."""
    g = M.Graph('dose_haze', principled=False)
    n = g.noise(g.coord(), 5.0, detail=4.0, rough=0.6, distortion=0.6)
    dens = g.math('MULTIPLY', g.map_range(n.outputs['Fac'], 0.4, 0.72, 0.05, 1.0), 0.45)
    vol = g.node('ShaderNodeVolumePrincipled', {'Color': (0.42, 0.29, 0.19), 'Density': dens, 'Anisotropy': 0.35,
                                                 'Absorption Color': (0.12, 0.07, 0.04)})
    g.link(vol.outputs[0], g.out.inputs['Volume'])
    return g.mat


_CLOUDS = [('dose_grains', [DS.GRAIN], 'chips', lambda: M.get('grain')), ('dose_clumps', [DS.CLUMP], 'clumps', lambda: M.get('grain')),
           ('dose_fines', [DS.FINE, DS.PUFF], 'chips', _fines_material)]


def _walnut_oiled():
    """The tamper handle: the same scanned walnut, oiled darker (linseed deepens the albedo ~2x), satin finish."""
    g = M.Graph('dose_walnut_oiled')
    uv = g.mapping(g.coord('UV'), (1.0, 2.5, 1.0))
    d = g.image(C.V3_ASSETS / 'walnut_diffuse_1k.jpg', 'sRGB', uv)
    nm = g.image(C.V3_ASSETS / 'walnut_nor_gl_1k.jpg', 'Non-Color', uv)
    r = g.image(C.V3_ASSETS / 'walnut_rough_1k.jpg', 'Non-Color', uv)
    nmap = g.node('ShaderNodeNormalMap', {'Color': nm.outputs['Color'], 'Strength': 0.7})
    col = g.mix_rgb(1.0, d.outputs['Color'], (0.42, 0.33, 0.27), 'MULTIPLY')
    g.p(Base_Color=col, Roughness=g.map_range(r.outputs['Color'], 0, 1, 0.45, 0.75), Normal=nmap.outputs[0], IOR=1.53,
        Coat_Weight=0.3, Coat_Roughness=M.varied_roughness(g, 0.25, 0.38, 2.0), Coat_IOR=1.5, Coat_Normal=nmap.outputs[0])
    return g.mat


def _dress_tamper(root):
    """The props lathe has a coarse profile: smooth the handle and give it the oiled finish."""
    knob = next(c for c in root.children if c.name.endswith('_knob'))
    knob.data.materials[0] = _walnut_oiled()
    mod = knob.modifiers.new('smooth', 'SUBSURF')
    mod.levels = mod.render_levels = 2


# ------------------------------------------------------------------ animation
def tamper_pose(t, cfg):
    """Face height, sway (x, y), tilt and twist of the hand-held tamper. It is centred and upright before the base
    enters the basket (1.2 mm clearance), turns a little as the barista polishes, settles and lifts out."""
    tm = cfg['times']
    z = cfg['tamper'](t)
    k = 1 - C.smooth(tm['down'], tm['down'] + 0.14, t)
    sway = np.array([0.35, -0.25]) * k
    tilt = math.radians(2.5) * k
    twist = 0.5 * k + math.radians(14) * C.smooth(tm['tamp'] - 0.01, tm['lift'] - 0.01, t)
    if tm['tamp'] <= t < tm['lift']:
        a = t - tm['tamp']
        z += 0.004 * math.sin(a * 2 * math.pi * 11) * math.exp(-a * 30)      # the hand's pressure settling
    return z, sway, tilt, twist


def _key_tamper(scene, tamper, cfg):
    tamper.rotation_mode = 'XYZ'
    for f in range(scene.frame_start - 1, scene.frame_end + 2):
        z, sway, tilt, twist = tamper_pose(C.time_of(f), cfg)
        tamper.location = (sway[0], sway[1], z)
        tamper.rotation_euler = (tilt, -tilt * 0.6, twist)
        tamper.keyframe_insert('location', frame=f)
        tamper.keyframe_insert('rotation_euler', frame=f)
    C.set_interpolation(tamper, 'LINEAR')


def _key_grinder(scene, grinder):
    """Out of frame, the grinder is cleared away (in the kitchen: the portafilter is pulled from the fork), far enough
    that the chrome tamper face does not mirror it, then hidden."""
    for f in range(scene.frame_start - 1, scene.frame_end + 2):
        k = C.smoother(*CHUTE_CLEAR, C.time_of(f))
        grinder.location = (0.0, 22.0 * k, 18.0 * k)
        grinder.keyframe_insert('location', frame=f)
    C.set_interpolation(grinder, 'LINEAR')
    gone = C.frame_of(CHUTE_CLEAR[1]) + 1
    for ob in [grinder] + list(grinder.children):
        C.key_visibility(ob, [(scene.frame_start - 1, True), (gone, False)])


# ------------------------------------------------------------------ camera, lights, world
CAM_KEYS = [  # time, (azimuth deg, elevation deg, distance, target x, y, z, fov, f-number)
    (2.60, (234.0, 34.0, 16.4, 0.10, 0.10, 1.05, 30.0, 9.0)),
    (3.20, (236.0, 33.0, 16.0, 0.10, 0.10, 0.85, 30.0, 9.0)),
    (3.45, (237.0, 32.0, 16.0, 0.05, 0.05, 0.45, 30.0, 10.0)),
    (3.62, (238.0, 31.0, 16.0, 0.00, 0.05, 0.20, 30.0, 10.0)),
    (3.75, (238.6, 32.0, 15.6, 0.00, 0.05, 0.10, 29.8, 10.5)),
    (4.00, (240.0, 40.0, 14.8, 0.00, 0.05, -0.10, 29.0, 11.0)),
]


def _cam_sampler(data, cfg):
    tm = cfg['times']
    apex = data['apex']
    f0 = int(round(C.T['dose'] * C.FPS))

    def focus_point(t):
        k = int(np.clip(round(t * C.FPS + 1) - f0, 0, len(apex) - 1))
        ax, ay, az = apex[k]
        pour = np.array([ax, ay, az + 0.05])
        zb = max(cfg['tamper'](min(t, tm['lift'])), DS.PUCK)
        tamp = np.array([0.0, 0.0, min(zb + 1.0, 2.0)])             # the chrome base and copper neck
        puck = np.array([0.0, 0.0, DS.PUCK])
        p = C.lerp(pour, tamp, C.smooth(tm['off'], tm['down'] + 0.12, t))
        return C.lerp(p, puck, C.smooth(tm['lift'] + 0.02, tm['lift'] + 0.14, t))

    def sample(t):
        az, el, dist, tx, ty, tz, fov, fstop = C.hermite([(k[0], k[1]) for k in CAM_KEYS], t)
        a, e = math.radians(az), math.radians(el)
        tgt = np.array([tx, ty, tz])
        pos = tgt + dist * np.array([math.cos(e) * math.cos(a), math.cos(e) * math.sin(a), math.sin(e)])
        # hand-held drift, and the jolt of the tamp travelling through the bench
        pos += np.array([C.noise1(t * 1.3, 4), C.noise1(t * 1.3, 5), C.noise1(t * 1.3, 6)]) * 0.025
        j = t - tm['tamp']
        if j > 0:
            pos += np.array([0.3, -0.2, 1.0]) * 0.012 * math.sin(j * 2 * math.pi * 14) * math.exp(-j * 22)
        return dict(pos=pos, target=tgt, roll=0.015 * math.sin(t * 1.1), fov=fov,
                    focus=float(np.linalg.norm(pos - focus_point(t))), fstop=fstop)

    return sample


def _light(scene, name, size, power, color, az, el, dist, target, size_y=None):
    lt = S.area_light(scene, name, size, power, color, size_y=size_y)
    a, e = math.radians(az), math.radians(el)
    lt.location = Vector(target) + dist * Vector((math.cos(e) * math.cos(a), math.cos(e) * math.sin(a), math.sin(e)))
    S.aim(lt, target)
    return lt


def _lights_camera(scene, data, cfg):
    # camera looks from azimuth ~236 deg: its left is ~146 deg, behind-right ~15 deg
    # the key stands back (35 cm) so the falloff between the bed and the tamper handle above it stays gentle
    _light(scene, 'dose_key', 26.0, 1.6 * (35 / 18) ** 2, (1.0, 0.9, 0.78), 160, 45, 35, (0, 0, 0.8), size_y=19.0)
    _light(scene, 'dose_rim', 3.0, 1.1, (1.0, 0.74, 0.48), 18, 20, 15, (0, 0, 1.5), size_y=12.0)
    _light(scene, 'dose_fill', 12.0, 0.3, (0.92, 0.94, 1.0), 285, 25, 18, (0, 0, 0))
    S.make_camera(scene, 'cam_dose', _cam_sampler(data, cfg))
    S.key_world(scene.world, lambda t: (2.4, 0.25, 0.32), range(scene.frame_start - 1, scene.frame_end + 2))


# ------------------------------------------------------------------ render-time updates
class Player:
    """Evaluates the cached simulation at any (sub)frame time."""

    def __init__(self, data):
        self.d = data
        self.f0 = int(round(C.T['dose'] * C.FPS))           # first recorded frame (one before the shot)
        self.nf = len(data['H'])
        self.n = len(data['kind'])
        self.size = data['d'].astype(np.float64) * 0.5       # chip shapes have unit radius
        self.X = data['X'].astype(np.float64)
        self.dx = self.X[1] - self.X[0]
        self.B = data['B'].astype(np.float64)

    def _frame(self, t):
        fr = t * C.FPS + 1 - self.f0
        k = int(np.clip(math.floor(fr), 0, self.nf - 2))
        return k, float(np.clip(fr - k, 0.0, 1.0))

    def _state(self, k):
        a, b = self.d['off'][k], self.d['off'][k + 1]
        return (self.d['ids'][a:b], self.d['pos'][a:b] * DS.POS_Q, self.d['vel'][a:b] * DS.VEL_Q,
                self.d['fade'][a:b] / 255.0)

    def particles(self, t):
        k, s = self._frame(t)
        ia, pa, va, fa = self._state(k)
        ib, pb, vb, fb = self._state(k + 1)
        n, h = self.n, 1.0 / C.FPS
        ma, mb = np.full(n, -1), np.full(n, -1)
        ma[ia], mb[ib] = np.arange(len(ia)), np.arange(len(ib))
        pos, size = np.zeros((n, 3)), np.zeros(n)
        both = np.nonzero((ma >= 0) & (mb >= 0))[0]
        a, b = ma[both], mb[both]
        h00, h10, h01, h11 = 2 * s ** 3 - 3 * s ** 2 + 1, s ** 3 - 2 * s ** 2 + s, -2 * s ** 3 + 3 * s ** 2, s ** 3 - s ** 2
        pos[both] = h00 * pa[a] + h10 * h * va[a] + h01 * pb[b] + h11 * h * vb[b]
        size[both] = C.lerp(fa[a], fb[b], s) * self.size[both]
        dying = np.nonzero((ma >= 0) & (mb < 0))[0]
        pos[dying] = pa[ma[dying]] + va[ma[dying]] * s * h
        size[dying] = fa[ma[dying]] * (1 - s) * self.size[dying]
        born = np.nonzero((ma < 0) & (mb >= 0))[0]
        pos[born] = pb[mb[born]] - vb[mb[born]] * (1 - s) * h
        size[born] = np.where(self.d['tb'][born] <= t, fb[mb[born]], 0.0) * self.size[born]
        return pos, size

    def field(self, t):
        k, s = self._frame(t)
        H = self.d['H']
        return (1 - s) * H[k].astype(np.float64) + s * H[k + 1].astype(np.float64)

    def sample(self, F, x, y):
        fx = (x - self.X[0]) / self.dx
        fy = (y - self.X[0]) / self.dx
        ix = np.clip(np.floor(fx).astype(np.int64), 0, len(self.X) - 2)
        iy = np.clip(np.floor(fy).astype(np.int64), 0, len(self.X) - 2)
        wx, wy = np.clip(fx - ix, 0, 1), np.clip(fy - iy, 0, 1)
        return (F[iy, ix] * (1 - wx) + F[iy, ix + 1] * wx) * (1 - wy) + (F[iy + 1, ix] * (1 - wx) + F[iy + 1, ix + 1] * wx) * wy


def attach(scene):
    data = dict(np.load(C.CACHE / CACHE_FILE))
    pl = Player(data)
    cfg = DS.schedule(C.T, C.FPS)
    tm = cfg['times']
    bed = scene.objects['dose_bed'].data
    clouds = [(scene.objects[name].data, np.nonzero(np.isin(data['kind'], kinds))[0]) for name, kinds, _, _ in _CLOUDS]
    puff, pi = scene.objects['dose_puff'].data, np.nonzero(data['kind'] == DS.PUFF)[0]
    _, faces, rho, th, seg = _bed_layout()
    cos, sin = np.cos(th), np.sin(th)
    ea = np.linspace(0, 2 * np.pi, BED_SEGS, endpoint=False)
    loops = np.zeros(len(bed.loops), np.int32)
    bed.loops.foreach_get('vertex_index', loops)
    apex0 = float(data['apex'][:, 2].max())

    def update(t):
        # bed: where it meets the wall, the vertices on the field, bare parts tucked under the steel
        H = pl.field(t)
        he = pl.sample(H, 2.86 * np.cos(ea), 2.86 * np.sin(ea))
        re = np.clip(DS.wall_r(he) - 0.006, 2.45, 2.95)
        r = rho * re[seg]
        x, y = r * cos, r * sin
        T = pl.sample(H - pl.B, x, y)
        z = DS.basket_z(r) + np.maximum(T, 0.0) - HIDE * (1 - DS.smoothstep(0.0, HIDE, T))
        bed.vertices.foreach_set('co', np.stack([x, y, z], -1).astype(np.float32).ravel())
        uv = np.stack([x, y], -1) / UV_SPAN + 0.5
        bed.uv_layers[0].data.foreach_set('uv', uv[loops].astype(np.float32).ravel())
        zb = cfg['tamper'](min(t, tm['lift']))
        press = float(np.clip((apex0 - zb) / (apex0 - DS.PUCK), 0.0, 1.0)) ** 2
        tamped = press * np.where(r < 2.78, 1.0, 0.35)
        bed.attributes['tamped'].data.foreach_set('value', tamped.astype(np.float32))
        bed.update()
        # grains in flight and on the heap
        pos, size = pl.particles(t)
        for me, idx in clouds + [(puff, pi)]:
            me.vertices.foreach_set('co', pos[idx].astype(np.float32).ravel())
            me.attributes['size'].data.foreach_set('value', size[idx].astype(np.float32))
            me.update()

    C.on_frame(scene.name, update)
    update(C.time_of(scene.frame_start))
