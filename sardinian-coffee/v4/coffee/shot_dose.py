"""Shot 3: the dose. Freshly ground espresso falls from the grinder's chute into a bottomless portafilter, builds a heap,
the flow tapers off, a tamper comes down, presses the bed into a flat puck and lifts away.

Time scale: gentle slow motion, SLOWMO = 0.5 real seconds per screen second (120 fps footage played at 60), so a grain
takes ~9 frames to fall from the spout to the heap. The one cheat is the grinder's throughput: a real E6C delivers
2.5-3.5 g/s at espresso settings, i.e. 6 s for an 18 g dose; the edit allows ~0.85 s of screen (0.43 s real), so the
stream carries the dose about 14x faster than the grinder would. Every rendered grain or clump is a super-particle that
stands for ~9 identical copies of itself (all of them carry the 18 g together); everything else is physical.

Physics (numpy, coffee/dose_sim.py, 16 sub-steps per frame, all forces in real seconds):
- emission: grains leave the 12 mm stainless spout at 0.3-0.6 m/s along its 12 degree lean, off-centre (they slide down
  the lower wall of the inclined bore), with 2.5-4 degrees of spread; the stream pulses at the burr carrier frequency
  (1480 rpm = 24.7 Hz real) and sways slightly as the chute empties. Bimodal grind: coarse mode 0.25-0.35 mm chips
  (envelope density 0.65 g/cm^3 like the bean, cells keep their roast pores), clumps 0.5-2 mm (0.42 g/cm^3, half the
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
Grains, not powder (at 1080x1920 a pixel is ~0.045 mm here: a 0.25 mm grain is ~6 px, a 1.5 mm clump ~35 px):
- the heap's surface is real-size instanced geometry over the height field: ~2600 angular fracture chips per cm^2
  (0.09-0.7 mm, median 0.24 mm) and ~100 fluffy clumps per cm^2 (0.5-2.2 mm, N(>D) ~ D^-2.2), half embedded, so the
  crumb relief and the shadows between grains make the texture (dose_sim.Skin explains where each grain is at any
  sub-frame: grains run down the flanks as the heap grows and are buried at the toe, never sliding up);
- the bed mesh under them shades as the dark velvet of fines and grit in the gaps (materials.grounds, procedural at
  real scale), the same chips and clumps fall in the stream and land on the heap;
- the tamper crushes the grains under its face; while the base covers the basket a pressed puck takes over: flattened
  grains on a jittered grid (~1370 per cm^2) over a mosaic of pressed grains with fine dark pores, lighter and satin,
  a looser ring of grains and crumbs in the gap at the wall, grains left on the steel above it as the base slides past.
Sources: Illy & Viani, Espresso Coffee (2005) for bean and grounds densities; Schiller & Naumann (1933) drag;
Corrochano et al. (2015) for dry espresso bed density; Ceado E37/E6 series data for throughput; Kaffeemacher (2025,
Camsizer X2) and Uman et al. (2016) for the grind's size distribution; Harper & Hendon (2023) for static clumping;
the UC Davis roast colour curve (Sci Rep 2025) for the grounds' colour.
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
    shapes = _shapes(rng)
    cfg = DS.schedule(C.T, C.FPS)
    sim = DS.Dose(cfg)
    rec = sim.run()
    data = DS.pack(rec, sim)
    data['apex'] = np.array([_apex(h, sim.bed) for h in rec['H']], np.float32)
    np.savez_compressed(C.CACHE / CACHE_FILE, **data)
    print(f'[dose] {sim.n} particles, {sim.copies:.1f} grains per rendered grain, puck volume {sim.bed.volume():.1f} cm^3 '
          f'({DS.DOSE / sim.bed.volume():.3f} g/cm^3), compacted {sim.bed.lost:.1f} cm^3, spilled {sim.spilled:.3f} g', flush=True)
    mats = {'grain': shapes['grain'], 'clump': shapes['clump'], 'fines': _fines_material()}
    for name, kinds, kind, mat in _CLOUDS:
        _points(col, name, int(np.isin(sim.kind, kinds).sum()), shapes[kind], mats[mat])
    pop = _grain_population(np.random.default_rng(SKIN_SEED))
    np.savez_compressed(C.CACHE / SKIN_FILE, **pop)
    for name, n in _layer_sizes(pop).items():
        _layer(col, name, n, shapes['all'])
    print(f'[dose] grains: {len(pop["chip_z"])} heap chip sites, {len(pop["clump_z"])} heap clump sites, '
          f'{len(pop["puck_shape"])} puck grains', flush=True)
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
    me = C.mesh_from_arrays('dose_bed', v, f, uv=v[:, :2])        # UV = x, y in cm: the grounds shader works at real scale
    me.attributes.new('tamped', 'FLOAT', 'POINT')
    me.materials.append(M.get('grounds'))
    ob = C.obj_new('dose_bed', me, col)
    # a zero displace marks the mesh as deforming, so Cycles exports its motion for the blur
    mod = ob.modifiers.new('deform_motion', 'DISPLACE')
    mod.strength = 0.0
    return ob


# ------------------------------------------------------------------ grain shapes and their shaders
N_CHIPS, N_CLUMPS = 32, 16


def _shapes(rng):
    """Instance shapes shared by the stream, the heap and the puck, all with a half-length of 1 (scaled by d / 2):
    - chips: roasted coffee is brittle and breaks into angular grains with flat conchoidal facets (sphericity
      0.75-0.85): convex hulls of 10-16 points on an ellipsoid of axes 1 : 0.65-0.85 : 0.45-0.65 (x longest, z thinnest,
      so a pressed grain can be laid flat), 1 in 8 a plate-like flake (thickness 0.25-0.35), two splinters;
    - clumps: electrostatic agglomerates of grains held in a velvet of fines, fluffy cauliflower lumps of roughly
      1 : 0.8 : 0.6 (Harper & Hendon 2023; Microtrac): a lumpy core (so they are not see-through) studded with 60-90
      grains of 0.08-0.34 of their size."""
    chips = bpy.data.collections.new('dose_chip_shapes')
    clumps = bpy.data.collections.new('dose_clump_shapes')
    every = bpy.data.collections.new('dose_shapes')
    grain_mat, clump_mat = _grain_material('dose_grain'), _grain_material('dose_clump', value=0.95, sat=0.92)
    for i in range(N_CHIPS):
        kind = 2 if i in (5, 21) else (1 if i % 8 == 3 else 0)
        bm = bmesh.new()
        _chip(bm, rng, kind)
        ob = _shape_object(f'dose_shape_c{i:02d}', bm, grain_mat)
        chips.objects.link(ob)
        every.objects.link(ob)
    for i in range(N_CLUMPS):
        bm = bmesh.new()
        _clump(bm, rng)
        ob = _shape_object(f'dose_shape_k{i:02d}', bm, clump_mat)
        clumps.objects.link(ob)
        every.objects.link(ob)
    return {'chips': chips, 'clumps': clumps, 'all': every, 'grain': grain_mat, 'clump': clump_mat}


def _shape_object(name, bm, mat):
    """Normalise to a half-length of 1 along x, flat shaded (the facets catch the light one by one)."""
    co = np.array([v.co[:] for v in bm.verts])
    centre = 0.5 * (co.max(0) + co.min(0))
    half = 0.5 * float(co[:, 0].max() - co[:, 0].min())
    for v in bm.verts:
        v.co = (v.co - Vector(centre)) / half
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    return bpy.data.objects.new(name, me)


def _hull(bm, pts):
    vs = [bm.verts.new(Vector(x)) for x in pts]
    res = bmesh.ops.convex_hull(bm, input=vs)
    drop = {x for x in res['geom_interior'] + res['geom_unused'] if isinstance(x, bmesh.types.BMVert)}
    bmesh.ops.delete(bm, geom=list(drop), context='VERTS')


def _chip(bm, rng, kind=0):
    if kind == 1:
        ax = (1.0, rng.uniform(0.7, 0.95), rng.uniform(0.25, 0.35))
    elif kind == 2:
        ax = (1.0, rng.uniform(0.35, 0.5), rng.uniform(0.28, 0.4))
    else:
        ax = (1.0, rng.uniform(0.65, 0.85), rng.uniform(0.45, 0.65))
    k = int(rng.integers(10, 17))
    p = rng.standard_normal((k, 3))
    p /= np.linalg.norm(p, axis=1, keepdims=True)
    p[:2, :] = [[1, 0, 0], [-1, 0, 0]]                       # the long axis is always spanned
    p *= rng.uniform(0.72, 1.0, (k, 1)) * np.array(ax)
    _hull(bm, p)


def _subchip(rng, centre, scale):
    k = int(rng.integers(8, 12))
    p = rng.standard_normal((k, 3))
    p /= np.linalg.norm(p, axis=1, keepdims=True)
    p *= rng.uniform(0.7, 1.0, (k, 1)) * np.array([1.0, rng.uniform(0.6, 0.85), rng.uniform(0.4, 0.65)])
    R = np.array(Quaternion(Vector(rng.standard_normal(3)).normalized(), rng.uniform(0, 6.28)).to_matrix())
    return centre + (p @ R.T) * scale


def _clump(bm, rng):
    ax = np.array([1.0, rng.uniform(0.75, 0.88), rng.uniform(0.55, 0.68)])
    # lumpy core: an icosphere on the ellipsoid, pushed in and out by a few broad bumps
    core = bmesh.new()
    bmesh.ops.create_icosphere(core, subdivisions=2, radius=1.0)
    bumps = rng.standard_normal((7, 3))
    bumps /= np.linalg.norm(bumps, axis=1, keepdims=True)
    amp = rng.uniform(-0.12, 0.18, 7)
    for v in core.verts:
        d = np.array(v.co[:])
        f = 1.0 + float((amp * np.exp(-((bumps - d) ** 2).sum(1) / 0.35)).sum())
        v.co = Vector(d * ax * 0.66 * f)
    for f in core.faces:
        f.smooth = True                                      # the core reads as fines velvet, not facets
    core_me = bpy.data.meshes.new('_core')
    core.to_mesh(core_me)
    core.free()
    bm.from_mesh(core_me)
    bpy.data.meshes.remove(core_me)
    # grains stuck in and on it, the larger ones proud of the surface
    for _ in range(int(rng.integers(60, 90))):
        d = rng.standard_normal(3)
        d /= np.linalg.norm(d)
        size = rng.uniform(0.08, 0.2) if rng.random() < 0.8 else rng.uniform(0.2, 0.34)
        c = d * ax * rng.uniform(0.62, 0.84)
        vs = [bm.verts.new(Vector(x)) for x in _subchip(rng, c, size)]
        res = bmesh.ops.convex_hull(bm, input=vs)
        drop = {x for x in res['geom_interior'] + res['geom_unused'] if isinstance(x, bmesh.types.BMVert)}
        bmesh.ops.delete(bm, geom=list(drop), context='VERTS')


def _grain_material(name, value=1.0, sat=1.0):
    """Roasted coffee fracture faces (shared by the chips in flight, on the heap and pressed into the puck).
    Colour: the bulk of a medium-dark espresso roast measures L* 21-25, hue ~50 deg (UC Davis colour curve, Sci Rep
    2025), and a grain is lighter than the bed it makes (inter-grain shadow), so the median grain is GROUNDS_ALBEDO,
    with a log-normal spread of +-25 % from grain to grain; ~10 % are lighter, oranger fresh-interior grains, ~5 %
    dark oily bean surface (glossier), ~1.5 % cream chaff flakes. Matte (roughness 0.62-0.8, IOR 1.5), a micro-relief
    of cell pores. Instancer attribute 'tamp' = 1 on the puck: pressed against the polished tamper, the faces are smeared
    with fines and oils, lighter (compaction raises reflectance) and satin. value/sat: clumps are fines-rich, a little
    lighter and less saturated."""
    g = M.Graph(name)
    rnd = g.node('ShaderNodeObjectInfo').outputs['Random']
    tamp = g.node('ShaderNodeAttribute', attribute_type='INSTANCER', attribute_name='tamp').outputs['Fac']

    def hashed(seed):
        return g.node('ShaderNodeTexWhiteNoise', {'W': g.math('ADD', rnd, seed)}, noise_dimensions='1D').outputs['Value']

    h1, h2 = hashed(0.371), hashed(1.913)
    spread = g.ramp(h1, [(0.0, (0.62,) * 3), (0.15, (0.8,) * 3), (0.5, (1.0,) * 3), (0.85, (1.25,) * 3), (1.0, (1.6,) * 3)])
    base = g.mix_rgb(1.0, M.GROUNDS_ALBEDO, spread, 'MULTIPLY')
    fresh = g.mix_rgb(g.map_range(h2, 0, 1, 0.0, 0.6), (0.11, 0.05, 0.02), (0.16, 0.075, 0.03))
    oily = g.mix_rgb(1.0, base, (0.5, 0.48, 0.48), 'MULTIPLY')
    chaff = (0.26, 0.16, 0.08)
    cls_fresh = g.math('LESS_THAN', rnd, 0.08)
    cls_oily = g.math('MULTIPLY', g.math('GREATER_THAN', rnd, 0.08), g.math('LESS_THAN', rnd, 0.13))
    cls_chaff = g.math('MULTIPLY', g.math('GREATER_THAN', rnd, 0.13), g.math('LESS_THAN', rnd, 0.136))
    col = g.mix_rgb(cls_fresh, base, fresh)
    col = g.mix_rgb(cls_oily, col, oily)
    col = g.mix_rgb(cls_chaff, col, chaff)
    if value != 1.0 or sat != 1.0:
        hsv = g.node('ShaderNodeHueSaturation', {'Hue': 0.5, 'Saturation': sat, 'Value': value, 'Color': col})
        col = hsv.outputs[0]
    col = g.mix_rgb(tamp, col, g.mix_rgb(1.0, col, M.PRESSED_TINT, 'MULTIPLY'))
    rough = g.map_range(h2, 0, 1, 0.62, 0.8)
    rough = g.math('SUBTRACT', rough, g.math('MULTIPLY', cls_oily, 0.24))
    rough = g.math('SUBTRACT', rough, g.math('MULTIPLY', tamp, 0.1))
    pores = g.noise(g.coord('Object'), 7.0, detail=3.0, rough=0.6)
    cells = g.voronoi(g.coord('Object'), 4.0)
    relief = g.math('ADD', pores.outputs['Fac'], g.math('MULTIPLY', cells.outputs['Distance'], 0.6))
    g.p(Base_Color=col, Roughness=rough, IOR=1.5, Specular_IOR_Level=g.map_range(tamp, 0, 1, 0.32, 0.4), Normal=g.bump(relief, 0.35, 0.05),
        Sheen_Weight=g.math('MULTIPLY', tamp, 0.08), Sheen_Roughness=0.35, Sheen_Tint=(0.85, 0.66, 0.5))
    return g.mat

# ------------------------------------------------------------------ the grains of the heap and of the puck
SKIN_FILE = 'dose_skin.npz'
SKIN_SEED = 41
SKIN_Z = (-2.42, 1.52)        # heights the heap's surface sweeps through, from under the floor to over the apex
SKIN_Q = 4.0                  # r sqrt(1 + g^2) / g up to which the surface is fully populated (95 % of the heap is below 3.8)
CHIP_SIGMA = 2600.0           # grains per cm^2 of loose heap surface (~2 layers: the bed shows only in the gaps)
CLUMP_SIGMA = 100.0           # clumps per cm^2: with the grains they cover ~2/3 of a fresh single dose's surface
PUCK_PITCH = 0.027            # cm: jittered grid of pressed grains over the puck (~1370 per cm^2)
PUCK_RING = 2.7               # cm: outside this radius the puck's edge stays looser (the base's edge radius and the gap)
PUCK_R = float(DS.wall_r(DS.PUCK)) - 0.008


def _axis_angle(axis, ang):
    """Rotation matrices (n, 3, 3) about unit axes (n, 3) by angles (n,) (Rodrigues)."""
    x, y, z = axis.T
    K = np.zeros((len(ang), 3, 3))
    K[:, 0, 1], K[:, 0, 2], K[:, 1, 0], K[:, 1, 2], K[:, 2, 0], K[:, 2, 1] = -z, y, z, -x, -y, x
    s, c = np.sin(ang)[:, None, None], np.cos(ang)[:, None, None]
    return np.eye(3)[None] + s * K + (1 - c) * (K @ K)


def _random_rotations(rng, n):
    q = rng.standard_normal((n, 4))
    q /= np.linalg.norm(q, axis=1, keepdims=True)
    w, x, y, z = q.T
    return np.stack([1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
                     2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
                     2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)], -1).reshape(n, 3, 3)


def _lying(rng, n, tilt):
    """Flat side down (local z up), a random turn about the vertical and a tilt of up to `tilt` radians."""
    spin = _axis_angle(np.tile([0.0, 0.0, 1.0], (n, 1)), rng.uniform(0, 2 * np.pi, n))
    a = rng.uniform(0, 2 * np.pi, n)
    tip = _axis_angle(np.stack([np.cos(a), np.sin(a), np.zeros(n)], -1), tilt * np.sqrt(rng.random(n)))
    return tip @ spin


def _grain_population(rng):
    """Every grain the heap and the puck will show, drawn once (cached; attach places them at any time).
    Sizes: the coarse mode of an espresso grind, x50 ~0.2-0.35 mm by volume with a long tail to 1+ mm (Kaffeemacher
    Camsizer data, Uman et al. 2016), and by number the small ones dominate: log-normal, median 0.24 mm, sigma_ln 0.45,
    0.09-0.7 mm, 1 % to 1.1 mm. Clumps:
    0.5-2.2 mm with a power-law size distribution, N(>D) ~ D^-2.2 (many small crumbs, few big lumps)."""
    zs = SKIN_Z[1] - SKIN_Z[0]
    pop = {}
    n = int(CHIP_SIGMA * SKIN_Q * 2 * np.pi * zs)
    d = np.clip(0.024 * np.exp(0.45 * rng.standard_normal(n)), 0.009, 0.07)
    tail = rng.random(n) < 0.01
    d[tail] = rng.uniform(0.07, 0.11, int(tail.sum()))
    pop.update(chip_th=rng.uniform(-np.pi, np.pi, n), chip_z=rng.uniform(*SKIN_Z, n), chip_u=rng.random(n), chip_d=d,
               chip_shape=rng.integers(0, N_CHIPS, n), chip_R=_random_rotations(rng, n), chip_e=rng.uniform(-0.2, 0.3, n))
    n = int(CLUMP_SIGMA * SKIN_Q * 2 * np.pi * zs)
    a, d0, d1 = 2.2, 0.05, 0.22
    D = d0 * (1 - rng.random(n) * (1 - (d0 / d1) ** a)) ** (-1 / a)
    pop.update(clump_th=rng.uniform(-np.pi, np.pi, n), clump_z=rng.uniform(*SKIN_Z, n), clump_u=rng.random(n), clump_d=D,
               clump_shape=N_CHIPS + rng.integers(0, N_CLUMPS, n), clump_R=_lying(rng, n, 0.45), clump_e=rng.uniform(-0.04, 0.1, n))
    # the puck: pressed grains on a jittered grid, flat side up; a looser edge; grains left on the wall above it
    g = np.arange(-PUCK_R, PUCK_R + PUCK_PITCH, PUCK_PITCH)
    GX, GY = np.meshgrid(g, g)
    x = GX.ravel() + rng.uniform(-0.5, 0.5, GX.size) * PUCK_PITCH
    y = GY.ravel() + rng.uniform(-0.5, 0.5, GX.size) * PUCK_PITCH
    keep = np.hypot(x, y) < PUCK_R
    x, y = x[keep], y[keep]
    n = len(x)
    r = np.hypot(x, y)
    loose = rng.random(n) < DS.smoothstep(PUCK_RING, PUCK_R, r) * 0.8
    d = np.clip(0.026 * np.exp(0.35 * rng.standard_normal(n)), 0.012, 0.06)
    R = np.where(loose[:, None, None], _random_rotations(rng, n), _lying(rng, n, 0.28))
    flat = np.where(loose, 0.85, rng.uniform(0.55, 0.75, n))
    e = np.where(loose, rng.uniform(0.0, 0.006, n), rng.uniform(0.0005, 0.004, n))
    parts = [dict(x=x, y=y, d=d, shape=rng.integers(0, N_CHIPS, n), R=R, flat=flat, e=e, kind=np.zeros(n, np.int8), tamp=np.where(loose, 0.5, 1.0))]
    n = 300                                            # crumbs that survive at the edge, in the gap the base never reached
    rr, th = rng.uniform(PUCK_RING + 0.04, PUCK_R - 0.015, n), rng.uniform(-np.pi, np.pi, n)
    d = 0.03 + 0.045 * rng.random(n) ** 2
    parts.append(dict(x=rr * np.cos(th), y=rr * np.sin(th), d=d, shape=N_CHIPS + rng.integers(0, N_CLUMPS, n), R=_lying(rng, n, 0.6),
                      flat=np.full(n, 0.8), e=rng.uniform(-0.15, 0.1, n) * d, kind=np.ones(n, np.int8), tamp=np.full(n, 0.4)))
    n = 480                                            # stuck to the steel, densest just above the puck, gone by ~8 mm
    th = rng.uniform(-np.pi, np.pi, n)
    h = np.minimum(rng.exponential(0.2, n), 0.68) + 0.01
    d = np.clip(0.022 * np.exp(0.35 * rng.standard_normal(n)), 0.01, 0.05)
    rr = DS.wall_r(DS.PUCK + h) - 0.3 * d
    parts.append(dict(x=rr * np.cos(th), y=rr * np.sin(th), d=d, shape=rng.integers(0, N_CHIPS, n), R=_random_rotations(rng, n),
                      flat=np.full(n, 0.9), e=DS.PUCK + h, kind=np.full(n, 2, np.int8), tamp=np.full(n, 0.2)))
    for k in parts[0]:
        pop['puck_' + k] = np.concatenate([p[k] for p in parts])
    return pop


def _layer_sizes(pop):
    return {'dose_heap_chips': len(pop['chip_z']), 'dose_heap_clumps': len(pop['clump_z']), 'dose_puck_grains': len(pop['puck_x'])}


def _layer(col, name, n, shapes):
    me = bpy.data.meshes.new(name)
    me.vertices.add(n)
    for nm, kind in (('vis', 'FLOAT'), ('shape', 'INT'), ('xf', 'FLOAT4X4'), ('id', 'INT'), ('tamp', 'FLOAT')):
        me.attributes.new(nm, kind, 'POINT')
    me.attributes['id'].data.foreach_set('value', np.arange(n, dtype=np.int32))
    ob = C.obj_new(name, me, col)
    ob.modifiers.new('grains', 'NODES').node_group = gn.layer_instancer(f'{name}_instancer', shapes)
    return ob


def _xf(R, scale, pos, crush=None):
    """Column-major 4x4 instance matrices: world crush (n, 3) x rotation (n, 3, 3) x local scale (n, 3), then position."""
    A = R * scale[:, None, :]
    if crush is not None:
        A = crush[:, :, None] * A
    Mx = np.zeros((len(pos), 4, 4), np.float32)
    Mx[:, :3, :3] = A
    Mx[:, :3, 3] = pos
    Mx[:, 3, 3] = 1.0
    return Mx.transpose(0, 2, 1).ravel()


def _align(gx, gy):
    """Rotations taking +z to the surface normal of a height field with gradient (gx, gy)."""
    n = np.stack([-gx, -gy, np.ones_like(gx)], -1)
    n /= np.linalg.norm(n, axis=1, keepdims=True)
    t1 = np.cross(np.array([0.0, 1.0, 0.0])[None, :], n)
    t1 /= np.linalg.norm(t1, axis=1, keepdims=True)
    return np.stack([t1, np.cross(n, t1), n], -1)


def _set_layer(me, vis, xf, pos):
    me.vertices.foreach_set('co', pos.astype(np.float32).ravel())
    me.attributes['vis'].data.foreach_set('value', vis.astype(np.float32))
    me.attributes['xf'].data.foreach_set('value', xf)
    me.update()


def _grain_layers(scene, pl, cfg, data):
    """Per-(sub)frame placement of the heap's surface grains and clumps (level sets of the growing heap, DS.Skin), their
    crushing under the tamper, and the pressed puck that replaces them while the tamper base covers the bed."""
    pop = dict(np.load(C.CACHE / SKIN_FILE))
    tm = cfg['times']
    f0 = int(round(C.T['dose'] * C.FPS))
    pour = [k for k in range(len(data['apex'])) if C.time_of(f0 + k) < tm['off']]
    skin = DS.Skin(data['apex'][pour, :2].astype(float).mean(0), pl.X, pl.B)
    top = float(data['apex'][:, 2].max())
    lo, hi = tm['down'], tm['tamp']
    for _ in range(40):                               # the tamper face reaches the top of the heap
        mid = 0.5 * (lo + hi)
        lo, hi = (mid, hi) if cfg['tamper'](mid) > top + 0.03 else (lo, mid)
    t_touch, t_swap = hi, tm['tamp'] - 0.4 / C.FPS
    layers = []
    for key, name in (('chip', 'dose_heap_chips'), ('clump', 'dose_heap_clumps')):
        me = scene.objects[name].data
        me.attributes['shape'].data.foreach_set('value', pop[key + '_shape'].astype(np.int32))
        me.attributes['tamp'].data.foreach_set('value', np.zeros(len(me.vertices), np.float32))
        layers.append(dict(me=me, key=key, th=pop[key + '_th'], z=pop[key + '_z'], u=pop[key + '_u'], d=pop[key + '_d'],
                           R=pop[key + '_R'], e=pop[key + '_e'], frozen=None))
    sample = lambda F, x, y: DS.sample_grid(F, pl.X[0], pl.dx, x, y)

    def heap(L, t, H, gx, gy, zb):
        n = len(L['z'])
        if t >= t_swap:
            return np.zeros(n), np.zeros(16 * n, np.float32), np.zeros((n, 3))
        if t < t_touch:
            x, y, r, depth, born = skin.place(H, L['th'], L['z'])
        else:                                         # under the tamper: the grains stay put and ride the pressed bed
            if L['frozen'] is None:
                L['frozen'] = skin.place(pl.field(t_touch), L['th'], L['z'])
            x, y, r, depth, born = L['frozen']
            depth = np.zeros(n)
            if L.get('frozen_g') is None:
                Ht = pl.field(t_touch)
                gyt, gxt = np.gradient(Ht, pl.dx)
                L['frozen_g'] = np.hypot(sample(gxt, x, y), sample(gyt, x, y))
        hs = sample(H, x, y)
        sx, sy = sample(gx, x, y), sample(gy, x, y)
        g = np.hypot(sx, sy) if t < t_touch else L['frozen_g']
        d = L['d']
        p = r * np.sqrt(1 + g * g) / (np.maximum(g, 0.25) * SKIN_Q)
        vis = born * np.clip((p - L['u']) / 0.12, 0.0, 1.0) * (1 - DS.smoothstep(0.3 * d, 0.9 * d, depth))
        z = hs - depth + L['e'] * d - (1 - vis) * 0.6 * d
        # the tamper face: grains under it are pressed flat and spread a little before the puck replaces them
        under = np.hypot(x, y) < DS.TAMPER_R
        k = np.where(under, DS.smoothstep(0.08, 0.0, zb - hs), 0.0)
        z = np.where(under, np.minimum(z, zb - 0.25 * d * (1 - 0.7 * k)), z)
        crush = np.stack([1 + 0.35 * k, 1 + 0.35 * k, 1 - 0.7 * k], -1)
        R = L['R'] if L['key'] == 'chip' else _align(sx, sy) @ L['R']
        s = 0.5 * d * (0.55 + 0.45 * vis)
        pos = np.stack([x, y, z], -1)
        return vis, _xf(R, np.repeat(s[:, None], 3, 1), pos, crush), pos

    # the puck: static, shown from the moment the base has pressed it (wall grains as the base passes them)
    pm = scene.objects['dose_puck_grains'].data
    pm.attributes['shape'].data.foreach_set('value', pop['puck_shape'].astype(np.int32))
    pm.attributes['tamp'].data.foreach_set('value', pop['puck_tamp'].astype(np.float32))
    Hend = data['H'][-1].astype(np.float64)
    px, py, pd, kind = pop['puck_x'], pop['puck_y'], pop['puck_d'], pop['puck_kind']
    hs = sample(Hend, px, py)
    half = 0.5 * pd
    pz = np.where(kind == 0, hs + pop['puck_e'] - 0.55 * pop['puck_flat'] * half,
                  np.where(kind == 1, hs + pop['puck_e'], pop['puck_e']))
    ppos = np.stack([px, py, pz], -1)
    pscale = np.stack([half * 1.2, half * 1.2, half * pop['puck_flat']], -1)
    pscale[kind != 0] = half[kind != 0, None] * np.array([1.0, 1.0, 1.0])
    pscale[kind == 1, 2] *= pop['puck_flat'][kind == 1]
    pxf = _xf(pop['puck_R'], pscale, ppos)
    ts = np.linspace(tm['down'], tm['tamp'], 400)
    zs = np.array([cfg['tamper'](t) for t in ts])
    t_pass = np.where(kind == 2, np.interp(pz, zs[::-1], ts[::-1]), t_swap)

    def update(t, H):
        zb = cfg['tamper'](min(t, tm['lift']))
        gy, gx = np.gradient(H, pl.dx)
        for L in layers:
            vis, xf, pos = heap(L, t, H, gx, gy, zb)
            _set_layer(L['me'], vis, xf, pos)
        _set_layer(pm, (t >= t_pass).astype(np.float32), pxf, ppos)

    return update


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


_CLOUDS = [('dose_grains', [DS.GRAIN], 'chips', 'grain'), ('dose_clumps', [DS.CLUMP], 'clumps', 'clump'),
           ('dose_fines', [DS.FINE, DS.PUFF], 'chips', 'fines')]


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
    grains = _grain_layers(scene, pl, cfg, data)

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
        uv = np.stack([x, y], -1)
        bed.uv_layers[0].data.foreach_set('uv', uv[loops].astype(np.float32).ravel())
        zb = cfg['tamper'](min(t, tm['lift']))
        press = float(np.clip((apex0 - zb) / (apex0 - DS.PUCK), 0.0, 1.0)) ** 2
        tamped = press * np.where(r < 2.78, 1.0, 0.35)
        bed.attributes['tamped'].data.foreach_set('value', tamped.astype(np.float32))
        bed.update()
        grains(t, H)
        # grains in flight and on the heap
        pos, size = pl.particles(t)
        for me, idx in clouds + [(puff, pi)]:
            me.vertices.foreach_set('co', pos[idx].astype(np.float32).ravel())
            me.attributes['size'].data.foreach_set('value', size[idx].astype(np.float32))
            me.update()

    C.on_frame(scene.name, update)
    update(C.time_of(scene.frame_start))
