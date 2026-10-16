"""Shot 4: bottomless extraction. Beads appear at random holes of the basket floor, grow into pendant drops, slide
and merge towards the lowest point, drip, and within about a second join into one cone that feeds a single stream;
the cup fills and the crema builds under the stream.

Physics (own numpy simulation, 24 sub-steps per frame, CGS units):
- Flow out of the puck: pre-infusion, then the pump ramps the flow to 3 cm^3/s (a fast double, 1.2-2.5 g/s is the
  usual range; a little more reads better at this scale). Liquid first exits through a few random channels (holes of
  the real 0.30 mm / 1.73 mm hexagonal pattern), more open over the next half second.
- Pendant drops: spherical caps whose contact angle grows from 70 to 120 degrees as they fill; above ~8 uL contact-angle
  hysteresis no longer pins them and they creep towards the low point of the slightly domed, slightly tilted floor
  (terminal speed ~1.4 cm/s, viscous), sweeping up the beads they touch. A drop drips when it reaches ~34 uL (a 4 mm
  drop: the capillary length of espresso is sqrt(sigma / rho g) = 2.1 mm, sigma 46 mN/m, rho 1.02 g/cm^3).
- Film drainage: once the floor is wet, the coffee from every hole runs as a film to the central drop. When the central
  drop's inflow passes ~1 cm^3/s it stops dripping and turns into a cone feeding a continuous jet.
- Stream: closed-form ballistic parcels leaving the cone tip at 50-65 cm/s; radius from continuity (Q = pi r^2 v), so it
  thins from ~2.5 mm to ~1.6 mm as it accelerates; the Rayleigh-Plateau varicose mode (lambda = 9 r) grows at
  omega = 0.34 sqrt(sigma / rho r^3) ~ 70 /s, which beads the lower part of the stream like real footage.
- Falling drops: gravity, quadratic air drag (Cd 0.47), mode-2 shape oscillation (f = sqrt(8 sigma / rho R^3) / 2 pi).
- Cup: the volume that arrives (drops + stream) sets the level through the cup's inner profile; foam expands it 25 %.
  Drop impacts send capillary ripples across the surface, the stream digs a crater with dark fresh coffee in it and
  pushes the older, darker crema to the wall.

The liquid (drops, cone, stream) is one metaball family: neighbouring drops blend and pinch off like a liquid would.
Time: the drops are shown in slow motion (0.6x), then the speed ramps up to 4x while the cup fills.
"""
import json
import math

import bpy
import numpy as np

from . import common as C
from . import crema as CR
from . import materials as M
from . import props as P
from . import stage as S

NAME = 'extract'
T0, T1 = C.T['extract'], C.T['cup']
SUB = 24                          # physics sub-steps per frame
QUARTERS = 4                      # stored states per frame (motion blur samples at +-0.25 frame)

# fluid (CGS)
SIGMA, RHO, MU = 46.0, 1.02, 0.008
RHO_AIR, CD = 1.2e-3, 0.47
G = C.GRAVITY

# flow and drops
Q_STEADY = 3.0                    # cm^3/s
V_BEAD0 = 2.0e-4                  # first visible bead (0.7 mm)
V_PIN = 0.018                     # above this hysteresis no longer pins a drop on the near-level floor
V_DET = 0.034                     # a ~4 mm drop drips
U_SLIDE = 1.1                     # cm/s, creeping speed of a free pendant drop
Q_JET = 1.0                       # cm^3/s into the central drop: dripping -> jetting
FOAM = 1.25                       # crema expands the volume in the cup
N_SITES = 34

# geometry (portafilter root at the origin, unrotated: the basket floor underside is at P.FLOOR_Z)
FLOOR = P.FLOOR_Z
PITCH = 0.173
LOW = np.array([0.1, -0.06])      # lowest point of the domed, slightly tilted floor
TRAY_LIFT = 2.3
CUP_Z = -15.41 + TRAY_LIFT        # the cup stands on the drip tray's rubber slats
CUP_XY = np.array([-0.3, 0.25])
CUP_ROT = 0.45

# metaball calibration (stiffness 2, threshold 0.6): an isolated ball's surface is at 0.575 R, a dense chain
# (spacing 0.4 R) at 0.6635 R
K_BALL, K_CHAIN, CHAIN_STEP = 0.575, 0.6635, 0.4
N_EL = 1000
EL_W = 8                          # x, y, z, R, sx, sy, sz, active


# ------------------------------------------------------------------ timing: screen time -> simulated time
def _speed(lt):
    return 0.6 + 3.4 * C.smoother(1.95, 2.8, lt)


_LT = np.linspace(-0.2, T1 - T0 + 0.2, 8001)
_TAU = np.concatenate([[0.0], np.cumsum(0.5 * (np.vectorize(_speed)(_LT[1:]) + np.vectorize(_speed)(_LT[:-1])) * np.diff(_LT))])
_TAU -= np.interp(0.0, _LT, _TAU)


def tau_of(t):
    """Simulated seconds since the start of the shot for a global screen time t."""
    return float(np.interp(t - T0, _LT, _TAU))


def lt_of_tau(tau):
    return float(np.interp(tau, _TAU, _LT))


# ------------------------------------------------------------------ cup volume -> level
_ZS = np.linspace(P.CUP_INNER[0][1], P.CUP_INNER[-1][1], 2000)
_RS = np.interp(_ZS, [p[1] for p in P.CUP_INNER], [p[0] for p in P.CUP_INNER])
_VS = np.concatenate([[0.0], np.cumsum(math.pi * _RS[:-1] ** 2 * np.diff(_ZS))])


def level_of(volume):
    """Liquid (plus foam) level in cup coordinates."""
    return float(np.interp(volume * FOAM, _VS, _ZS))


def surface_z(volume):
    return CUP_Z + level_of(volume)


# ------------------------------------------------------------------ drop geometry
def cap_radius(V, theta):
    """Sphere radius of a cap of volume V with contact angle theta (through the liquid)."""
    c = math.cos(theta)
    return (3 * V / (math.pi * (1 - c) ** 2 * (2 + c))) ** (1 / 3)


def pendant(x, y, V, osc=0.0):
    """Metaball elements of a drop hanging under the floor: an attached cap and, as it fills, a sagging lower bulb."""
    fill = C.clamp(V / V_PIN)
    theta = math.radians(70 + 50 * fill * fill)
    r1 = cap_radius(V, theta)
    zc = FLOOR + r1 * math.cos(theta)
    e = C.clamp((V - V_PIN) / (V_DET - V_PIN))
    els = [(x, y, zc, r1 * (1 - 0.12 * e) / K_BALL, 1.0, 1.0, (1.0 + 0.1 * e) * (1 + osc))]
    if e > 0:
        # gravity pulls the bottom of a heavy drop into a teardrop: a second, overlapping bulb low in the cap
        h = r1 * (1 - math.cos(theta))
        r2 = r1 * (0.5 + 0.25 * e)
        els.append((x, y, FLOOR - h + r2 * (0.9 - 0.75 * e) * (1 + osc), r2 / K_BALL, 1.0, 1.0, 1.0 + 0.25 * e))
    return els


def contact_radius(V):
    fill = C.clamp(V / V_PIN)
    theta = math.radians(70 + 50 * fill * fill)
    r1 = cap_radius(V, theta)
    return r1 * math.sin(min(theta, math.pi / 2))


def osc_freq(V):
    """Mode-2 oscillation frequency of a drop of volume V (Rayleigh), Hz."""
    R = (3 * V / (4 * math.pi)) ** (1 / 3)
    return math.sqrt(8 * SIGMA / (RHO * R ** 3)) / (2 * math.pi)


# ------------------------------------------------------------------ sources
def hole_sites(rng):
    """Random holes of the hexagonal pattern (same lattice as the floor's hole mask) and when coffee reaches them."""
    pts = []
    s3 = math.sqrt(3.0)
    for i in range(-16, 17):
        for j in range(-10, 11):
            for k in (0.0, 0.5):
                x, y = (i + k) * PITCH, (j + k) * PITCH * s3
                if math.hypot(x, y) < 2.2:
                    pts.append((x, y))
    pts = np.array(pts)
    pick = pts[rng.choice(len(pts), N_SITES, replace=False)]
    onset = np.sort(0.08 + 0.8 * rng.random(N_SITES))
    weight = rng.lognormal(0.0, 0.9, N_SITES)
    weight[:4] *= 2.5                 # the first channels through the puck carry the most
    return pick, onset, weight


def q_total(tau):
    return Q_STEADY * C.smoother(0.05, 1.3, tau)


def film_share(tau):
    """Share of the flow that runs as a film to the central drop (the underside is wet and connected)."""
    return C.smooth(0.55, 1.25, tau)


# ------------------------------------------------------------------ simulation
class Drop:
    __slots__ = ('x', 'y', 'V', 'vx', 'vy', 'osc_t', 'osc_a', 'trail', 'site', 'central', 'meander', 'into', 'seed')
    count = 0

    def __init__(self, x, y, V, site=-1, meander=0.0):
        self.x, self.y, self.V = x, y, V
        Drop.count += 1
        self.seed = Drop.count
        self.vx = self.vy = 0.0
        self.osc_t, self.osc_a = -1.0, 0.0
        self.trail = []
        self.site = site
        self.central = False
        self.meander = meander
        self.into = None


class Faller:
    __slots__ = ('p', 'v', 'V', 't0', 'amp')

    def __init__(self, p, v, V, t0, amp):
        self.p, self.v, self.V, self.t0, self.amp = np.array(p, float), np.array(v, float), V, t0, amp


def simulate(scene, floor_ob):
    rng = np.random.default_rng(42)
    Drop.count = 0
    sites, onset, weight = hole_sites(rng)
    fa, fb = scene.frame_start - 1, scene.frame_end + 1
    drops, fallers = [], []
    impacts = []                  # (tau, x, y, V)
    jet = {'on': False, 't0': None, 'hist': [], 'inflow': [], 'phase': 0.0}
    v_cup = 0.0
    stream_arrived = 0.0
    states, levels, taus, imp_state = [], [], [], []
    wet_frames = []
    stats = []
    stream_hit = None

    def central_drop():
        for d in drops:
            if d.central:
                return d
        best = None
        for d in drops:
            if math.hypot(d.x - LOW[0], d.y - LOW[1]) < 0.45 and (best is None or d.V > best.V):
                best = d
        if best is None:
            best = Drop(LOW[0], LOW[1], V_BEAD0)
            drops.append(best)
        best.central = True
        return best

    def step(tau, dt):
        nonlocal v_cup, stream_arrived, stream_hit
        Q = q_total(tau)
        fs = film_share(tau)
        act = np.array([C.smooth(o, o + 0.15, tau) for o in onset]) * weight
        q_sites = Q * (1 - fs) * act / max(act.sum(), 1e-9) if act.sum() > 0 else np.zeros(N_SITES)
        # coffee out of the active holes: into the drop that covers the hole, or a new bead
        for i in np.nonzero(q_sites > 0)[0]:
            sx, sy = sites[i]
            host = None
            for d in drops:
                if d.into is None and math.hypot(d.x - sx, d.y - sy) < contact_radius(d.V) + 0.03:
                    host = d
                    break
            if host is None:
                host = Drop(sx, sy, V_BEAD0, i, rng.normal(0, 0.35))
                drops.append(host)
            host.V += q_sites[i] * dt
        # the film drains into the central drop
        inflow = 0.0
        if fs > 0.02 and act.sum() > 0:
            c = central_drop()
            c.V += Q * fs * dt
            inflow += Q * fs
        # the beads are drained by the film once the whole underside is wet (small ones first)
        drain = C.smooth(1.1, 1.6, tau)
        if drain > 0:
            c = central_drop()
            for d in drops:
                if not d.central and d.into is None:
                    dv = d.V * min(1.0, drain * dt / (0.25 if d.V < V_PIN else 0.6))
                    d.V -= dv
                    c.V += dv
                    inflow += dv / dt
        # creeping motion towards the low point once a drop is too heavy to stay pinned
        for d in drops:
            if d.into is not None:
                tx, ty = d.into.x, d.into.y
                k = min(1.0, dt / 0.012)
                d.x += (tx - d.x) * k
                d.y += (ty - d.y) * k
                dv = d.V * k
                d.V -= dv
                d.into.V += dv
                if d.into.central:
                    inflow += dv / dt
                continue
            if d.central and jet['on']:
                continue
            dx, dy = LOW[0] - d.x, LOW[1] - d.y
            dist = math.hypot(dx, dy)
            mob = C.clamp((d.V - V_PIN) / V_PIN, 0.0, 1.5)
            if dist > 1e-4 and mob > 0:
                a = math.atan2(dy, dx) + d.meander * C.clamp(dist / 1.5) + 0.25 * C.noise1(tau * 1.7, 17 + d.seed)
                ux, uy = U_SLIDE * mob * math.cos(a), U_SLIDE * mob * math.sin(a)
                ux *= C.clamp(dist / 0.15)
                uy *= C.clamp(dist / 0.15)
            else:
                ux = uy = 0.0
            relax = min(1.0, dt / 0.05)
            d.vx += (ux - d.vx) * relax
            d.vy += (uy - d.vy) * relax
            d.x += d.vx * dt
            d.y += d.vy * dt
            if math.hypot(d.vx, d.vy) > 0.05 and (not d.trail or math.hypot(d.x - d.trail[-1][1], d.y - d.trail[-1][2]) > 0.05):
                d.trail.append((tau, d.x, d.y, contact_radius(d.V)))
            if d.trail and tau - d.trail[0][0] > 0.3:
                d.trail = [p for p in d.trail if tau - p[0] < 0.3]
        # coalescence: drops that touch merge (the smaller one is drawn into the larger in ~12 ms)
        live = [d for d in drops if d.into is None]
        for i in range(len(live)):
            a = live[i]
            if a.into is not None:
                continue
            ra = contact_radius(a.V)
            for j in range(i + 1, len(live)):
                b = live[j]
                if b.into is not None:
                    continue
                if math.hypot(a.x - b.x, a.y - b.y) < 0.85 * (ra + contact_radius(b.V)):
                    big, small = (a, b) if (a.V >= b.V or a.central) and not b.central else (b, a)
                    small.into = big
                    big.osc_t, big.osc_a = tau, min(0.25, 0.6 * small.V / max(big.V, 1e-6))
                    big.vx = (big.vx * big.V + small.vx * small.V) / (big.V + small.V)
                    big.vy = (big.vy * big.V + small.vy * small.V) / (big.V + small.V)
                    if small is a:
                        break
        drops[:] = [d for d in drops if not (d.into is not None and d.V < 2e-5)]
        for d in drops:
            if d.into is not None and d.into not in drops:
                d.into = None
        # dripping: the lower bulb pinches off and falls
        for d in drops:
            if d.into is not None or (d.central and jet['on']):
                continue
            if d.V > V_DET * (0.8 if d.central else 1.0):
                Vf = 0.6 * d.V
                d.V -= Vf
                fill_h = cap_radius(d.V, math.radians(120)) * 1.5
                fallers.append(Faller((d.x, d.y, FLOOR - fill_h - 0.12), (d.vx, d.vy, -6.0), Vf, tau, 0.18))
                d.osc_t, d.osc_a = tau, 0.2
        # jetting: enough inflow into the central drop turns it into a cone with a continuous stream
        jet['inflow'].append((tau, inflow))
        jet['inflow'] = [p for p in jet['inflow'] if tau - p[0] < 0.08]
        avg_in = sum(p[1] for p in jet['inflow']) / max(len(jet['inflow']), 1)
        if not jet['on'] and avg_in > Q_JET and tau > 0.7:
            c = central_drop()
            if c.V > 0.5 * V_DET:
                jet['on'], jet['t0'] = True, tau
        if jet['on']:
            c = central_drop()
            v_cone = 0.05 + 0.015 * avg_in
            q_out = max(0.0, avg_in + (c.V - v_cone) / 0.08)
            c.V -= q_out * dt                     # the inflow was already added above
            v0 = 45.0 + 6.0 * q_out
            f_rp = v0 / (9.02 * math.sqrt(max(q_out, 0.05) / (math.pi * v0)))
            jet['phase'] += 2 * math.pi * f_rp * dt * (1 + 0.15 * C.noise1(tau * 3, 41))
            L = 0.32 + 0.09 * q_out
            tip = (c.x + 0.03 * C.noise1(tau * 0.9, 51), c.y + 0.03 * C.noise1(tau * 0.9, 52), FLOOR - L)
            vl = (1.5 * C.noise1(tau * 1.3, 53), 1.5 * C.noise1(tau * 1.3, 54))
            jet['hist'].append((tau, *tip, vl[0], vl[1], -v0, q_out, jet['phase'], 0.002 * (1 + 0.5 * C.noise1(tau * 5, 55))))
            # parcels reach the cup after their fall time
            zs = surface_z(v_cup)
            fall = (-v0 + math.sqrt(v0 * v0 + 2 * G * max(tip[2] - zs, 0))) / G
            if tau - jet['t0'] >= fall:
                stream_arrived += q_out * dt
                if stream_hit is None:
                    stream_hit = tau
            c.x += (LOW[0] - c.x) * min(1.0, dt / 0.2)
            c.y += (LOW[1] - c.y) * min(1.0, dt / 0.2)
        # falling drops: gravity and air drag, until they hit the coffee in the cup
        zs = surface_z(v_cup)
        for fdrop in list(fallers):
            R = (3 * fdrop.V / (4 * math.pi)) ** (1 / 3)
            k = 0.5 * RHO_AIR * CD * math.pi * R * R / (RHO * fdrop.V)
            sp = np.linalg.norm(fdrop.v)
            fdrop.v += (np.array([0.0, 0.0, -G]) - k * sp * fdrop.v) * dt
            fdrop.p += fdrop.v * dt
            if fdrop.p[2] - R < zs:
                impacts.append((tau, float(fdrop.p[0]), float(fdrop.p[1]), fdrop.V))
                v_cup += fdrop.V
                fallers.remove(fdrop)
        v_cup_total = v_cup + stream_arrived
        return v_cup_total

    # ---- run: SUB sub-steps per frame, states stored at quarter frames
    me_floor = floor_ob.data
    co = np.zeros(len(me_floor.vertices) * 3, np.float32)
    me_floor.vertices.foreach_get('co', co)
    floor_xy = co.reshape(-1, 3)[:, :2].astype(float)
    wet = np.zeros(len(floor_xy))
    v_total = 0.0
    for f in range(fa, fb + 1):
        t_a, t_b = C.time_of(f), C.time_of(f + 1)
        tau_a, tau_b = tau_of(t_a), tau_of(t_b)
        for s in range(SUB):
            tau = tau_a + (tau_b - tau_a) * s / SUB
            if s % (SUB // QUARTERS) == 0:
                states.append(_elements(tau, drops, fallers, jet, v_total))
                levels.append(v_total)
                taus.append(tau)
                imp_state.append(_stream_impact(tau, jet, v_total))
            v_total = step(tau, (tau_b - tau_a) / SUB)
        wet = _wet_update(wet, floor_xy, tau_b, sites, onset, drops)
        wet_frames.append(wet.astype(np.float16))
        cv = [d.V for d in drops if d.central]
        stats.append((tau_b, len(drops), len(fallers), sum(len(d.trail) for d in drops), max([d.V for d in drops if not d.central] or [0]),
                      cv[0] if cv else 0.0, jet['hist'][-1][7] if jet['hist'] else 0.0))
    data = dict(el=np.array(states, np.float32), vol=np.array(levels, np.float32), tau=np.array(taus, np.float32),
                imp=np.array(imp_state, np.float32), wet=np.array(wet_frames, np.float16),
                drops=np.array(impacts, np.float32).reshape(-1, 4), frame0=np.array([fa]),
                stats=np.array(stats, np.float32))
    np.savez_compressed(C.CACHE / 'extract.npz', **data)
    ev = {'drops': [T0 + lt_of_tau(i[0]) for i in impacts],
          'stream_hit': T0 + lt_of_tau(stream_hit) if stream_hit is not None else T0 + 2.0,
          'jet_start': T0 + lt_of_tau(jet['t0']) if jet['t0'] is not None else None}
    (C.CACHE / 'extract_events.json').write_text(json.dumps(ev, indent=1))
    print(f'[extract] jet at tau {jet["t0"]}, {len(impacts)} drops into the cup, cup volume {v_total:.2f} cm^3, '
          f'level {level_of(v_total):.2f}, max elements {int(data["el"][..., 7].sum(1).max())}', flush=True)
    return data


def _stream_impact(tau, jet, vol):
    """Where the stream meets the coffee (x, y) and how established it is (0..1)."""
    if not jet['on'] or not jet['hist']:
        return (0.0, 0.0, 0.0)
    h = jet['hist'][-1]
    zs = surface_z(vol)
    v0 = -h[6]
    fall = (-v0 + math.sqrt(v0 * v0 + 2 * G * max(h[3] - zs, 0))) / G
    age = tau - jet['t0']
    k = C.smooth(fall, fall + 0.1, age)
    return (h[1] + h[4] * fall, h[2] + h[5] * fall, k)


def _elements(tau, drops, fallers, jet, vol):
    """All metaball elements of the liquid at sim time tau: (N_EL, 8)."""
    out = []
    for d in drops:
        osc = 0.0
        if d.osc_t >= 0:
            age = tau - d.osc_t
            osc = d.osc_a * math.exp(-age / 0.06) * math.sin(2 * math.pi * min(osc_freq(max(d.V, 1e-4)), 60.0) * age)
        if d.central and jet['on'] and jet['hist']:
            out.extend(_cone(d, jet, tau))
        else:
            out.extend(pendant(d.x, d.y, d.V, osc))
        # a wet trail behind a moving drop (thin flattened lens)
        for (tt, x, y, a) in d.trail:
            k = 1 - (tau - tt) / 0.3
            if k > 0.05:
                out.append((x, y, FLOOR + 0.25 * a * 0.12, 0.55 * a * k / K_BALL, 1.0, 1.0, 0.12))
    for fd in fallers:
        R = (3 * fd.V / (4 * math.pi)) ** (1 / 3)
        age = tau - fd.t0
        a = fd.amp * math.exp(-age / 0.8) * math.cos(2 * math.pi * osc_freq(fd.V) * age)
        sz = 1 + a
        sxy = 1 / math.sqrt(sz)
        out.append((*fd.p, R / K_BALL, sxy, sxy, sz))
    if jet['on'] and jet['hist']:
        out.extend(_stream(tau, jet, vol))
    out = out[:N_EL]
    arr = np.zeros((N_EL, EL_W), np.float32)
    if out:
        arr[:len(out), :7] = np.array(out, np.float32)
        arr[:len(out), 7] = 1.0
    return arr


def _cone(d, jet, tau):
    """The hanging cone that feeds the stream: wide where it meets the wet floor, the stream radius at the tip."""
    h = jet['hist'][-1]
    q, tip = h[7], np.array(h[1:4])
    v0 = -h[6]
    r0 = math.sqrt(q / (math.pi * v0))
    grow = C.smooth(jet['t0'], jet['t0'] + 0.15, tau)
    base = C.lerp(contact_radius(max(d.V, V_PIN)), 0.36 + 0.03 * q, grow)
    top = np.array([d.x, d.y, FLOOR + 0.02])
    L = top[2] - tip[2]
    els, s = [], 0.0
    while s < L:
        u = s / L
        r = r0 + (base - r0) * (1 - u) ** 2.2
        p = top + (tip - top) * u
        w = 1 + 0.06 * (1 - u) * math.sin(2 * math.pi * u + tau * 7)
        els.append((p[0], p[1], p[2], r * w / K_CHAIN, 1.0, 1.0, 1.0))
        s += max(CHAIN_STEP * r / K_CHAIN, 0.008)
    return els


def _stream(tau, jet, vol):
    """Closed-form stream: parcels sampled by emission time, placed ballistically from where and how they left the tip."""
    hist = jet['hist']
    t_first = hist[0][0]
    lo = 0
    while lo < len(hist) - 2 and hist[lo + 1][0] < tau - 0.35:
        lo += 1
    H = np.array(hist[lo:])
    zs = surface_z(vol)
    els = []
    age = 0.0
    front = tau - t_first
    while age <= front and len(els) < 700:
        te = tau - age
        row = np.array([np.interp(te, H[:, 0], H[:, j]) for j in range(H.shape[1])])
        _, x0, y0, z0, vx, vy, vz, q, ph, a0 = row
        p = np.array([x0 + vx * age, y0 + vy * age, z0 + vz * age - 0.5 * G * age * age])
        if p[2] < zs - 0.05:
            break
        v = math.sqrt(vx * vx + vy * vy + (vz - G * age) ** 2)
        r = math.sqrt(max(q, 1e-3) / (math.pi * v))
        omega = 0.34 * math.sqrt(SIGMA / (RHO * r ** 3))
        amp = min(0.32, a0 * math.exp(omega * age))
        r *= 1 + amp * math.sin(ph)
        if front - age < 0.012:            # the leading drop of a new stream
            r *= 1.35
        R = r / K_CHAIN
        els.append((p[0], p[1], p[2], R, 1.0, 1.0, 1.0))
        age += CHAIN_STEP * R / v
    return els


def _wet_update(wet, xy, tau, sites, onset, drops):
    """Wetted area of the floor (0..1): darkening around the holes that pass coffee, every drop's footprint and
    trail, and finally the film spreading over the whole underside."""
    for (sx, sy), o in zip(sites, onset):
        if tau > o - 0.1:
            r = 0.04 + 0.1 * C.smooth(o - 0.1, o + 0.3, tau)
            d = np.hypot(xy[:, 0] - sx, xy[:, 1] - sy)
            wet = np.maximum(wet, np.clip(1.5 - d / r, 0, 1) * C.smooth(o - 0.1, o + 0.05, tau))
    for dr in drops:
        a = contact_radius(dr.V) * 1.15
        pts = [(dr.x, dr.y, a)] + [(x, y, aa * 0.8) for (_, x, y, aa) in dr.trail[::4]]
        for (x, y, aa) in pts:
            m = (np.abs(xy[:, 0] - x) < aa * 1.6) & (np.abs(xy[:, 1] - y) < aa * 1.6)
            if m.any():
                d = np.hypot(xy[m, 0] - x, xy[m, 1] - y)
                wet[m] = np.maximum(wet[m], np.clip(1.6 - d / aa, 0, 1))
    front = 2.8 * C.smooth(0.6, 1.5, tau)
    if front > 0:
        d = np.hypot(xy[:, 0] - LOW[0], xy[:, 1] - LOW[1])
        wet = np.maximum(wet, np.clip((front - d) / 0.4, 0, 1))
    return wet


# ------------------------------------------------------------------ materials
def wet_floor_material():
    """The basket floor of materials.basket_floor plus a coffee film: where the mesh attribute 'wet' is 1 the steel
    is under a glossy amber film (IOR 1.345 coat, tinted by the coffee it holds)."""
    g = M.Graph('basket_floor_wet')
    mask = g.image(C.ASSETS / 'basket_holes.png', 'Non-Color', g.coord('UV'), 'Cubic', 'CLIP')
    hole = g.node('ShaderNodeSeparateColor', {'Color': mask.outputs['Color']}).outputs[0]
    edge = g.noise(g.coord(), 14.0, detail=4.0)
    wet = g.map_range(g.math('ADD', g.attr('wet', 'Fac'), g.map_range(edge.outputs['Fac'], 0.3, 0.7, -0.2, 0.2)), 0.35, 0.65, 0.0, 1.0)
    col = g.mix_rgb(hole, (0.62, 0.6, 0.57), (0.01, 0.01, 0.01))
    col = g.mix_rgb(g.math('MULTIPLY', wet, hole), col, (0.05, 0.02, 0.008))
    dry_rough = g.math('ADD', M.varied_roughness(g, 0.12, 0.22, 4.0), g.math('MULTIPLY', hole, 0.6))
    rough = g.map_range(wet, 0.0, 1.0, dry_rough, 0.08)
    bump = g.bump(g.math('SUBTRACT', 1.0, hole), g.map_range(wet, 0, 1, 0.6, 0.15), 0.004)
    ripple = g.noise(g.coord(), 6.0, detail=2.0)
    film_n = g.bump(ripple.outputs['Fac'], 0.05, 0.004)
    g.p(Base_Color=col, Metallic=g.math('SUBTRACT', 1.0, hole), Roughness=rough, Normal=bump,
        Coat_Weight=wet, Coat_IOR=1.345, Coat_Roughness=0.03, Coat_Tint=g.mix_rgb(wet, (1.0, 1.0, 1.0), (0.42, 0.2, 0.075)),
        Coat_Normal=film_n)
    return g.mat


def espresso_material():
    """A copy of the shared espresso so this shot can key its strength (the first drops are ~2.5x as concentrated) and
    give the stream its tiger streaks: crema foam carried in the flow, stretched along it and advected downwards
    (value node 'flow' = distance travelled, keyed)."""
    mat = M.get('espresso').copy()
    mat.name = 'espresso_extract'
    nt = mat.node_tree
    attr = next(n for n in nt.nodes if n.type == 'ATTRIBUTE' and n.attribute_name == 'foam')
    targets = [lk.to_socket for lk in nt.links if lk.from_node == attr]
    new = nt.nodes.new
    tc = new('ShaderNodeTexCoord')
    flow = new('ShaderNodeValue')
    flow.name = 'flow'
    off = new('ShaderNodeCombineXYZ')
    nt.links.new(flow.outputs[0], off.inputs['Z'])
    mv = new('ShaderNodeVectorMath')
    mv.operation = 'ADD'
    nt.links.new(tc.outputs['Object'], mv.inputs[0])
    nt.links.new(off.outputs[0], mv.inputs[1])
    mp = new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (16.0, 16.0, 1.4)
    nt.links.new(mv.outputs[0], mp.inputs['Vector'])
    nz = new('ShaderNodeTexNoise')
    nz.inputs['Detail'].default_value = 3.0
    nz.inputs['Scale'].default_value = 1.0
    nt.links.new(mp.outputs[0], nz.inputs['Vector'])
    streak = new('ShaderNodeMapRange')
    for k, v in (('From Min', 0.52), ('From Max', 0.72), ('To Min', 0.0), ('To Max', 0.45)):
        streak.inputs[k].default_value = v
    nt.links.new(nz.outputs['Fac'], streak.inputs['Value'])
    # only in the stream and the cone (below the floor film), not in the beads
    sep = new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['Object'], sep.inputs[0])
    below = new('ShaderNodeMapRange')
    for k, v in (('From Min', FLOOR - 0.15), ('From Max', FLOOR - 0.6), ('To Min', 0.0), ('To Max', 1.0)):
        below.inputs[k].default_value = v
    nt.links.new(sep.outputs['Z'], below.inputs['Value'])
    mul = new('ShaderNodeMath')
    mul.operation = 'MULTIPLY'
    nt.links.new(streak.outputs['Result'], mul.inputs[0])
    nt.links.new(below.outputs['Result'], mul.inputs[1])
    for sock in targets:
        if sock.node.type == 'MIX':
            # streak colour: dark hazelnut foam, not the light crema of the cup
            tint = new('ShaderNodeMapRange')
            for k, v in (('From Min', 0.0), ('From Max', 0.12), ('To Min', 0.0), ('To Max', 1.0)):
                tint.inputs[k].default_value = v
            nt.links.new(mul.outputs[0], tint.inputs['Value'])
            nt.links.new(tint.outputs['Result'], sock)
            sock.node.inputs[7].default_value = (0.2, 0.085, 0.03, 1.0)
        else:
            nt.links.new(mul.outputs[0], sock)
    return mat


def tds_of(tau):
    return 1.0 + 0.6 * (1 - C.smooth(0.2, 1.8, tau))


# ------------------------------------------------------------------ camera
CAM = [  # (screen seconds into the shot, position, target)
    (0.0, (-2.3, -4.9, -7.4), (0.25, -0.15, -2.55)),
    (1.2, (-2.0, -4.6, -7.0), (0.15, -0.1, -2.75)),
    (1.65, (-1.7, -4.6, -6.2), (0.1, -0.05, -3.8)),
    (2.4, (-0.6, -3.6, -3.3), (-0.15, 0.15, -10.9)),
    (3.2, (-0.45, -3.2, -3.35), (-0.2, 0.2, -11.2)),
]


def _cam(t):
    lt = t - T0
    pos = C.hermite([(k[0], k[1]) for k in CAM], lt)
    tgt = C.hermite([(k[0], k[2]) for k in CAM], lt)
    shake = np.array([C.noise1(t * 1.6, 61), C.noise1(t * 1.6, 62), C.noise1(t * 1.6, 63)]) * 0.012
    floor_pt = np.array([0.15, -0.1, FLOOR - 0.15])
    cup_pt = np.array([CUP_XY[0] + 0.3, CUP_XY[1] - 0.3, CUP_Z + 1.5])
    mid_pt = np.array([0.1, -0.05, -6.0])
    k1, k2 = C.smooth(1.6, 2.0, lt), C.smooth(2.0, 2.5, lt)
    fp = floor_pt * (1 - k1) + mid_pt * k1
    fp = fp * (1 - k2) + cup_pt * k2
    return dict(pos=pos + shake, target=tgt, roll=0.03 * math.sin(lt * 1.1), fov=C.lerp(34, 30, C.smooth(1.6, 3.2, lt)),
                focus=float(np.linalg.norm(pos - fp)), fstop=C.lerp(32, 22, C.smooth(1.6, 2.5, lt)))


LIGHTS = {  # real watts under the basket (drops) and over the cup (stream and crema)
    'x_key': (0.6, 0.0), 'x_ckey': (0.0, 0.12), 'x_rim': (0.8, 0.35), 'x_back': (0.5, 0.3), 'x_spec': (0.0, 0.25)}


def _lights(scene):
    # under the basket a grid-confined softbox lights the drops but not the white cup below them (the floor mirrors it)
    key = S.area_light(scene, 'x_key', 8.0, 1.0, (1.0, 0.92, 0.84), size_y=5.0, spread=28.0)
    key.location = (-8.0, -9.0, -7.5)
    S.aim(key, (0.0, 0.0, FLOOR))
    ckey = S.area_light(scene, 'x_ckey', 8.0, 1.0, (1.0, 0.92, 0.84), size_y=5.0)
    ckey.location = (-10.0, -8.0, -4.0)
    S.aim(ckey, (0.0, 0.0, -9.0))
    rim = S.area_light(scene, 'x_rim', 2.0, 1.0, (1.0, 0.74, 0.48), size_y=12.0)
    rim.location = (8.0, 5.0, -5.0)
    S.aim(rim, (0.0, 0.0, -5.0))
    back = S.area_light(scene, 'x_back', 4.0, 1.0, (1.0, 0.7, 0.42), size_y=8.0)
    back.location = (-1.5, 7.0, -6.0)
    S.aim(back, (0.0, 0.0, -6.0))
    # over the far rim of the cup: its reflection is the wet highlight on the crema, and it backlights the stream
    spec = S.area_light(scene, 'x_spec', 4.0, 1.0, (1.0, 0.9, 0.78), size_y=2.5)
    spec.location = (0.9, 5.0, -6.2)
    S.aim(spec, (-0.2, 0.1, -11.2))
    for ob in (key, ckey, rim, back, spec):
        ob.visible_camera = False
        a, b = LIGHTS[ob.name]
        for f in range(scene.frame_start - 1, scene.frame_end + 2):
            k = C.smooth(1.6, 2.4, C.time_of(f) - T0)
            ob.data.energy = S.real_watts(C.lerp(a, b, k))
            ob.data.keyframe_insert('energy', frame=f)
    back.visible_glossy = False         # a backlight for the drops, not a big window mirrored in the polished floor
    # warm, softly lit card far behind the stream: an out-of-focus glow to read the liquid against
    card = P.mesh_obj('x_glow', np.array([[-9, 8.6, -16], [9, 8.6, -16], [9, 8.6, 4], [-9, 8.6, 4]], float), [(0, 1, 2, 3)],
                      scene.collection, _glow_material(), smooth=False)
    card.visible_shadow = False
    card.visible_glossy = False       # seen through the liquid, not mirrored by the basket floor
    card.visible_diffuse = False


def _glow_material():
    g = M.Graph('x_glow', principled=False)
    co = g.coord('Generated')
    sep = g.node('ShaderNodeSeparateXYZ', {'Vector': co})
    dx = g.math('SUBTRACT', sep.outputs['X'], 0.52)
    dy = g.math('SUBTRACT', sep.outputs['Z'], 0.55)
    r = g.math('SQRT', g.math('ADD', g.math('MULTIPLY', dx, dx), g.math('MULTIPLY', g.math('MULTIPLY', dy, dy), 0.6)))
    k = g.map_range(r, 0.0, 0.45, 1.0, 0.0)
    em = g.node('ShaderNodeEmission', {'Color': (1.0, 0.62, 0.3), 'Strength': g.math('MULTIPLY', g.math('POWER', k, 2.0), 0.2)})
    g.link(em.outputs[0], g.out.inputs['Surface'])
    return g.mat


# ------------------------------------------------------------------ build
def build(scene):
    col = scene.collection
    machine = P.build_group_head(col, 'machine')
    for ob in bpy.data.objects:
        if ob.parent is machine and (ob.name.startswith('machine_tray') or ob.name.startswith('machine_slot')):
            ob.location.z += TRAY_LIFT
    pf = P.build_portafilter(col, 'portafilter')
    floor = pf['floor']
    scene['x_floor'] = floor.name
    floor.data.attributes.new('wet', 'FLOAT', 'POINT')
    floor.data.materials.clear()
    floor.data.materials.append(wet_floor_material())
    cup = P.build_cup(col, 'xcup', logo=False)
    cup['root'].location = (CUP_XY[0], CUP_XY[1], CUP_Z)
    cup['root'].rotation_euler = (0, 0, CUP_ROT)
    cr = CR.build_crema(col, cup['root'], 'xcrema', rings=140, segs=420, n_bubbles=120, seed=9)
    cr.ob['rings'], cr.ob['segs'] = cr.rings, cr.segs
    scene['x_crema'] = cr.ob.name
    # foam that is still forming: its marbling is faint (it develops as the crema settles, see the cup shot)
    tg = np.zeros(len(cr.ob.data.vertices), np.float32)
    cr.ob.data.attributes['tiger'].data.foreach_get('value', tg)
    cr.ob.data.attributes['tiger'].data.foreach_set('value', tg * 0.35)
    # the liquid: one metaball family
    mb = bpy.data.metaballs.new('espresso_liquid')
    mb.resolution = 0.03
    mb.render_resolution = 0.006
    mb.threshold = 0.6
    mb.update_method = 'UPDATE_ALWAYS'
    mb.materials.append(espresso_material())
    liquid = C.obj_new('espresso_liquid', mb, col)
    scene['x_liquid'] = liquid.name
    for _ in range(N_EL):
        e = mb.elements.new(type='ELLIPSOID')
        e.stiffness = 2.0
        e.radius = 0.01
        e.hide = True
    data = simulate(scene, floor)
    # concentration of the coffee over the shot (keyed so motion blur sub-frames see the same value)
    nodes = liquid.data.materials[0].node_tree.nodes
    for f in range(scene.frame_start - 1, scene.frame_end + 2):
        tau = tau_of(C.time_of(f))
        nodes['tds'].outputs[0].default_value = tds_of(tau)
        nodes['tds'].outputs[0].keyframe_insert('default_value', frame=f)
        nodes['flow'].outputs[0].default_value = 90.0 * tau
        nodes['flow'].outputs[0].keyframe_insert('default_value', frame=f)
    C.set_interpolation(liquid.data.materials[0].node_tree, 'LINEAR')
    _lights(scene)
    S.make_camera(scene, 'cam_extract', _cam)
    S.key_world(scene.world, lambda t: (2.4, 0.12, 0.06), range(scene.frame_start - 1, scene.frame_end + 2))
    del data
    attach(scene)


# ------------------------------------------------------------------ render-time updates
def _crema_top(cr, tau, vol, imp, drops, R, swirl):
    """Top surface of the crema (heights in cm), and its 'fresh', 'age' attributes for this instant."""
    n = cr.top_count
    ur, th = cr.unit_r, cr.theta
    x, y = ur * np.cos(th) * R, ur * np.sin(th) * R
    h = 0.1 * ur ** 14 - 0.02 * (1 - ur ** 2)
    rot = -(CUP_ROT + swirl)
    ca, sa = math.cos(rot), math.sin(rot)

    def local(px, py):
        dx, dy = px - CUP_XY[0], py - CUP_XY[1]
        return dx * ca - dy * sa, dx * sa + dy * ca

    fresh = np.full(n, C.lerp(0.9, 0.3, C.smooth(0.4, 6.0, vol)), np.float32)
    age = np.clip(0.35 + 0.5 * ur, 0, 1).astype(np.float32)
    ix, iy, k = imp
    if k > 0:
        lx, ly = local(ix, iy)
        d = np.hypot(x - lx, y - ly)
        ang = np.arctan2(y - ly, x - lx)
        wob = 1 + 0.5 * C.NOISE(np.cos(ang) * 1.5, np.sin(ang) * 1.5, tau * 2.0)
        h += k * (-0.07 * np.exp(-(d / 0.2) ** 2) + 0.012 * wob * np.exp(-((d - 0.42) / 0.14) ** 2)
                  + 0.0015 * wob * np.sin(d * 37.0 - tau * 240.0) * np.exp(-d / 0.5))
        fresh = np.maximum(fresh, k * np.exp(-(d / 0.17) ** 2))
        age = np.clip(np.maximum(age * (1 - 0.5 * k), k * np.clip(d / 1.8, 0, 1) * 0.95), 0, 1)
    for (t0, px, py, V) in drops:
        a = tau - t0
        if a < 0 or a > 1.2:
            continue
        lx, ly = local(px, py)
        d = np.hypot(x - lx, y - ly)
        ring = d - 23.0 * a
        h += (0.012 * math.exp(-a / 0.3) * np.exp(-(ring / 0.15) ** 2) * np.sin(ring * 25.0)
              - 0.06 * math.exp(-a / 0.05) * np.exp(-(d / 0.18) ** 2))
        fresh = np.maximum(fresh, math.exp(-a / 0.3) * np.exp(-(d / 0.25) ** 2))
    return h.astype(np.float32), fresh.astype(np.float32), age.astype(np.float32), ur.astype(np.float32)


def attach(scene):
    data = dict(np.load(C.CACHE / 'extract.npz'))
    el, vol, taus, imp, wet = data['el'], data['vol'], data['tau'], data['imp'], data['wet']
    drops = [tuple(map(float, r)) for r in data['drops']]
    frame0 = int(data['frame0'][0])
    mb = scene.objects[scene['x_liquid']].data
    elements = list(mb.elements)
    floor_me = scene.objects[scene['x_floor']].data
    cob = scene.objects[scene['x_crema']]
    rings, segs = int(cob['rings']), int(cob['segs'])
    bubbles = [o for o in scene.objects if o.parent is cob]
    cr = CR.Crema(cob, 1 + rings * segs, rings, segs, bubbles)
    first_coffee = drops[0][0] if drops else 1.0
    prev = {'idx': None}

    def update(t):
        fr = t * C.FPS + 1
        i = int(np.clip(round((fr - frame0) * QUARTERS), 0, len(el) - 1))
        if prev['idx'] == i:
            return
        prev['idx'] = i
        st = el[i]
        for e, row in zip(elements, st):
            if row[7] > 0:
                e.co = (float(row[0]), float(row[1]), float(row[2]))
                e.radius = float(row[3])
                e.size_x, e.size_y, e.size_z = float(row[4]), float(row[5]), float(row[6])
                e.hide = False
            elif not e.hide:
                e.hide = True
        fi = int(np.clip(round(fr - frame0), 0, len(wet) - 1))
        floor_me.attributes['wet'].data.foreach_set('value', wet[fi].astype(np.float32))
        floor_me.update()
        tau, v = float(taus[i]), float(vol[i])
        lvl = level_of(v) if v > 0.03 else P.CUP_INNER[0][1] - 0.08
        swirl = 0.35 * max(0.0, tau - first_coffee)
        cr.set_level(lvl)
        cr.ob.rotation_euler.z = swirl
        R = cr.radius_at(lvl)
        CR.fit_bubbles(cr, R)
        h, fresh, age, rim = _crema_top(cr, tau, v, tuple(map(float, imp[i])), drops, R, swirl)
        cr.write_top(h, fresh, age, rim)
        mb.update_tag()

    C.on_frame(scene.name, update)
    update(C.time_of(scene.frame_start))
