"""Render the v4 outro with Cycles on this machine's GPU (Metal on Apple silicon, OptiX on NVIDIA).

    blender -b v4/coffee.blend -P v4/render.py --                     all 720 frames into v4/frames (resumable)
    blender -b v4/coffee.blend -P v4/render.py -- --frames 241-432   a range (several machines can split the work)
    blender -b v4/coffee.blend -P v4/render.py -- --still 300,450 --scale 0.25 --samples 64   quick stills into v4/preview
    blender -b v4/coffee.blend -P v4/render.py -- --bench             times 3 frames at full quality and estimates the total
    blender -b v4/coffee.blend -P v4/render.py -- --scale 0.5 --samples 32 --out v4/frames_draft   a quick draft of the whole film

Frames already on disk are skipped, so an interrupted render can simply be started again; frames older than
coffee.blend (left over from an earlier build) are rendered again.
"""
import argparse
import importlib
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--frames', default='')
ap.add_argument('--still', default='')
ap.add_argument('--shots', default='')
ap.add_argument('--scale', type=float, default=1.0)
ap.add_argument('--samples', type=int, default=0)
ap.add_argument('--device', default='AUTO')
ap.add_argument('--bench', action='store_true')
ap.add_argument('--no-mb', action='store_true')
ap.add_argument('--out', default='', help='output folder for the frames (default v4/frames)')
args = ap.parse_args(argv)

import os  # noqa: E402

import bpy  # noqa: E402

os.environ['COFFEE_FPS'] = str(bpy.data.scenes[0].render.fps)   # the frame rate the file was built at
from coffee import common as C, stage as S  # noqa: E402


def frames_wanted():
    if args.still:
        return sorted({int(x) for x in args.still.split(',') if x})
    if args.bench:
        return [C.frame_of(1.6), C.frame_of(5.5), C.frame_of(9.0)]
    if args.frames:
        a, b = (int(x) for x in args.frames.split('-'))
        return list(range(a, b + 1))
    return list(range(1, C.frame_of(C.DUR)))


def main():
    kind, names = ('CPU', []) if args.device == 'CPU' else S.configure_device()
    print(f'[render] device: {kind} {names}', flush=True)
    C.clear_updaters()
    order = [n for n, _, _ in C.SHOTS if n in bpy.data.scenes and (not args.shots or n in args.shots.split(','))]
    for name in order:
        importlib.import_module(f'coffee.shot_{name}').attach(bpy.data.scenes[name])
    C.install_handlers()
    want = frames_wanted()
    out_dir = Path(args.out) if args.out else (C.PREVIEW if (args.still or args.bench) else C.FRAMES)
    out_dir.mkdir(parents=True, exist_ok=True)
    built = os.path.getmtime(bpy.data.filepath)
    times = []
    skipped = 0
    for name in order:
        sc = bpy.data.scenes[name]
        mine = [f for f in want if sc.frame_start <= f <= sc.frame_end]
        if not mine:
            continue
        sc.render.resolution_percentage = int(round(100 * args.scale))
        if args.samples:
            sc.cycles.samples = args.samples
            sc.cycles.adaptive_min_samples = min(sc.cycles.adaptive_min_samples, max(4, args.samples // 4))
        if args.no_mb:
            sc.render.use_motion_blur = False
        if kind == 'CPU':
            sc.cycles.device = 'CPU'
        for f in mine:
            path = out_dir / f'f_{f:05d}.png'
            if path.exists() and path.stat().st_mtime > built and not (args.still or args.bench):
                skipped += 1
                continue
            t = time.time()
            sc.frame_set(f)
            sc.render.filepath = str(path)
            with bpy.context.temp_override(scene=sc):     # the render evaluates the context scene's frame
                bpy.ops.render.render(write_still=True)
            dt = time.time() - t
            times.append(dt)
            done = len(times)
            print(f'[render] {name} frame {f} in {dt:.1f}s ({done}/{len(want)})', flush=True)
    if skipped:
        print(f'[render] {skipped} frames already rendered from this build, skipped', flush=True)
    if args.bench and times:
        per = sum(times) / len(times)
        total = per * (C.frame_of(C.DUR) - 1)
        print(f'[render] about {per:.0f}s per frame -> {total / 3600:.1f} hours for {C.frame_of(C.DUR) - 1} frames at {C.FPS} fps', flush=True)


main()
