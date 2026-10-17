"""Physically based materials for Cycles (Principled BSDF, Blender 5.x socket names).

Every material uses measured or physically plausible values: metal F0 colours, dielectric IOR, subsurface
mean free paths in cm (1 unit = 1 cm), absorption coefficients per cm. Roughness is never uniform: it is
modulated by procedural noise, and every surface gets high-frequency normal detail.
"""
import math

import bpy
import numpy as np

from .common import V3_ASSETS, ASSETS

_CACHE = {}


class Graph:
    """Tiny helper to write shader node graphs in Python."""

    def __init__(self, name, principled=True):
        self.mat = bpy.data.materials.new(name)
        self.nt = self.mat.node_tree
        self.nt.nodes.clear()
        self.out = self.nt.nodes.new('ShaderNodeOutputMaterial')
        self.out.target = 'CYCLES'
        self.bsdf = None
        if principled:
            self.bsdf = self.node('ShaderNodeBsdfPrincipled', subsurface_method='RANDOM_WALK', distribution='MULTI_GGX')
            self.link(self.bsdf.outputs[0], self.out.inputs['Surface'])

    def node(self, kind, inputs=None, **props):
        nd = self.nt.nodes.new(kind)
        for k, v in props.items():
            setattr(nd, k, v)
        for k, v in (inputs or {}).items():
            self.set(nd.inputs[k], v)
        return nd

    def set(self, socket, v):
        if isinstance(v, bpy.types.NodeSocket):
            self.nt.links.new(v, socket)
        elif isinstance(v, bpy.types.Node):
            self.nt.links.new(v.outputs[0], socket)
        else:
            if isinstance(v, (tuple, list)) and len(v) == 3 and socket.type == 'RGBA':
                v = (*v, 1.0)
            socket.default_value = v

    def link(self, a, b):
        self.nt.links.new(a, b)

    # ---- building blocks
    def coord(self, kind='Object'):
        return self.node('ShaderNodeTexCoord').outputs[kind]

    def noise(self, vec, scale, detail=4.0, rough=0.55, distortion=0.0, dims='3D', w=0.0, lac=2.0):
        nd = self.node('ShaderNodeTexNoise', {'Vector': vec, 'Scale': scale, 'Detail': detail, 'Roughness': rough,
                                               'Distortion': distortion, 'Lacunarity': lac}, noise_dimensions=dims)
        if dims == '4D':
            self.set(nd.inputs['W'], w)
        return nd

    def voronoi(self, vec, scale, feature='F1', randomness=1.0, dims='3D'):
        return self.node('ShaderNodeTexVoronoi', {'Vector': vec, 'Scale': scale, 'Randomness': randomness},
                         feature=feature, voronoi_dimensions=dims)

    def math(self, op, a, b=0.0, clamp=False):
        nd = self.node('ShaderNodeMath', operation=op, use_clamp=clamp)
        self.set(nd.inputs[0], a)
        self.set(nd.inputs[1], b)
        return nd.outputs[0]

    def map_range(self, v, a, b, c, d, clamp=True):
        nd = self.node('ShaderNodeMapRange', clamp=clamp)
        self.set(nd.inputs['Value'], v)
        for name, x in zip(('From Min', 'From Max', 'To Min', 'To Max'), (a, b, c, d)):
            self.set(nd.inputs[name], x)
        return nd.outputs['Result']

    def mix_rgb(self, fac, a, b, blend='MIX'):
        nd = self.node('ShaderNodeMix', data_type='RGBA', blend_type=blend)
        self.set(nd.inputs[0], fac)
        self.set(nd.inputs[6], a)
        self.set(nd.inputs[7], b)
        return nd.outputs[2]

    def ramp(self, fac, stops):
        nd = self.node('ShaderNodeValToRGB')
        self.set(nd.inputs[0], fac)
        el = nd.color_ramp.elements
        while len(el) > len(stops):
            el.remove(el[-1])
        while len(el) < len(stops):
            el.new(0.5)
        for e, (pos, col) in zip(el, stops):
            e.position = pos
            e.color = (*col, 1.0) if len(col) == 3 else col
        return nd.outputs[0]

    def bump(self, height, strength, distance=0.01, normal=None):
        nd = self.node('ShaderNodeBump', {'Strength': strength, 'Distance': distance, 'Height': height})
        if normal is not None:
            self.set(nd.inputs['Normal'], normal)
        return nd.outputs[0]

    def attr(self, name, out='Fac'):
        return self.node('ShaderNodeAttribute', attribute_name=name).outputs[out]

    def image(self, path, colorspace='sRGB', vec=None, interpolation='Cubic', extension='REPEAT'):
        img = bpy.data.images.load(str(path), check_existing=True)
        img.colorspace_settings.name = colorspace
        nd = self.node('ShaderNodeTexImage', interpolation=interpolation, extension=extension)
        nd.image = img
        if vec is not None:
            self.set(nd.inputs['Vector'], vec)
        return nd

    def mapping(self, vec, scale=(1, 1, 1), loc=(0, 0, 0), rot=(0, 0, 0)):
        return self.node('ShaderNodeMapping', {'Vector': vec, 'Scale': scale, 'Location': loc, 'Rotation': rot}).outputs[0]

    def p(self, **inputs):
        for k, v in inputs.items():
            self.set(self.bsdf.inputs[k.replace('_', ' ')], v)


def get(name):
    """Material by name, built once."""
    if name not in _CACHE:
        _CACHE[name] = BUILDERS[name]()
    return _CACHE[name]


def micro_normal(g, scale=60.0, strength=0.03, base=None):
    """High-frequency surface normal: two octaves of fine noise as bump."""
    n = g.noise(g.coord(), scale, detail=8.0, rough=0.65)
    return g.bump(n.outputs['Fac'], strength, 0.002, base)


def varied_roughness(g, lo, hi, scale=3.0, fine=0.0):
    n = g.noise(g.coord(), scale, detail=6.0, rough=0.6)
    r = g.map_range(n.outputs['Fac'], 0.3, 0.7, lo, hi)
    if fine:
        f = g.noise(g.coord(), scale * 25, detail=4.0)
        r = g.math('ADD', r, g.map_range(f.outputs['Fac'], 0.3, 0.7, -fine, fine))
    return r


# ------------------------------------------------------------------ metals
def copper():
    g = Graph('copper')
    # polished copper, F0 of copper metal; lacquer coat; polish swirl and slight tarnish variation
    tarn = g.noise(g.coord(), 2.2, detail=5.0)
    col = g.mix_rgb(g.map_range(tarn.outputs['Fac'], 0.35, 0.75, 0.0, 0.35), (0.93, 0.6, 0.47), (0.78, 0.43, 0.3))
    tan = g.node('ShaderNodeTangent', direction_type='RADIAL', axis='Z').outputs[0]
    g.p(Base_Color=col, Metallic=1.0, Roughness=varied_roughness(g, 0.14, 0.26, 2.5, 0.03), Anisotropic=0.35, Tangent=tan,
        Coat_Weight=0.35, Coat_Roughness=0.05, Coat_IOR=1.5, Normal=micro_normal(g, 80.0, 0.015))
    return g.mat


def steel(name='steel', color=(0.6, 0.59, 0.56), lo=0.18, hi=0.3, aniso=0.55, swirl=True):
    g = Graph(name)
    tan = g.node('ShaderNodeTangent', direction_type='RADIAL', axis='Z').outputs[0]
    g.p(Base_Color=color, Metallic=1.0, Roughness=varied_roughness(g, lo, hi, 3.0, 0.04), Anisotropic=aniso if swirl else 0.0,
        Tangent=tan, Normal=micro_normal(g, 120.0, 0.02))
    return g.mat


def burr_steel():
    """Ground tool steel of the burrs: lapped faces with fine circular grinding marks, slightly darker in the grooves."""
    g = Graph('burr_steel')
    tan = g.node('ShaderNodeTangent', direction_type='RADIAL', axis='Z').outputs[0]
    ao = g.node('ShaderNodeAmbientOcclusion', {'Distance': 0.15}, samples=8, only_local=True)
    col = g.mix_rgb(g.map_range(ao.outputs['AO'], 0.2, 1.0, 1.0, 0.0), (0.58, 0.58, 0.6), (0.3, 0.3, 0.31))
    # concentric grinding marks: noise stretched along the tangent direction
    marks = g.noise(g.mapping(g.coord(), (1.0, 1.0, 1.0)), 90.0, detail=3.0)
    rough = g.math('ADD', varied_roughness(g, 0.2, 0.34, 4.0), g.map_range(marks.outputs['Fac'], 0.3, 0.7, -0.05, 0.05))
    g.p(Base_Color=col, Metallic=1.0, Roughness=rough, Anisotropic=0.7, Tangent=tan, Normal=micro_normal(g, 150.0, 0.03))
    return g.mat


def chrome():
    g = Graph('chrome')
    g.p(Base_Color=(0.55, 0.556, 0.554), Metallic=1.0, Roughness=varied_roughness(g, 0.03, 0.07, 3.0), Normal=micro_normal(g, 200.0, 0.006))
    return g.mat


def basket_floor():
    """Underside of the filter basket: polished stainless with 0.3 mm holes on a hexagonal pitch (UV-mapped mask)."""
    g = Graph('basket_floor')
    mask = g.image(ASSETS / 'basket_holes.png', 'Non-Color', g.coord('UV'), 'Cubic', 'CLIP')
    hole_f = g.node('ShaderNodeSeparateColor', {'Color': mask.outputs['Color']}).outputs[0]
    col = g.mix_rgb(hole_f, (0.62, 0.6, 0.57), (0.01, 0.01, 0.01))
    rough = g.math('ADD', varied_roughness(g, 0.12, 0.22, 4.0), g.math('MULTIPLY', hole_f, 0.6))
    bump = g.bump(g.math('SUBTRACT', 1.0, hole_f), 0.6, 0.004)
    g.p(Base_Color=col, Metallic=g.math('SUBTRACT', 1.0, hole_f), Roughness=rough, Normal=bump)
    return g.mat


# ------------------------------------------------------------------ ceramics, wood, stone
def porcelain():
    g = Graph('porcelain')
    # white glazed porcelain: slightly translucent body (SSS ~1 mm), glassy glaze coat, orange-peel waviness
    peel = g.noise(g.coord(), 9.0, detail=3.0)
    n = g.bump(peel.outputs['Fac'], 0.025, 0.01)
    g.p(Base_Color=(0.85, 0.84, 0.8), Roughness=varied_roughness(g, 0.12, 0.2, 2.0), IOR=1.5,
        Subsurface_Weight=0.25, Subsurface_Radius=(0.12, 0.09, 0.07), Subsurface_Scale=0.1,
        Coat_Weight=1.0, Coat_Roughness=varied_roughness(g, 0.01, 0.035, 1.5), Coat_IOR=1.52, Coat_Normal=n, Normal=n)
    return g.mat


def walnut():
    g = Graph('walnut')
    uv = g.mapping(g.coord('UV'), (1.0, 2.5, 1.0))
    d = g.image(V3_ASSETS / 'walnut_diffuse_1k.jpg', 'sRGB', uv)
    nm = g.image(V3_ASSETS / 'walnut_nor_gl_1k.jpg', 'Non-Color', uv)
    r = g.image(V3_ASSETS / 'walnut_rough_1k.jpg', 'Non-Color', uv)
    nmap = g.node('ShaderNodeNormalMap', {'Color': nm.outputs['Color'], 'Strength': 0.8})
    col = g.mix_rgb(0.25, d.outputs['Color'], (0.45, 0.28, 0.18), 'MULTIPLY')
    g.p(Base_Color=col, Roughness=g.map_range(r.outputs['Color'], 0, 1, 0.45, 0.8), Normal=nmap.outputs[0],
        Coat_Weight=0.6, Coat_Roughness=0.12, Coat_Normal=nmap.outputs[0])
    return g.mat


def granite():
    """Gallura granite: pink feldspar, white quartz, black biotite, honed and waxed."""
    g = Graph('granite')
    co = g.coord()
    feld = g.voronoi(co, 3.2, 'F1', 1.0).outputs['Color']
    quartz = g.voronoi(co, 5.5, 'F1', 1.0).outputs['Distance']
    bio = g.voronoi(co, 14.0, 'F1', 1.0).outputs['Distance']
    base = g.mix_rgb(g.node('ShaderNodeSeparateColor', {'Color': feld}).outputs[0], (0.42, 0.27, 0.22), (0.55, 0.36, 0.3))
    base = g.mix_rgb(g.math('LESS_THAN', quartz, 0.18), base, (0.72, 0.7, 0.66))
    base = g.mix_rgb(g.math('LESS_THAN', bio, 0.12), base, (0.03, 0.025, 0.022))
    speck = g.noise(co, 60.0, detail=2.0)
    base = g.mix_rgb(g.math('GREATER_THAN', speck.outputs['Fac'], 0.72), base, (0.02, 0.02, 0.02))
    g.p(Base_Color=base, Roughness=varied_roughness(g, 0.18, 0.32, 1.0, 0.03), Coat_Weight=0.5, Coat_Roughness=0.08,
        Normal=micro_normal(g, 40.0, 0.04))
    return g.mat


def cork():
    g = Graph('cork')
    co = g.coord()
    cells = g.voronoi(co, 18.0, 'F1')
    n = g.noise(co, 8.0, detail=6.0)
    col = g.ramp(n.outputs['Fac'], [(0.3, (0.18, 0.09, 0.04)), (0.55, (0.32, 0.18, 0.09)), (0.75, (0.45, 0.27, 0.14))])
    pores = g.math('LESS_THAN', cells.outputs['Distance'], 0.14)
    col = g.mix_rgb(pores, col, (0.08, 0.04, 0.02))
    g.p(Base_Color=col, Roughness=0.85, Normal=g.bump(g.math('SUBTRACT', 1.0, pores), 0.5, 0.02))
    return g.mat


# ------------------------------------------------------------------ coffee
def bean():
    """Roasted arabica: deep brown with lighter flanks, a little oil, silverskin in the centre cut (mesh attribute 'groove'),
    wrinkled surface, very short subsurface scattering."""
    g = Graph('bean')
    co = g.coord()
    tone = g.noise(co, 6.0, detail=6.0)
    # medium roast (CIELAB of whole beans L* 40-45 converted to linear RGB, warmed slightly towards a photo reference)
    col = g.ramp(tone.outputs['Fac'], [(0.25, (0.045, 0.025, 0.016)), (0.55, (0.085, 0.05, 0.032)), (0.8, (0.125, 0.075, 0.05))])
    variant = g.node('ShaderNodeObjectInfo').outputs['Random']
    col = g.mix_rgb(g.math('MULTIPLY', variant, 0.5), col, (0.06, 0.034, 0.022))
    skin = g.attr('groove', 'Fac')
    col = g.mix_rgb(g.math('MULTIPLY', skin, 0.9), col, (0.32, 0.2, 0.1))
    oil = g.noise(co, 14.0, detail=3.0)
    rough = g.map_range(oil.outputs['Fac'], 0.35, 0.7, 0.28, 0.55)
    wrinkles = g.noise(co, 22.0, detail=8.0, rough=0.7, distortion=0.4)
    pores = g.voronoi(co, 140.0, 'F1')
    h = g.math('ADD', wrinkles.outputs['Fac'], g.math('MULTIPLY', pores.outputs['Distance'], 0.35))
    g.p(Base_Color=col, Roughness=rough, Subsurface_Weight=0.15, Subsurface_Radius=(0.05, 0.02, 0.01), Subsurface_Scale=0.1,
        Coat_Weight=g.map_range(oil.outputs['Fac'], 0.55, 0.75, 0.0, 0.35), Coat_Roughness=0.15,
        Normal=g.bump(h, 0.35, 0.01))
    return g.mat


def bean_inner():
    """Fracture faces: the porous, lighter inside of a roasted bean."""
    g = Graph('bean_inner')
    co = g.coord()
    cells = g.voronoi(co, 90.0, 'F1')
    cells2 = g.voronoi(co, 260.0, 'F1')
    n = g.noise(co, 30.0, detail=5.0)
    # the inside is lighter, redder and more saturated than the surface (powder CIELAB L* 42-50, a* 7-10)
    col = g.ramp(n.outputs['Fac'], [(0.3, (0.09, 0.05, 0.03)), (0.6, (0.14, 0.08, 0.05)), (0.85, (0.19, 0.11, 0.07))])
    h = g.math('ADD', cells.outputs['Distance'], g.math('MULTIPLY', cells2.outputs['Distance'], 0.5))
    g.p(Base_Color=col, Roughness=0.82, Subsurface_Weight=0.1, Subsurface_Radius=(0.04, 0.02, 0.01), Subsurface_Scale=0.1,
        Normal=g.bump(h, 0.6, 0.006))
    return g.mat


GROUNDS_ALBEDO = (0.066, 0.0254, 0.0138)   # linear: median coffee grain (fracture faces, CIELAB L* 21, C 18, hue 50)
# Pressed grains, relative to loose ones. Compaction raises the reflectance a little (Pietsch, ASIC 2025) and a tamped
# puck photographs ~1.6x lighter than the loose mound in sRGB (same light, same hue), but in this shot the flat puck
# faces the key while the heap shades itself, which already makes it ~2-3x brighter: the tint is calibrated on the
# frame-238 crop so the puck lands at L* ~35 against the heap's ~24, keeping the hue.
PRESSED_TINT = (0.47, 0.35, 0.245)
PRESSED_BED = 0.3                            # the bed under the pressed grains only shows in the gaps between them


def grounds():
    """The bed of ground espresso under the grains (the dose shot instances real-size grains and clumps over it, see
    shot_dose): what shows between them is grit and the velvet of fines that coats and fills the gaps. Procedural at real
    scale on UV = (x, y) in cm, so the texture rides the rising bed: 0.16 mm grit domes over 70 um grit and 40 um cell
    fragments, each its own shade, deep and dark between them; true micro-displacement. 'tamped' (0..1, a mesh
    attribute): pressed flat by the polished tamper base; the puck's flattened grains are instanced over it (shot_dose),
    so this is what shows in the seams between them: fines packed into 20-100 um gaps, dark, with pores, matte."""
    g = Graph('grounds')
    p = g.coord('UV')
    tamp = g.attr('tamped', 'Fac')
    c1 = g.voronoi(p, 1 / 0.016, randomness=0.95)
    c2 = g.voronoi(p, 1 / 0.007)
    edge = g.node('ShaderNodeTexVoronoi', {'Vector': p, 'Scale': 1 / 0.018, 'Randomness': 1.0}, feature='DISTANCE_TO_EDGE')
    pc = g.voronoi(p, 1 / 0.018)                                          # the pressed grains (same cells as `edge`)
    fines = g.noise(p, 250.0, detail=3.0, rough=0.6)
    gaps = g.noise(p, 40.0, detail=2.0, rough=0.5)
    mottle = g.noise(p, 1.6, detail=3.0, rough=0.5)
    h1 = g.map_range(c1.outputs['Distance'], 0.0, 0.8, 1.0, 0.0)
    h2 = g.map_range(c2.outputs['Distance'], 0.0, 0.7, 1.0, 0.0)
    pore = g.math('MAXIMUM', g.map_range(edge.outputs['Distance'], 0.0, 0.07, 0.0, 1.0),
                  g.map_range(gaps.outputs['Fac'], 0.45, 0.6, 1.0, 0.0))       # 0 on some of the boundaries between grains
    loose_h = g.math('ADD', g.math('ADD', g.math('MULTIPLY', h1, 0.6), g.math('MULTIPLY', h2, 0.28)),
                     g.math('MULTIPLY', fines.outputs['Fac'], 0.12))
    pressed_h = g.math('ADD', g.math('MULTIPLY', pore, 0.5), g.math('ADD', g.math('MULTIPLY', h2, 0.3), g.math('MULTIPLY', fines.outputs['Fac'], 0.2)))
    height = g.node('ShaderNodeMix', {'Factor': tamp, 'A': loose_h, 'B': pressed_h}).outputs[0]
    # loose: the gaps between grit grains fall into shadow; pressed: flat grains, pores between some of them
    loose_k = g.math('MULTIPLY', g.math('MULTIPLY', g.map_range(loose_h, 0.1, 0.85, 0.2, 1.2),
                                        g.map_range(c1.outputs['Color'], 0.0, 1.0, 0.6, 1.45)), 0.62)
    # pressed: what shows between the puck's flattened grains is fines packed into 20-100 um gaps, in their shadow:
    # dark (0.1-0.2x a grain) along the seams and in the pores, and the grains below them, each its own shade
    seam = g.map_range(edge.outputs['Distance'], 0.0, 0.12, 0.3, 1.0)
    cell = g.ramp(g.node('ShaderNodeTexWhiteNoise', {'Vector': pc.outputs['Position']}, noise_dimensions='3D').outputs['Value'],
                  [(0.0, (0.45,) * 3), (0.1, (0.64,) * 3), (0.5, (1.0,) * 3), (0.9, (1.57,) * 3), (1.0, (2.0,) * 3)])
    pressed_k = g.math('MULTIPLY', g.math('MULTIPLY', g.math('MULTIPLY', g.map_range(pore, 0.0, 1.0, 0.3, 1.0), seam), cell), PRESSED_BED)
    k = g.node('ShaderNodeMix', {'Factor': tamp, 'A': loose_k, 'B': pressed_k}).outputs[0]
    k = g.math('MULTIPLY', g.math('MULTIPLY', k, g.map_range(c2.outputs['Color'], 0.0, 1.0, 0.8, 1.2)),
               g.map_range(mottle.outputs['Fac'], 0.3, 0.7, 0.85, 1.15))
    col = g.mix_rgb(1.0, GROUNDS_ALBEDO, g.node('ShaderNodeCombineXYZ', {'X': k, 'Y': k, 'Z': k}).outputs[0], 'MULTIPLY')
    col = g.mix_rgb(tamp, col, g.mix_rgb(1.0, col, PRESSED_TINT, 'MULTIPLY'))
    # matte: the fines in the gaps are shaded by the grains around them, so they do not mirror the room
    g.p(Base_Color=col, Roughness=g.map_range(tamp, 0, 1, 0.95, 0.9), Specular_IOR_Level=g.map_range(tamp, 0, 1, 0.3, 0.12))
    disp = g.node('ShaderNodeDisplacement', {'Height': height, 'Midlevel': 0.5, 'Scale': g.map_range(tamp, 0, 1, 0.02, 0.002)})
    g.link(disp.outputs[0], g.out.inputs['Displacement'])
    g.mat.displacement_method = 'BOTH'
    return g.mat


def grain():
    """Loose ground coffee particles in flight."""
    g = Graph('grain')
    rnd = g.node('ShaderNodeObjectInfo').outputs['Random']
    col = g.ramp(rnd, [(0.0, (0.03, 0.015, 0.007)), (0.6, (0.08, 0.042, 0.019)), (1.0, (0.16, 0.09, 0.045))])
    g.p(Base_Color=col, Roughness=0.7, Normal=micro_normal(g, 400.0, 0.2))
    return g.mat


def espresso():
    """Espresso as a dielectric liquid (IOR 1.34) filled with an absorbing medium.

    Absorption: coffee solids at espresso strength (~10 % TDS) absorb about 140 per cm in the blue (anchored on the
    measured 405 nm extinction of brew solids), about 55 in the green and 11 in the red, so a 0.3 mm film reads amber,
    a 2-3 mm stream backlit reads maroon and 5 mm reads near black. Cycles' Volume Absorption uses
    sigma_a = density * (1 - colour); density 140 with colour 1 - sigma / 140. The value node 'tds' (1 = 10 % TDS, keyable)
    scales it: the first drops are about 2.5x stronger.
    Crema streaks carried by the flow (mesh attribute 'foam') scatter like the crema itself."""
    g = Graph('espresso')
    foam = g.attr('foam', 'Fac')
    g.p(Base_Color=(1.0, 1.0, 1.0), Roughness=varied_roughness(g, 0.01, 0.04, 6.0), IOR=1.345, Transmission_Weight=g.math('SUBTRACT', 1.0, g.math('MULTIPLY', foam, 0.85)),
        Subsurface_Weight=foam, Subsurface_Radius=(0.25, 0.1, 0.04), Subsurface_Scale=0.1)
    tds = g.node('ShaderNodeValue')
    tds.name = 'tds'
    tds.outputs[0].default_value = 1.0
    tds = tds.outputs[0]
    absorb = g.node('ShaderNodeVolumeAbsorption', {'Color': (1 - 11 / 140, 1 - 55 / 140, 0.0), 'Density': g.math('MULTIPLY', tds, 140.0)})
    g.link(absorb.outputs[0], g.out.inputs['Volume'])
    # crema colour where the foam is
    col = g.mix_rgb(foam, (1.0, 1.0, 1.0), (0.42, 0.2, 0.065))
    g.set(g.bsdf.inputs['Base Color'], col)
    return g.mat


def crema():
    """Espresso crema: a wet foam of 10-150 um CO2 bubbles in emulsified oils over near-black coffee.

    Optics: light scatters inside the foam (random-walk SSS; transport mean free path ~1.6-2x the bubble size, so a
    short, red-shifted radius), the top is glossy (fresh wet bubble films, roughness 0.08-0.2) with a thin oily sheen.
    Colour (sampled from top-down photos of fresh doubles, as albedo under SSS): hazelnut centre, reddish-brown mid,
    darker at the wall where the oldest foam is pushed. Detail at three scales: the 'tiger' marbling drawn out by the
    swirl of the pour (mesh attribute 'tiger', -1..1), dark specks of fines (0.1-0.3 mm) caught in the foam, and the
    bubble relief (20-60 um and 100-200 um cells, a few larger ones as separate caps).
    Mesh attributes (point domain): 'rim' 0 centre .. 1 at the cup wall, 'fresh' new dark coffee under the stream,
    'age' 0 newest .. 1 oldest foam (darker), 'tiger' marbling."""
    g = Graph('crema')
    co = g.coord()
    rim = g.attr('rim', 'Fac')
    age = g.attr('age', 'Fac')
    fresh = g.attr('fresh', 'Fac')
    tiger = g.attr('tiger', 'Fac')
    # tone by position and age
    base = g.ramp(g.math('MAXIMUM', g.math('MULTIPLY', rim, 0.8), age),
                  [(0.0, (0.42, 0.2, 0.07)), (0.5, (0.34, 0.15, 0.048)), (0.82, (0.22, 0.083, 0.024)), (1.0, (0.1, 0.034, 0.01))])
    # marbling: lighter foam streaks and darker coffee-rich ones, with a little fine-scale breakup
    brk = g.noise(co, 18.0, detail=3.0)
    tg = g.math('ADD', tiger, g.map_range(brk.outputs['Fac'], 0.3, 0.7, -0.25, 0.25))
    base = g.mix_rgb(g.map_range(tg, 0.1, 0.9, 0.0, 0.45), base, (0.58, 0.33, 0.14))
    base = g.mix_rgb(g.map_range(tg, -0.15, -0.9, 0.0, 0.4), base, (0.15, 0.055, 0.016))
    # specks of fines: a random third of small cells, dark round dots
    sp = g.voronoi(co, 32.0, 'F1')
    pick = g.math('LESS_THAN', g.node('ShaderNodeSeparateColor', {'Color': sp.outputs['Color']}).outputs[0], 0.3)
    dot = g.math('MULTIPLY', pick, g.map_range(sp.outputs['Distance'], 0.22, 0.1, 0.0, 0.8))
    base = g.mix_rgb(dot, base, (0.06, 0.022, 0.007))
    # tiny light foam heads
    hd = g.voronoi(co, 140.0, 'F1')
    head = g.math('MULTIPLY', g.math('GREATER_THAN', g.node('ShaderNodeSeparateColor', {'Color': hd.outputs['Color']}).outputs[1], 0.8),
                  g.map_range(hd.outputs['Distance'], 0.2, 0.05, 0.0, 0.4))
    base = g.mix_rgb(head, base, (0.66, 0.44, 0.24))
    base = g.mix_rgb(fresh, base, (0.03, 0.011, 0.004))
    # relief: micro-bubbles and a soft undulation of the foam
    small = g.voronoi(co, 260.0, 'F1')
    mid = g.voronoi(co, 75.0, 'F1')
    und = g.noise(co, 9.0, detail=4.0)
    h = g.math('ADD', g.math('ADD', g.math('MULTIPLY', small.outputs['Distance'], 0.3), g.math('MULTIPLY', mid.outputs['Distance'], 0.45)),
               g.math('MULTIPLY', und.outputs['Fac'], 0.8))
    h = g.math('SUBTRACT', h, g.math('MULTIPLY', dot, 0.3))
    rough = g.math('ADD', g.map_range(fresh, 0, 1, 0.16, 0.05), g.map_range(mid.outputs['Color'], 0, 1, -0.06, 0.06))
    g.p(Base_Color=base, Roughness=rough, IOR=1.34,
        Subsurface_Weight=g.map_range(fresh, 0, 1, 0.7, 0.1), Subsurface_Radius=(1.0, 0.5, 0.25), Subsurface_Scale=0.008,
        Subsurface_Anisotropy=0.4, Normal=g.bump(h, 0.45, 0.002),
        Coat_Weight=g.map_range(fresh, 0, 1, 0.3, 0.0), Coat_Roughness=0.1, Coat_IOR=1.47)
    return g.mat


def bubble():
    """A crema bubble cap: thin liquid film, refractive with a hint of thin-film iridescence."""
    g = Graph('bubble')
    g.p(Base_Color=(0.9, 0.8, 0.7), Roughness=0.02, IOR=1.34, Transmission_Weight=1.0, Thin_Wall=True,
        Thin_Film_Thickness=350.0, Thin_Film_IOR=1.34)
    return g.mat


# ------------------------------------------------------------------ table props
def leaf():
    g = Graph('myrtle_leaf')
    n = g.noise(g.coord(), 6.0, detail=4.0)
    col = g.mix_rgb(g.map_range(n.outputs['Fac'], 0.3, 0.7, 0, 1), (0.025, 0.06, 0.018), (0.05, 0.1, 0.03))
    g.p(Base_Color=col, Roughness=0.35, Subsurface_Weight=0.3, Subsurface_Radius=(0.08, 0.2, 0.05), Subsurface_Scale=0.05,
        Coat_Weight=0.6, Coat_Roughness=0.15, Normal=micro_normal(g, 50.0, 0.03))
    return g.mat


def berry():
    g = Graph('myrtle_berry')
    g.p(Base_Color=(0.03, 0.012, 0.035), Roughness=0.4, Sheen_Weight=0.8, Sheen_Tint=(0.5, 0.5, 0.7), Sheen_Roughness=0.6,
        Subsurface_Weight=0.2, Subsurface_Radius=(0.1, 0.02, 0.05), Subsurface_Scale=0.1, Coat_Weight=0.3, Normal=micro_normal(g, 40.0, 0.02))
    return g.mat


def twig():
    g = Graph('twig')
    g.p(Base_Color=(0.07, 0.04, 0.022), Roughness=0.75, Normal=micro_normal(g, 30.0, 0.1))
    return g.mat


def rubber():
    g = Graph('rubber')
    g.p(Base_Color=(0.012, 0.011, 0.01), Roughness=0.6, Normal=micro_normal(g, 60.0, 0.05))
    return g.mat


def gold_spark():
    g = Graph('gold_spark', principled=False)
    em = g.node('ShaderNodeEmission', {'Color': (1.0, 0.62, 0.22), 'Strength': 40.0})
    g.link(em.outputs[0], g.out.inputs['Surface'])
    return g.mat


def steam():
    """Wisps of steam: a sparse scattering medium shaped by animated noise (object attribute 'phase' for time)."""
    g = Graph('steam', principled=False)
    co = g.coord()
    ph = g.attr('phase', 'Fac')
    n = g.noise(co, 0.9, detail=6.0, rough=0.6, distortion=1.4, dims='4D', w=ph)
    dens = g.math('MULTIPLY', g.map_range(n.outputs['Fac'], 0.52, 0.75, 0.0, 1.0), 0.6)
    vol = g.node('ShaderNodeVolumePrincipled', {'Color': (0.9, 0.86, 0.8), 'Density': dens, 'Anisotropy': 0.4})
    g.link(vol.outputs[0], g.out.inputs['Volume'])
    return g.mat


BUILDERS = {
    'copper': copper, 'steel': steel, 'burr_steel': burr_steel, 'chrome': chrome, 'basket_floor': basket_floor,
    'steel_dark': lambda: steel('steel_dark', (0.25, 0.24, 0.23), 0.3, 0.45, 0.4),
    'backsplash': lambda: steel('backsplash', (0.36, 0.35, 0.33), 0.12, 0.2, 0.2, swirl=False),
    'porcelain': porcelain, 'walnut': walnut, 'granite': granite, 'cork': cork,
    'bean': bean, 'bean_inner': bean_inner, 'grounds': grounds, 'grain': grain,
    'espresso': espresso, 'crema': crema, 'bubble': bubble,
    'leaf': leaf, 'berry': berry, 'twig': twig, 'rubber': rubber, 'gold_spark': gold_spark, 'steam': steam,
}


def basket_hole_mask(path, res=4096, radius_cm=2.4, pitch=0.173, hole=0.03, active=2.45):
    """Write the hole pattern of the basket floor as an image (UV 0..1 spans 2*radius_cm). White = hole.
    Precision basket: 0.30 mm holes on a 1.73 mm hexagonal pitch over a 49 mm field (about 715 holes)."""
    xs = (np.arange(res) + 0.5) / res * 2 * radius_cm - radius_cm
    X, Y = np.meshgrid(xs, xs)
    hp = np.stack([X, Y], -1) / pitch
    hr = np.array([1.0, math.sqrt(3.0)])
    a = np.mod(hp, hr) - hr / 2
    b = np.mod(hp - hr / 2, hr) - hr / 2
    d = np.minimum(np.linalg.norm(a, axis=-1), np.linalg.norm(b, axis=-1)) * pitch
    px = 2 * radius_cm / res
    m = np.clip((hole / 2 - d) / px + 0.5, 0, 1) * (np.hypot(X, Y) < active)
    img = bpy.data.images.new('basket_holes', res, res, alpha=False, float_buffer=False)
    rgba = np.ones((res, res, 4), np.float32)
    rgba[..., 0] = rgba[..., 1] = rgba[..., 2] = m
    img.pixels.foreach_set(rgba.ravel())
    img.filepath_raw = str(path)
    img.file_format = 'PNG'
    img.save()
    return img
