"""Geometry Nodes helpers: turn a moving vertex cloud into instanced grains for rendering."""
import bpy


def grain_instancer(name, shapes_collection, material):
    """Mesh vertices -> points -> a random grain shape per point, scaled by the 'size' attribute and rotated by a
    stable random orientation from the 'pid' attribute (so instances keep their identity across motion-blur steps)."""
    ng = bpy.data.node_groups.new(name, 'GeometryNodeTree')
    ng.interface.new_socket('Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')
    ng.interface.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
    N = ng.nodes.new
    L = ng.links.new
    gi, go = N('NodeGroupInput'), N('NodeGroupOutput')
    m2p = N('GeometryNodeMeshToPoints')
    size = N('GeometryNodeInputNamedAttribute')
    size.data_type = 'FLOAT'
    size.inputs['Name'].default_value = 'size'
    pid = N('GeometryNodeInputNamedAttribute')
    pid.data_type = 'INT'
    pid.inputs['Name'].default_value = 'pid'
    coll = N('GeometryNodeCollectionInfo')
    coll.inputs['Collection'].default_value = shapes_collection
    coll.inputs['Separate Children'].default_value = True
    coll.inputs['Reset Children'].default_value = True
    pick = N('FunctionNodeRandomValue')
    pick.data_type = 'INT'
    _in(pick, 'Max', 'INT').default_value = len(shapes_collection.objects) - 1
    pick.inputs['Seed'].default_value = 7
    rot = N('FunctionNodeRandomValue')
    rot.data_type = 'FLOAT_VECTOR'
    _in(rot, 'Min', 'VECTOR').default_value = (0, 0, 0)
    _in(rot, 'Max', 'VECTOR').default_value = (6.2832, 6.2832, 6.2832)
    rot.inputs['Seed'].default_value = 3
    e2r = N('FunctionNodeEulerToRotation')
    inst = N('GeometryNodeInstanceOnPoints')
    setm = N('GeometryNodeSetMaterial')
    setm.inputs['Material'].default_value = material
    L(gi.outputs[0], m2p.inputs['Mesh'])
    L(m2p.outputs[0], inst.inputs['Points'])
    L(coll.outputs[0], inst.inputs['Instance'])
    inst.inputs['Pick Instance'].default_value = True
    L(_out_named(pid, 'Attribute', 'INT'), pick.inputs['ID'])
    L(_out_named(pid, 'Attribute', 'INT'), rot.inputs['ID'])
    _out(pick, 'INT', L, inst.inputs['Instance Index'])
    _out(rot, 'FLOAT_VECTOR', L, e2r.inputs['Euler'])
    L(e2r.outputs[0], inst.inputs['Rotation'])
    L(_out_named(size, 'Attribute', 'VALUE'), inst.inputs['Scale'])
    L(inst.outputs[0], setm.inputs['Geometry'])
    L(setm.outputs[0], go.inputs[0])
    return ng


def _out(node, kind, link, target):
    for o in node.outputs:
        if o.enabled and (kind != 'INT' or o.type == 'INT') and (kind != 'FLOAT_VECTOR' or o.type == 'VECTOR'):
            link(o, target)
            return
    raise RuntimeError(f'no {kind} output on {node.name}')


def _in(node, name, kind):
    for i in node.inputs:
        if i.name == name and i.type == kind and i.enabled:
            return i
    raise RuntimeError(f'no {kind} input {name} on {node.name}')


def _out_named(node, name, kind):
    for o in node.outputs:
        if o.name == name and o.type == kind and o.enabled:
            return o
    raise RuntimeError(f'no {kind} output {name} on {node.name}')


def layer_instancer(name, shapes_collection):
    """Mesh vertices -> one shape per point with a full affine transform from numpy: 'shape' (INT) picks the child of
    the collection (children sort by name), 'xf' (FLOAT4X4, column-major) is the whole instance matrix (rotation,
    non-uniform and world-space scale, position), points whose 'vis' (FLOAT) is <= 0.02 are dropped first. An 'id'
    attribute on the points carries over to the instances and keeps each one's identity between motion-blur steps.
    The shapes keep their own materials; every other point attribute reaches the shader as an instancer attribute."""
    ng = bpy.data.node_groups.new(name, 'GeometryNodeTree')
    ng.interface.new_socket('Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')
    ng.interface.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
    N = ng.nodes.new
    L = ng.links.new
    gi, go = N('NodeGroupInput'), N('NodeGroupOutput')
    m2p = N('GeometryNodeMeshToPoints')
    vis = _named(N, 'FLOAT', 'vis')
    hide = N('FunctionNodeCompare')
    hide.data_type = 'FLOAT'
    hide.operation = 'LESS_EQUAL'
    _in(hide, 'B', 'VALUE').default_value = 0.02
    drop = N('GeometryNodeDeleteGeometry')
    drop.domain = 'POINT'
    shape = _named(N, 'INT', 'shape')
    xf = _named(N, 'FLOAT4X4', 'xf')
    coll = N('GeometryNodeCollectionInfo')
    coll.inputs['Collection'].default_value = shapes_collection
    coll.inputs['Separate Children'].default_value = True
    coll.inputs['Reset Children'].default_value = True
    inst = N('GeometryNodeInstanceOnPoints')
    inst.inputs['Pick Instance'].default_value = True
    put = N('GeometryNodeSetInstanceTransform')
    L(gi.outputs[0], m2p.inputs['Mesh'])
    L(_out_named(vis, 'Attribute', 'VALUE'), _in(hide, 'A', 'VALUE'))
    L(m2p.outputs[0], drop.inputs['Geometry'])
    L(hide.outputs[0], drop.inputs['Selection'])
    L(drop.outputs[0], inst.inputs['Points'])
    L(coll.outputs[0], inst.inputs['Instance'])
    L(_out_named(shape, 'Attribute', 'INT'), inst.inputs['Instance Index'])
    L(inst.outputs[0], put.inputs['Instances'])
    L(_out_named(xf, 'Attribute', 'MATRIX'), put.inputs['Transform'])
    L(put.outputs[0], go.inputs[0])
    return ng


def _named(N, kind, name):
    nd = N('GeometryNodeInputNamedAttribute')
    nd.data_type = kind
    nd.inputs['Name'].default_value = name
    return nd


def squash_instancer(name, shapes_collection, material):
    """grain_instancer, then each instance flattened about its own position in object space by a 'squash' (FLOAT)
    point attribute k: widened by 1 + 0.35 k across, pressed to 1 - 0.7 k in z (grains crushed under a tamper face)."""
    ng = grain_instancer(name, shapes_collection, material)
    N = ng.nodes.new
    L = ng.links.new
    inst = next(n for n in ng.nodes if n.bl_idname == 'GeometryNodeInstanceOnPoints')
    setm = next(n for n in ng.nodes if n.bl_idname == 'GeometryNodeSetMaterial')
    k = _out_named(_named(N, 'FLOAT', 'squash'), 'Attribute', 'VALUE')
    wide, flat = N('ShaderNodeMath'), N('ShaderNodeMath')
    wide.operation = flat.operation = 'MULTIPLY_ADD'
    L(k, wide.inputs[0])
    wide.inputs[1].default_value, wide.inputs[2].default_value = 0.35, 1.0
    L(k, flat.inputs[0])
    flat.inputs[1].default_value, flat.inputs[2].default_value = -0.7, 1.0
    xyz = N('ShaderNodeCombineXYZ')
    L(wide.outputs[0], xyz.inputs['X'])
    L(wide.outputs[0], xyz.inputs['Y'])
    L(flat.outputs[0], xyz.inputs['Z'])
    sc = N('GeometryNodeScaleInstances')
    sc.inputs['Local Space'].default_value = False
    L(inst.outputs[0], sc.inputs['Instances'])
    L(xyz.outputs[0], sc.inputs['Scale'])
    L(N('GeometryNodeInputPosition').outputs[0], sc.inputs['Center'])
    L(sc.outputs[0], setm.inputs['Geometry'])
    return ng
