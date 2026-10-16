"""Build the whole v4 outro as a Blender file: every shot is a scene on the global timeline, physics baked.

    blender -b --factory-startup -P v4/build.py -- [--shots beans,burrs,dose,extract,cup] [--fps 60] [--out v4/coffee.blend]

Then render with v4/render.py and encode with v4/encode.py (see README).
"""
import argparse
import importlib
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--shots', default='beans,burrs,dose,extract,cup')
ap.add_argument('--fps', type=int, default=60)
ap.add_argument('--out', default=str(HERE / 'coffee.blend'))
args = ap.parse_args(argv)
os.environ['COFFEE_FPS'] = str(args.fps)
sys.path.insert(0, str(HERE))

import bpy  # noqa: E402

from coffee import common as C, stage as S, titles  # noqa: E402


def main():
    t0 = time.time()
    C.CACHE.mkdir(parents=True, exist_ok=True)
    default = bpy.data.scenes[0]
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob)
    shots = [s.strip() for s in args.shots.split(',') if s.strip()]
    for name in shots:
        t1 = time.time()
        mod = importlib.import_module(f'coffee.shot_{name}')
        sc = S.new_scene(name)
        mod.build(sc)
        print(f'[build] {name}: frames {sc.frame_start}-{sc.frame_end}, {len(sc.objects)} objects, {time.time() - t1:.1f}s', flush=True)
    titles.build_tagline()
    bpy.data.scenes.remove(default)
    S.use_acescg()
    bpy.ops.file.make_paths_relative()
    bpy.ops.wm.save_as_mainfile(filepath=args.out, compress=True)
    print(f'[build] saved {args.out} in {time.time() - t0:.1f}s', flush=True)


main()
