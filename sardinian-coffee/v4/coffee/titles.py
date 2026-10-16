"""The closing title, rendered once as a transparent 4K PNG that the encoder fades in over the last shot,
plus the soft dark gradient that sits behind it."""
import bpy
import numpy as np

from . import common as C


def build_tagline(path=None):
    path = path or C.CACHE / 'tagline.png'
    sc = bpy.data.scenes.new('tagline')
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = 64
    sc.cycles.device = 'CPU'
    sc.render.resolution_x, sc.render.resolution_y = C.WIDTH, C.HEIGHT
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.view_settings.view_transform = 'Standard'
    sc.world = bpy.data.worlds.new('tagline_world')
    font = bpy.data.fonts.load(str(C.FONT), check_existing=True)
    lines = [('SU CAFÈ DE SARDIGNA', 1.0, 0.14, (1.0, 0.86, 0.6)), ('SARDINIAN COFFEE CORNER', 0.42, 0.5, (0.86, 0.68, 0.42))]
    y = 0.0
    for text, size, spacing, col in lines:
        cu = bpy.data.curves.new(f'tag_{size}', 'FONT')
        cu.body = text
        cu.font = font
        cu.size = size
        cu.space_character = 1.0 + spacing
        cu.align_x = 'CENTER'
        cu.align_y = 'CENTER'
        mat = bpy.data.materials.new(f'tag_mat_{size}')
        nt = mat.node_tree
        nt.nodes.clear()
        em = nt.nodes.new('ShaderNodeEmission')
        em.inputs['Color'].default_value = (*col, 1.0)
        em.inputs['Strength'].default_value = 1.0
        out = nt.nodes.new('ShaderNodeOutputMaterial')
        nt.links.new(em.outputs[0], out.inputs['Surface'])
        cu.materials.append(mat)
        ob = C.obj_new(f'tag_{size}', cu, sc.collection)
        ob.location = (0, y, 0)
        y -= size * 1.25
    # thin rules either side of the first line
    for s in (-1, 1):
        me = bpy.data.meshes.new('rule')
        me.from_pydata([(s * 6.2, 0.36, 0), (s * 7.8, 0.36, 0), (s * 7.8, 0.385, 0), (s * 6.2, 0.385, 0)], [], [(0, 1, 2, 3)])
        me.materials.append(bpy.data.materials['tag_mat_0.42'])
        C.obj_new('rule', me, sc.collection)
    cam = bpy.data.cameras.new('tag_cam')
    cam.type = 'ORTHO'
    cam.ortho_scale = 34.0
    cam.sensor_fit = 'VERTICAL'
    co = C.obj_new('tag_cam', cam, sc.collection)
    co.location = (0, 13.5, 10)   # the title sits about a quarter of the frame above the bottom edge
    sc.camera = co
    sc.render.filepath = str(path)
    bpy.ops.render.render(write_still=True, scene=sc.name)
    bpy.data.scenes.remove(sc)
    build_shade()
    return path


def build_shade(path=None):
    """Bottom 42 % of the frame darkening to 80 % towards the edge (row 0 of Blender pixels is the bottom)."""
    path = path or C.CACHE / 'shade.png'
    w, h = C.WIDTH // 8, C.HEIGHT // 8   # smooth gradient, scaled up by the encoder
    y = (np.arange(h) + 0.5) / h                       # 0 at the bottom
    a = np.clip((0.42 - y) / 0.42, 0, 1) * 0.8
    rgba = np.zeros((h, w, 4), np.float32)
    rgba[..., 0], rgba[..., 1], rgba[..., 2] = 0.024, 0.012, 0.008
    rgba[..., 3] = a[:, None]
    img = bpy.data.images.new('shade', w, h, alpha=True)
    img.pixels.foreach_set(rgba.ravel())
    img.filepath_raw = str(path)
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)
    return path
