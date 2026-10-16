"""Build one shot in memory and render a few stills, for development.

    blender -b --factory-startup -P v4/tools/shot_test.py -- --shot burrs --frames 80,120 --scale 0.2 --samples 16 [--out DIR] [--save]
"""
import argparse
import importlib
import sys
import time
from pathlib import Path

V4 = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(V4))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--shot', required=True)
ap.add_argument('--frames', default='')
ap.add_argument('--scale', type=float, default=0.2)
ap.add_argument('--samples', type=int, default=16)
ap.add_argument('--out', default=str(V4 / 'preview'))
ap.add_argument('--save', action='store_true', help='also save the .blend next to the stills')
ap.add_argument('--no-mb', action='store_true')
args = ap.parse_args(argv)

import bpy  # noqa: E402

from coffee import common as C, stage as S  # noqa: E402

C.CACHE.mkdir(parents=True, exist_ok=True)
out = Path(args.out)
out.mkdir(parents=True, exist_ok=True)
for ob in list(bpy.data.objects):
    bpy.data.objects.remove(ob)
mod = importlib.import_module(f'coffee.shot_{args.shot}')
t = time.time()
sc = S.new_scene(args.shot)
mod.build(sc)
print(f'[test] built {args.shot} in {time.time() - t:.1f}s, frames {sc.frame_start}-{sc.frame_end}, {len(sc.objects)} objects', flush=True)
S.configure_device()
C.install_handlers()
sc.render.resolution_percentage = int(round(args.scale * 100))
sc.cycles.samples = args.samples
sc.cycles.adaptive_min_samples = max(4, args.samples // 4)
if args.no_mb:
    sc.render.use_motion_blur = False
frames = [int(x) for x in args.frames.split(',') if x] or [sc.frame_start, (sc.frame_start + sc.frame_end) // 2, sc.frame_end]
for f in frames:
    sc.frame_set(f)
    sc.render.filepath = str(out / f'{args.shot}_{f:04d}.png')
    t = time.time()
    with bpy.context.temp_override(scene=sc):
        bpy.ops.render.render(write_still=True)
    print(f'[test] frame {f} -> {sc.render.filepath} ({time.time() - t:.1f}s)', flush=True)
if args.save:
    bpy.ops.wm.save_as_mainfile(filepath=str(out / f'{args.shot}.blend'))
