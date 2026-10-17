"""Numerical model of the dose: ground espresso falling from the grinder spout, the heap it builds in the basket, the
tamp, and the puff of fines squeezed out at the rim. Pure numpy (no Blender), so it can be run and checked from any
Python; coffee/shot_dose.py turns its output into geometry and explains the shot.

Units: cm, g, s. Every force acts in real seconds; the edit plays the result at SLOWMO real seconds per screen second.

Particles (each rendered particle is a super-particle: it carries the mass of many identical grains, see shot_dose):
  0 grain  coarse mode, 0.25-0.35 mm chips, envelope density 0.65 g/cm^3 (cells keep their roast pores, like the bean)
  1 clump  0.5-2 mm agglomerates of grains and fines, loosely bound (0.42 g/cm^3)
  2 fine   airborne fines agglomerates (fines are fractured cell walls, 1.2 g/cm^3); they trace the air
  3 puff   fines agglomerates (porous, 0.6 g/cm^3) blown out of the tamper gap at the tamp
Flight: gravity + Schiller-Naumann drag (Stokes to quadratic, Re 0.5-40 here) relative to the air. The air is the
co-flow a dense granular stream drags along (a Gaussian core, entrainment towards it, turning outwards where it hits the
heap) plus synthetic divergence-free turbulence (random Fourier modes, Kolmogorov amplitudes).
Bed: a height field on a 0.47 mm square grid inside the basket wall. Landed particles add their volume at the loose
bulk density; a sandpile rule moves material downhill wherever the slope exceeds the local angle of repose.
Tamp: the tamper face is a ceiling for the field: material above it is plowed sideways into free space under the face
and, once there is none, compacted (the volume shrinks, the mass stays). A compacted bed no longer avalanches.
"""
import math

import numpy as np

G = 981.0                     # cm/s^2
RHO_AIR = 1.2e-3              # g/cm^3, air at 20 C
MU_AIR = 1.81e-4              # g/(cm s)
DOSE = 18.0                   # g
RHO_LOOSE = 0.33              # g/cm^3, freshly ground espresso poured loose
GRAIN, CLUMP, FINE, PUFF = 0, 1, 2, 3
RHO_P = np.array([0.65, 0.42, 1.2, 0.6])
SHAPE_DRAG = 1.3              # chips are not spheres (sphericity ~0.7): equivalent-sphere drag x 1.3
REPOSE = (45.0, 2.5)          # degrees: mean and spatial spread (fines content varies the cohesion)
MU_K = np.array([0.72, 0.45, 0.0, 0.0])   # a grain sliding / a clump rolling down the heap (tan 36 / 24 deg)

# inner surface of the basket (props.build_portafilter), then the lip and the copper ring top
BASKET_R = [0.0, 2.5, 2.76, 2.86, 2.93, 2.98, 3.09]
BASKET_Z = [-2.33, -2.32, -2.25, -1.8, -0.5, 0.12, 0.24]
RING_R, RING_Z = [2.98, 3.09, 3.1, 3.45, 3.62], [0.12, 0.24, 0.22, 0.26, 0.18]
R_ACTIVE = 3.06
TAMPER_R = 2.8
SQ2 = math.sqrt(2.0)


def basket_z(r):
    return np.interp(r, BASKET_R, BASKET_Z)


def wall_r(z):
    """Radius of the basket's inner wall at height z."""
    return np.interp(z, BASKET_Z, BASKET_R)


def smoothstep(a, b, x):
    t = np.clip((np.asarray(x, float) - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def blur_noise(rng, n, sigma_cells):
    """Gaussian-correlated white noise on an n x n grid, unit standard deviation."""
    w = rng.standard_normal((n, n))
    k = np.exp(-0.5 * (np.arange(-3 * sigma_cells, 3 * sigma_cells + 1) / sigma_cells) ** 2)
    k /= k.sum()
    w = np.apply_along_axis(lambda v: np.convolve(v, k, 'same'), 0, w)
    w = np.apply_along_axis(lambda v: np.convolve(v, k, 'same'), 1, w)
    return (w - w.mean()) / w.std()


# ------------------------------------------------------------------ the bed
class Bed:
    """Height field of the grounds over the basket. H is the absolute surface height (cm), never below the basket's inner
    surface B; material only moves between active cells (inside the wall)."""
    N = 134
    HALF = 3.15

    def __init__(self, seed):
        n = self.N
        self.dx = 2 * self.HALF / n
        c = -self.HALF + (np.arange(n) + 0.5) * self.dx
        self.X, self.Y = np.meshgrid(c, c)                  # arrays are [iy, ix]
        self.R = np.hypot(self.X, self.Y)
        self.act = self.R <= R_ACTIVE
        self.B = np.where(self.act, basket_z(self.R), 5.0)
        self.H = self.B.copy()
        self.rng = np.random.default_rng(seed)
        # repose varies with the local fines content: broad gentle lobes, fine clumpy detail, and radial streaks around
        # the impact (each small avalanche leaves a channel)
        th = np.arctan2(self.Y - 0.2, self.X - 0.15)
        rr = np.hypot(self.Y - 0.2, self.X - 0.15)
        m = self.rng.integers(12, 70, 24)
        streak = sum(np.sin(k * th + self.rng.uniform(0, 6.28) + self.rng.normal(0, 1.5) * rr) for k in m) / math.sqrt(len(m) / 2)
        self.tan_r = np.tan(np.radians(REPOSE[0] + REPOSE[1] * blur_noise(self.rng, n, 10) + 0.6 * blur_noise(self.rng, n, 2)
                                       + 0.4 * streak * np.clip(rr / 0.6, 0, 1)))
        self.lost = 0.0                                      # volume removed by compaction
        self.dv, self.dxy, self.impact = 0.0, np.zeros(2), None
        self.mobile = np.zeros_like(self.H)

    def _idx(self, x, y):
        fx = (np.asarray(x, float) + self.HALF) / self.dx - 0.5
        fy = (np.asarray(y, float) + self.HALF) / self.dx - 0.5
        ix = np.clip(np.floor(fx).astype(np.int64), 0, self.N - 2)
        iy = np.clip(np.floor(fy).astype(np.int64), 0, self.N - 2)
        return ix, iy, np.clip(fx - ix, 0, 1), np.clip(fy - iy, 0, 1)

    def sample(self, x, y, F=None):
        F = self.H if F is None else F
        ix, iy, wx, wy = self._idx(x, y)
        return (F[iy, ix] * (1 - wx) + F[iy, ix + 1] * wx) * (1 - wy) + (F[iy + 1, ix] * (1 - wx) + F[iy + 1, ix + 1] * wx) * wy

    def gradient(self, x, y):
        h = self.dx
        return ((self.sample(x + h, y) - self.sample(x - h, y)) / (2 * h), (self.sample(x, y + h) - self.sample(x, y - h)) / (2 * h))

    def deposit(self, x, y, vol):
        """Collect this sub-step's landings (volume and where they hit)."""
        vol = np.asarray(vol, float)
        self.dv += float(vol.sum())
        self.dxy += np.array([float((vol * x).sum()), float((vol * y).sum())])

    def grow(self):
        """Avalanches on a heap fed by a stream are fast compared with its growth (surface flows run at 0.2-0.5 m/s), so
        the new material coats the heap as a cone at the local angle of repose around the impact point, clipped below by
        the old surface (and the basket): H = max(H, A - tan(repose) d), the apex height A solved by bisection so that
        exactly the landed volume is added. The top is rounded over the stream's footprint (hyperbolic profile)."""
        if self.dv <= 0.0:
            return
        c = self.dxy / self.dv
        self.impact = c if self.impact is None else self.impact + 0.25 * (c - self.impact)
        d = np.hypot(self.X - self.impact[0], self.Y - self.impact[1])
        drop = self.tan_r * (np.sqrt(d * d + 0.3 ** 2) - 0.3)
        H = np.where(self.act, self.H, 1e3)
        target = self.dv / self.dx ** 2
        lo, hi = float(H[self.act].min()), float(H[self.act].max()) + 6.0
        for _ in range(40):
            A = 0.5 * (lo + hi)
            if np.maximum(A - drop - H, 0.0).sum() < target:
                lo = A
            else:
                hi = A
        add = np.maximum(hi - drop - H, 0.0)
        self.H = self.H + add * (target / max(add.sum(), 1e-12))
        self.dv, self.dxy = 0.0, np.zeros(2)

    def volume(self):
        return float(((self.H - self.B) * self.act).sum() * self.dx ** 2)

    def relax(self, iters=1, rate=0.07):
        """Sandpile avalanche rule (8 neighbours): material flows from a cell to each lower neighbour in proportion to how
        far the slope exceeds tan(repose). The threshold is jittered every pass (grains do not all fail at one angle),
        which also keeps the heap round instead of octagonal. Conserves volume exactly."""
        n = self.N
        offs = ((0, 1, 1.0), (0, -1, 1.0), (1, 0, 1.0), (-1, 0, 1.0), (1, 1, SQ2), (1, -1, SQ2), (-1, 1, SQ2), (-1, -1, SQ2))
        for _ in range(iters):
            H = self.H
            Hp = np.pad(np.where(self.act, H, 1e3), 1, constant_values=1e3)
            tr = self.tan_r * (1 + 0.08 * self.rng.standard_normal(H.shape))
            flows, tot = [], np.zeros_like(H)
            for dy, dx, d in offs:
                f = np.maximum(H - Hp[1 + dy:n + 1 + dy, 1 + dx:n + 1 + dx] - tr * d * self.dx, 0.0) * rate
                flows.append(f)
                tot += f
            avail = np.maximum(H - self.B, 0.0) * self.act
            s = np.where(tot > avail, avail / np.maximum(tot, 1e-12), 1.0)
            acc = np.zeros((n + 2, n + 2))
            for (dy, dx, d), f in zip(offs, flows):
                acc[1 + dy:n + 1 + dy, 1 + dx:n + 1 + dx] += f * s
            self.H = H - tot * s + acc[1:-1, 1:-1]

    def plow(self, cap, final=False, iters=60):
        """Tamper face as a ceiling: material above `cap` joins a mobile layer that is pushed sideways (cell to cell,
        towards free space under the face) and fills it; the mobile layer carries over to the next step. Once the face
        is home, whatever has found no room has been compacted into the bed."""
        ex = np.maximum(self.H - cap, 0.0) * self.act
        self.H -= ex
        m = self.mobile + ex
        n = self.N
        nb = [(dy, dx) for dy in (-1, 0, 1) for dx in (-1, 0, 1) if dy or dx]
        ap = np.pad(self.act.astype(float), 1)
        nact = sum(ap[1 + dy:n + 1 + dy, 1 + dx:n + 1 + dx] for dy, dx in nb)
        for _ in range(iters):
            room = np.maximum(cap - self.H, 0.0) * self.act
            take = np.minimum(m, room)
            self.H += take
            m = m - take
            if m.max() < 1e-7 or room.sum() - take.sum() < 1e-7:
                break
            share = m / 10.0
            acc = np.zeros((n + 2, n + 2))
            for dy, dx in nb:
                acc[1 + dy:n + 1 + dy, 1 + dx:n + 1 + dx] += share
            m = (m - share * nact + acc[1:-1, 1:-1]) * self.act
        room = (np.maximum(cap - self.H, 0.0) * self.act).sum()
        if final or room < 1e-7:
            self.lost += float(m.sum() * self.dx ** 2)
            m = np.zeros_like(m)
        self.mobile = m


def tamper_cap(bed, zb):
    """Ceiling the tamper puts over the field with its face at zb: flat, the 0.2 mm edge radius of the chrome base, and
    in the 1.2 mm gap to the wall grounds can only be squeezed up 0.6 mm."""
    r = bed.R
    cap = np.full_like(r, 1e3)
    cap[r < 2.78] = zb
    e = (r >= 2.78) & (r < TAMPER_R)
    cap[e] = zb + 0.02 * ((r[e] - 2.78) / 0.02) ** 2
    cap[r >= TAMPER_R] = zb + 0.06
    return cap


# ------------------------------------------------------------------ air
class Air:
    """Air the stream drags along, plus turbulence. Velocities in real cm/s."""

    def __init__(self, rng, p0, v0, n_modes=28):
        tau = np.linspace(0.0, 0.25, 600)
        path = p0[None, :] + v0[None, :] * tau[:, None] + 0.5 * np.array([0, 0, -G])[None, :] * tau[:, None] ** 2
        speed = np.linalg.norm(v0[None, :] + np.array([0, 0, -G])[None, :] * tau[:, None], axis=1)
        self.z, self.x, self.y, self.speed = path[::-1, 2], path[::-1, 0], path[::-1, 1], speed[::-1]   # z increasing
        self.z0 = p0[2]
        # random Fourier modes: wavelengths 2.5 mm - 3 cm, amplitude ~ k^-5/6, every mode transverse (divergence free)
        k = np.exp(rng.uniform(np.log(2 * np.pi / 3.0), np.log(2 * np.pi / 0.25), n_modes))
        d = rng.standard_normal((n_modes, 3))
        d /= np.linalg.norm(d, axis=1, keepdims=True)
        a = np.cross(d, rng.standard_normal((n_modes, 3)))
        a /= np.linalg.norm(a, axis=1, keepdims=True)
        a *= (k ** (-5 / 6))[:, None]
        a /= math.sqrt((a ** 2).sum() / 2 / 3)               # unit rms per component
        self.k, self.a = d * k[:, None], a
        self.w = k * 4.0 * rng.uniform(0.6, 1.4, n_modes)    # eddy turnover at ~4 cm/s
        self.phi = rng.uniform(0, 2 * np.pi, n_modes)

    def turbulence(self, p, t):
        return np.sin(p @ self.k.T + self.w * t + self.phi) @ self.a

    def stream(self, p, q, bed_h):
        """Co-flow of the stream at relative flow rate q: downward in a Gaussian core around the mean path, entrainment
        towards it, and a radial outflow where it stagnates on the heap."""
        z = np.clip(p[:, 2], self.z[0], self.z[-1])
        xc, yc, V = np.interp(z, self.z, self.x), np.interp(z, self.z, self.y), np.interp(z, self.z, self.speed)
        sig = 0.45 + 0.08 * np.maximum(self.z0 - z, 0.0)
        dx, dy = p[:, 0] - xc, p[:, 1] - yc
        rho2 = dx * dx + dy * dy
        rho = np.sqrt(rho2) + 1e-6
        core = np.exp(-rho2 / sig ** 2)
        amp = 0.5 * V * q
        u = np.zeros_like(p)
        u[:, 2] = -amp * core
        inflow = -0.08 * amp * rho * sig / (rho2 + sig ** 2)
        # near the heap the column stops and spreads out over the surface
        near = np.exp(-np.maximum(p[:, 2] - bed_h, 0.0) / 0.5)
        u[:, 2] *= 1 - near
        radial = inflow + near * 0.6 * amp * np.exp(-rho2 / (2 * sig) ** 2) * np.minimum(rho / sig, 1.0)
        u[:, 0] += radial * dx / rho
        u[:, 1] += radial * dy / rho
        return u, core


def drag_rate(d, rho_p, vrel):
    """Schiller-Naumann drag as a rate (1/s): dv/dt = k (u_air - v)."""
    re = RHO_AIR * vrel * d / MU_AIR
    tau = rho_p * d * d / (18 * MU_AIR)
    return SHAPE_DRAG * (1 + 0.15 * re ** 0.687) / tau


# ------------------------------------------------------------------ the simulation
class Dose:
    """cfg: fps, sub (sub-steps per frame), slowmo, spout (exit centre), axis (unit, along the flow), exit_r,
    flow(t) -> relative mass flow (screen time), clump_weight(t) -> birth density of clumps, wander(t) -> (2,) direction wobble,
    tamper(t) -> face height, t0 (start of the simulation), frames (first, last) to record, n (per kind),
    puff_window (t0, t1), seed."""

    def __init__(self, cfg):
        self.c = cfg
        self.rng = np.random.default_rng(cfg['seed'])
        self.bed = Bed(cfg['seed'] + 1)
        a = np.asarray(cfg['axis'], float)
        self.axis = a / np.linalg.norm(a)
        u1 = np.cross(self.axis, [0.0, 0.0, 1.0])
        u1 /= np.linalg.norm(u1)
        self.u1, self.u2 = u1, np.cross(self.axis, u1)
        self.spout = np.asarray(cfg['spout'], float)
        self.air = Air(self.rng, self.spout, self.axis * 45.0)
        self._particles()

    # ---- particle population, all drawn up front so the result never depends on step boundaries
    def _births(self, n, weight):
        """Birth times (screen s) distributed like the mass flow."""
        c = self.c
        ts = np.linspace(c['t0'], c['flow_end'], 4000)
        w = np.maximum(weight(ts), 0.0)
        cdf = np.cumsum(w)
        cdf /= cdf[-1]
        return np.sort(np.interp(self.rng.random(n), cdf, ts))

    def _particles(self):
        c, rng = self.c, self.rng
        ng, nc, nf, npf = c['n']
        flow = c['flow']
        tb = [self._births(ng, flow), self._births(nc, c['clump_weight']),
              self._births(nf, flow), np.zeros(npf)]
        kind = np.concatenate([np.full(n, k, np.int8) for k, n in enumerate((ng, nc, nf, npf))])
        # diameters (cm): coarse mode log-normal around 0.30 mm; clumps 0.5-2 mm, small ones commoner; fines
        # agglomerates 60-120 um (single 30-40 um fines are below a pixel even at 4K)
        dg = np.clip(0.030 * np.exp(0.18 * rng.standard_normal(ng)), 0.02, 0.045)
        dc = 0.05 * 4.0 ** (rng.random(nc) ** 1.7)
        df = 0.006 + 0.006 * rng.random(nf)
        dp = 0.004 + 0.004 * rng.random(npf)
        self.d = np.concatenate([dg, dc, df, dp])
        self.kind, self.tb = kind, np.concatenate(tb)
        self.n = len(kind)
        self.rho = RHO_P[kind]
        # super-particles: every grain and clump stands for the same number of copies of itself, so that together they
        # carry the dose (fines and puff carry no meaningful mass)
        m = self.rho * self.d ** 3 * np.pi / 6
        heavy = kind <= CLUMP
        self.copies = DOSE / m[heavy].sum()
        self.mass = np.where(heavy, m * self.copies, 0.0)
        # exit state at the spout: grains slide along the lower wall of the inclined spout, so the stream leaves
        # off-centre; exit speed 0.3-0.6 m/s, a few degrees of spread (more for fines, less for clumps)
        n = self.n
        low = np.array([0.0, 0.0, -1.0]) - self.axis * (-self.axis[2])
        low = low / max(np.linalg.norm(low), 1e-9)
        rr = c['exit_r'] * np.sqrt(rng.random(n)) * np.where(kind == FINE, 1.2, 0.8)
        ang = rng.random(n) * 2 * np.pi
        self.p_exit = (self.spout[None, :] + low[None, :] * c['exit_r'] * 0.25 +
                       rr[:, None] * (np.cos(ang)[:, None] * self.u1 + np.sin(ang)[:, None] * self.u2))
        speed = np.where(kind == FINE, rng.uniform(10, 35, n), rng.uniform(30, 60, n))
        spread = np.radians(np.choose(kind, [4.0, 2.5, 12.0, 0.0]))
        wob = np.array([c['wander'](t) for t in self.tb]) if n else np.zeros((0, 2))
        g1 = rng.standard_normal(n) * spread + wob[:, 0]
        g2 = rng.standard_normal(n) * spread + wob[:, 1]
        dirs = self.axis[None, :] + g1[:, None] * self.u1 + g2[:, None] * self.u2
        dirs /= np.linalg.norm(dirs, axis=1, keepdims=True)
        self.v_exit = dirs * speed[:, None]
        # landed behaviour: how long a grain stays on the surface before it is covered (screen s); the heap's own surface
        # grains are drawn by shot_dose (Skin), so these are only the latest arrivals, sliding and rolling a little way
        self.life = np.choose(kind, [rng.uniform(0.04, 0.15, n), rng.uniform(0.1, 0.3, n), rng.uniform(0.02, 0.06, n), np.full(n, 99.0)])
        self._puff_setup(np.nonzero(kind == PUFF)[0])
        # dynamic state
        self.state = np.zeros(n, np.int8)          # 0 unborn, 1 flying, 2 on a surface, 3 gone
        self.pos = self.p_exit.copy()
        self.vel = self.v_exit.copy()
        self.roll = np.zeros(n)                    # speed down the slope of the heap (real cm/s)
        self.t_land = np.full(n, np.inf)
        self.stick = np.zeros(n, bool)             # stays (spilled on the rim, fines on the puck)
        self.fade = np.ones(n)
        self.spilled = 0.0
        self.pressed = False

    def _puff_setup(self, idx):
        """Fines blown out through the gap between the tamper base and the wall while the base slides into the basket
        and pushes the air out: emission in proportion to the descent speed, upward along the wall, tilting outward."""
        c, rng = self.c, self.rng
        if not len(idx):
            return
        t0, t1 = c['puff_window']
        ts = np.linspace(t0, t1, 600)
        speed = np.maximum(-np.gradient([c['tamper'](t) for t in ts], ts), 0.0)
        cdf = np.cumsum(speed + 1e-9)
        cdf /= cdf[-1]
        tb = np.interp(rng.random(len(idx)), cdf, ts)
        self.tb[idx] = tb
        th = rng.random(len(idx)) * 2 * np.pi
        r = rng.uniform(2.85, 2.95, len(idx))
        self.p_exit[idx] = np.stack([r * np.cos(th), r * np.sin(th), np.full(len(idx), 0.2)], -1)
        # gap jet: air displaced by the base (24.6 cm^2 x descent speed) leaving through the 2.2 cm^2 annulus, most of it
        # through the bed and the floor holes instead, so ~0.45 m/s at the rim, decaying in ~15 ms (real)
        up = rng.uniform(0.3, 1.0, len(idx)) * 45.0
        out = rng.uniform(0.1, 0.6, len(idx))
        v = np.stack([out * np.cos(th), out * np.sin(th), np.ones(len(idx))], -1)
        v /= np.linalg.norm(v, axis=1, keepdims=True)
        self.v_exit[idx] = v * up[:, None]
        self.puff_dir = np.zeros((self.n, 3))
        self.puff_dir[idx] = self.v_exit[idx]

    # ---- one sub-step from screen time t to t + h
    def step(self, t, h):
        c = self.c
        dt = h * c['slowmo']                      # real seconds
        t1 = t + h
        bed = self.bed
        # births
        born = np.nonzero((self.state == 0) & (self.tb <= t1))[0]
        if len(born):
            lead = ((t1 - self.tb[born]) * c['slowmo'])[:, None]
            self.pos[born] = self.p_exit[born] + self.v_exit[born] * lead
            self.vel[born] = self.v_exit[born]
            self.state[born] = 1
        q = float(c['flow'](t1)) / c['flow_peak']
        zb = c['tamper'](t1)
        # flight
        fl = np.nonzero(self.state == 1)[0]
        if len(fl):
            p, v, k = self.pos[fl], self.vel[fl], self.kind[fl]
            inside = np.hypot(p[:, 0], p[:, 1]) < R_ACTIVE - 0.05
            hb = np.where(inside, bed.sample(p[:, 0], p[:, 1]), -3.0)
            u, core = self.air.stream(p, q, hb)
            age = (t1 - self.tb[fl]) * c['slowmo']
            ispuff = k == PUFF
            if ispuff.any():
                u[ispuff] = self.puff_dir[fl[ispuff]] * np.exp(-age[ispuff] / 0.015)[:, None]
            turb = (1.5 + 0.12 * 0.5 * np.interp(np.clip(p[:, 2], self.air.z[0], self.air.z[-1]), self.air.z, self.air.speed) * q * core
                    + ispuff * 8.0 * np.exp(-age / 0.05))
            u += turb[:, None] * self.air.turbulence(p, t1 * c['slowmo'])
            vrel = np.linalg.norm(u - v, axis=1)
            kd = drag_rate(self.d[fl], self.rho[fl], vrel)
            v = (v + dt * (np.array([0.0, 0.0, -G]) + kd[:, None] * u)) / (1 + kd * dt)[:, None]
            p = p + v * dt
            self.pos[fl], self.vel[fl] = p, v
            self._collide(fl, t1, zb)
        # on the surface: grains slide and clumps roll down the heap until they are covered
        on = np.nonzero(self.state == 2)[0]
        if len(on):
            self._roll(on, t1, dt, zb)
        # the puff dilutes below visibility within half a second of screen time
        pf = np.nonzero((self.kind == PUFF) & ((self.state == 1) | (self.state == 2)))[0]
        if len(pf):
            self.fade[pf] = np.clip(1 - (t1 - self.tb[pf] - 0.12) / 0.38, 0.0, 1.0)
            self.state[pf[self.fade[pf] <= 0.0]] = 3
        # the heap
        bed.grow()
        if zb < bed.H[bed.R < TAMPER_R].max() + 0.01 or bed.mobile.any():
            bed.plow(tamper_cap(bed, zb), final=t1 >= c['times']['tamp'])
            self.pressed = True
        elif not self.pressed and not len(fl):
            bed.relax(1)

    def _collide(self, fl, t, zb):
        bed, p = self.bed, self.pos[fl]
        r = np.hypot(p[:, 0], p[:, 1])
        rad = self.d[fl] * 0.5
        inb = r < 2.98
        hb = np.where(inb, bed.sample(p[:, 0], p[:, 1]), -50.0)
        land = inb & (p[:, 2] - rad <= hb)
        ring = (~inb) & (r < 3.62) & (p[:, 2] - rad <= np.interp(r, RING_R, RING_Z))
        lost = (p[:, 2] < -4.0) | (np.abs(p[:, 0]) > 15) | (np.abs(p[:, 1]) > 15) | (p[:, 2] > 15)
        # inside the tamper base (only fines can be there): pushed away with the displaced air, shown as gone
        under = (r < TAMPER_R + 0.03) & (p[:, 2] > zb - 0.05) & (p[:, 2] < zb + 0.85)
        idx = fl[land]
        if len(idx):
            heavy = self.kind[idx] <= CLUMP
            x, y = self.pos[idx, 0], self.pos[idx, 1]
            rr = np.hypot(x, y)
            s = np.minimum(1.0, 2.97 / np.maximum(rr, 1e-9))
            bed.deposit((x * s)[heavy], (y * s)[heavy], self.mass[idx][heavy] / RHO_LOOSE)
            vt = self.vel[idx].copy()
            self.roll[idx] = np.hypot(vt[:, 0], vt[:, 1]) * 0.25
            self.state[idx] = 2
            self.t_land[idx] = t
            self.stick[idx] = self.kind[idx] == PUFF
        idx = fl[ring]
        if len(idx):
            self.state[idx] = 2
            self.t_land[idx] = t
            self.stick[idx] = True
            self.pos[idx, 2] = np.interp(np.hypot(self.pos[idx, 0], self.pos[idx, 1]), RING_R, RING_Z) + self.d[idx] * 0.4
            self.spilled += float(self.mass[idx].sum())
        idx = fl[(lost | under) & ~land & ~ring]
        self.state[idx] = 3

    def _roll(self, on, t, dt, zb):
        bed = self.bed
        p, k = self.pos[on], self.kind[on]
        st = self.stick[on]
        mv = ~st
        old = p.copy()
        if mv.any():
            i = on[mv]
            x, y = p[mv, 0], p[mv, 1]
            gx, gy = bed.gradient(x, y)
            sl = np.hypot(gx, gy) + 1e-9
            cos = 1 / np.sqrt(1 + sl * sl)
            a = G * (sl * cos - MU_K[k[mv]] * cos)
            u = np.maximum(self.roll[i] + a * dt, 0.0)
            self.roll[i] = u
            x = x - u * cos * gx / sl * dt
            y = y - u * cos * gy / sl * dt
            rr = np.hypot(x, y)
            rmax = wall_r(bed.sample(x, y)) - self.d[i] * 0.5
            s = np.minimum(1.0, rmax / np.maximum(rr, 1e-9))
            x, y = x * s, y * s
            p[mv, 0], p[mv, 1] = x, y
            p[mv, 2] = bed.sample(x, y) + self.d[i] * 0.3
        self.pos[on] = p
        self.vel[on] = (p - old) / dt
        # covered by the grounds that keep arriving (or by the tamper face coming down)
        age = t - self.t_land[on]
        f = 1.0 - np.clip((age - self.life[on]) / 0.06, 0.0, 1.0)
        f = np.where(st, 1.0, f)
        f = np.where((zb - p[:, 2] < 0.35) & ~st, np.minimum(f, 0.0), f)
        self.fade[on] = f
        self.state[on[f <= 0.0]] = 3

    # ---- run and record
    def run(self, log=print):
        c = self.c
        fps, sub = c['fps'], c['sub']
        f_first = int(round(c['t0'] * fps)) + 1
        fa, fb = c['frames']
        rec = {'H': [], 'ids': [], 'pos': [], 'vel': [], 'fade': [], 'count': [], 'vol': [], 'lost': []}
        h = 1.0 / fps / sub
        for f in range(f_first, fb + 1):
            if f > f_first:
                t = (f - 2) / fps
                for s in range(sub):
                    self.step(t + s * h, h)
            if f >= fa:
                self._record(rec)
            if f % 10 == 0:
                log(f'[dose sim] frame {f}: {int((self.state == 1).sum())} flying, {int((self.state == 2).sum())} on surfaces, '
                    f'bed {self.bed.volume():.1f} cm^3, top {self.bed.H[self.bed.act].max():.2f} cm')
        return rec

    def _record(self, rec):
        alive = np.nonzero((self.state == 1) | (self.state == 2))[0]
        rec['ids'].append(alive.astype(np.int32))
        rec['pos'].append(np.clip(np.round(self.pos[alive] / POS_Q), -32767, 32767).astype(np.int16))
        rec['vel'].append(np.clip(np.round(self.vel[alive] * self.c['slowmo'] / VEL_Q), -32767, 32767).astype(np.int16))
        rec['fade'].append(np.round(np.clip(self.fade[alive], 0, 1) * 255).astype(np.uint8))
        rec['count'].append(len(alive))
        rec['H'].append(self.bed.H.astype(np.float32))
        rec['vol'].append(self.bed.volume())
        rec['lost'].append(self.bed.lost)


POS_Q = 0.0005                # cm per int16 step (+-16.4 cm)
VEL_Q = 0.01                  # cm/s (screen) per int16 step


# ------------------------------------------------------------------ the grains on the heap's surface
def sample_grid(F, x0, dx, x, y):
    """Bilinear sample of a square grid F[iy, ix] whose first cell centre is at (x0, x0)."""
    n = F.shape[0]
    fx, fy = (x - x0) / dx, (y - x0) / dx
    ix = np.clip(np.floor(fx).astype(np.int64), 0, n - 2)
    iy = np.clip(np.floor(fy).astype(np.int64), 0, n - 2)
    wx, wy = np.clip(fx - ix, 0, 1), np.clip(fy - iy, 0, 1)
    return (F[iy, ix] * (1 - wx) + F[iy, ix + 1] * wx) * (1 - wy) + (F[iy + 1, ix] * (1 - wx) + F[iy + 1, ix + 1] * wx) * wy


class Skin:
    """Where the grains of the heap's visible surface are at any (sub)frame, computed from the height field alone (no
    history: every motion-blur sub-frame stands on its own, and a reopened .blend gives the same grains).

    A heap fed at its apex grows by surface flows: each layer of fresh grounds runs out and down the flanks and is
    covered by the next, so the grains seen on a flank move down the slope, never up. Every grain carries a fixed
    bearing th from the heap's axis `centre` and a fixed height z; at time t it sits where the heap's outer surface
    along that bearing crosses z (outermost crossing, so a dip never traps it). On a growing cone that contour widens,
    which moves the grain downhill at (dH/dt) / |grad H|. It is born at the apex when the heap first reaches z, and it
    is buried once the toe, climbing the basket wall, has risen past it (it sinks into the bed by that much).
    Density: grains are spread evenly in (th, z), n per radian per cm; a contour band at radius r and slope g holds
    n dth dz of them over r sqrt(1 + g^2) / g dth dz of surface, so a grain is shown while a fixed random number u is
    below p = sigma r sqrt(1 + g^2) / (g n). p grows as the cone widens: grains fade in to fill the spreading surface
    and none ever flickers out."""
    NT, NR, RMAX = 720, 200, 3.1
    COVER = 0.004                          # cm of grounds over the steel that count as covered

    def __init__(self, centre, X, B):
        self.c = np.asarray(centre, float)
        self.x0, self.dx = float(X[0]), float(X[1] - X[0])
        self.B = np.asarray(B, float)
        self.dr = self.RMAX / (self.NR - 1)
        th = -np.pi + np.arange(self.NT) * (2 * np.pi / self.NT)
        r = np.arange(self.NR) * self.dr
        self.PX = self.c[0] + np.cos(th)[:, None] * r[None, :]
        self.PY = self.c[1] + np.sin(th)[:, None] * r[None, :]
        self.iters = int(math.ceil(math.log2(self.NR + 1)))

    def sample(self, F, x, y):
        return sample_grid(F, self.x0, self.dx, x, y)

    def envelope(self, H):
        """Outer envelope of the covered surface along every bearing: M[k, j] = max of H over radii >= r_j (cm), -1e3
        where nothing beyond is covered. Non-increasing along j. Cells are masked before sampling, so the steep steel
        of the wall next to a covered cell never blends into a false rim."""
        h = self.sample(np.where(H - self.B > self.COVER, H, -1e3), self.PX, self.PY)
        hc = np.where(h > -5.0, h, -1e3)
        return np.maximum.accumulate(hc[:, ::-1], axis=1)[:, ::-1]

    def _cross(self, M, k, z):
        lo, hi = np.zeros(len(z), np.int64), np.full(len(z), self.NR, np.int64)
        for _ in range(self.iters):                         # count of samples with M >= z (a prefix)
            act = lo < hi
            mid = (lo + hi) // 2
            ok = M[k, np.minimum(mid, self.NR - 1)] >= z
            lo = np.where(act & ok, mid + 1, lo)
            hi = np.where(act & ~ok, mid, hi)
        i = np.clip(lo - 1, 0, self.NR - 1)
        m0, m1 = M[k, i], M[k, np.minimum(i + 1, self.NR - 1)]
        inner = (lo > 0) & (lo < self.NR) & (m1 > -500.0)
        frac = np.where(inner, (m0 - z) / np.maximum(m0 - m1, 1e-9), 0.0)
        r = (i + np.clip(frac, 0.0, 1.0)) * self.dr
        depth = np.where(inner | (lo == 0), 0.0, np.maximum(m0 - z, 0.0))
        return r, depth, (lo > 0).astype(float)

    def place(self, H, th, z):
        """Grains (bearing th, height z) on the field H: x, y, the radius from the axis, how deep the toe has buried
        them (cm) and whether the heap has reached them yet (0..1, blended between bearings)."""
        M = self.envelope(H)
        f = (th + np.pi) / (2 * np.pi) * self.NT
        k0 = np.floor(f).astype(np.int64) % self.NT
        w = f - np.floor(f)
        r0, d0, b0 = self._cross(M, k0, z)
        r1, d1, b1 = self._cross(M, (k0 + 1) % self.NT, z)
        r, depth, born = r0 + (r1 - r0) * w, d0 + (d1 - d0) * w, b0 + (b1 - b0) * w
        return self.c[0] + r * np.cos(th), self.c[1] + r * np.sin(th), r, depth, born


def pack(rec, sim):
    """Flatten the per-frame records into arrays for np.savez."""
    off = np.concatenate([[0], np.cumsum(rec['count'])]).astype(np.int64)
    return dict(H=np.stack(rec['H']), off=off, ids=np.concatenate(rec['ids']), pos=np.concatenate(rec['pos']),
                vel=np.concatenate(rec['vel']), fade=np.concatenate(rec['fade']), kind=sim.kind, d=sim.d.astype(np.float32),
                tb=sim.tb, X=sim.bed.X[0].astype(np.float32), B=sim.bed.B.astype(np.float32), vol=np.array(rec['vol']),
                lost=np.array(rec['lost']))


# ------------------------------------------------------------------ the shot's schedule
SLOWMO = 0.5                  # real seconds per screen second (120 fps footage played at 60)
SPOUT = (0.1, 0.62, 4.45)     # centre of the spout exit
SPOUT_AXIS = (0.0, -0.208, -0.978)   # the spout leans 12 degrees towards the front of the grinder
EXIT_R = 0.6                  # inner radius of the spout (12 mm bore)
TAMPER_TOP = 16.0             # tamper face height when out of the frame
PUCK = -0.62                  # face height at full tamp: 18 g in 42 cm^3
BURR_HZ = 1480.0 / 60.0       # the stream pulses once per turn of the burr carrier


def schedule(T, fps, seed=7):
    """Configuration for Dose from the edit's timeline T (common.T). Screen times."""
    on, taper, off = T['dose'] - 0.24, T['tamp'] - 0.54, T['tamp'] - 0.36
    down, tamp, lift, end = T['tamp'] - 0.32, T['tamp'], T['tamp'] + 0.13, T['extract']

    def flow(t):
        t = np.asarray(t, float)
        env = smoothstep(on, on + 0.04, t) * (1 - smoothstep(taper, off, t))
        pulse = (1 + 0.22 * np.sin(2 * np.pi * BURR_HZ * SLOWMO * t) + 0.15 * np.sin(2 * np.pi * 3.7 * t + 1.0)
                 + 0.1 * np.sin(2 * np.pi * 5.9 * t + 2.3))
        return env * pulse

    def clump_weight(t):
        # the last grams leave the chute in clumps, and a few more sputter out after the stream has stopped
        t = np.asarray(t, float)
        return flow(t) * (1 + 3.0 * smoothstep(taper - 0.1, off, t)) + 0.6 * (smoothstep(off - 0.06, off - 0.02, t) - smoothstep(off + 0.01, off + 0.05, t))

    def wander(t):
        # the stream sways a little as the chute empties and refills (radians)
        return np.array([0.03 * math.sin(2 * math.pi * 2.3 * t + 0.4) + 0.015 * math.sin(2 * math.pi * 6.1 * t),
                         0.025 * math.sin(2 * math.pi * 1.7 * t + 2.0) + 0.012 * math.sin(2 * math.pi * 7.3 * t + 1.0)])

    def tamper(t):
        if t < down:
            return TAMPER_TOP
        if t < tamp:
            s = (t - down) / (tamp - down)
            return PUCK + (TAMPER_TOP - PUCK) * (1 - s) ** 3        # glides in, slows as the bed resists
        if t < lift:
            return PUCK
        s = min((t - lift) / (end - lift), 1.0)
        return PUCK + (TAMPER_TOP - PUCK) * s ** 2.2

    ts = np.linspace(on, off, 2000)
    return dict(fps=fps, sub=16, slowmo=SLOWMO, spout=SPOUT, axis=SPOUT_AXIS, exit_r=EXIT_R, flow=flow,
                flow_peak=float(flow(ts).max()), flow_end=off + 0.06, clump_weight=clump_weight, wander=wander, tamper=tamper,
                t0=on - 0.02, frames=(int(round(T['dose'] * fps)), int(round(T['extract'] * fps)) + 1),
                n=(60000, 5000, 6000, 6000), puff_window=(down + 0.19, tamp + 0.005), seed=seed,
                times=dict(on=on, taper=taper, off=off, down=down, tamp=tamp, lift=lift, end=end))
