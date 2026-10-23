"""Run with Blender --background --factory-startup --python scripts/build_assets.py.

Original mesh and procedural surfaces, referencing the structure of the National
Museum's Zeng Hou Yu yongzhong. No museum photograph or scan is redistributed.
The modal body's outer contour is imported from the authoritative model module.
"""
import bpy
import json
import math
import sys
import hashlib
from pathlib import Path
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import elastic_model as model

OUT=ROOT/'public'/'models'
SOURCE=ROOT/'assets'/'source'
OUT.mkdir(parents=True,exist_ok=True)
SOURCE.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version=0
scene=bpy.context.scene
scene.render.engine='CYCLES'
scene.cycles.device='CPU'
scene.cycles.samples=24
scene.render.threads_mode='FIXED'
scene.render.threads=2
scene.view_settings.view_transform='AgX'
scene.render.image_settings.file_format='PNG'
scene.render.resolution_percentage=100
scene.world.color=(.035,.035,.035)


def bronze():
    mat=bpy.data.materials.new('Bronze_patina_original')
    mat.use_nodes=True
    n=mat.node_tree.nodes;l=mat.node_tree.links
    bsdf=n.get('Principled BSDF')
    coord=n.new('ShaderNodeTexCoord')
    noise=n.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=35;noise.inputs['Detail'].default_value=5;noise.inputs['Roughness'].default_value=.72
    l.new(coord.outputs['Generated'],noise.inputs['Vector'])
    ramp=n.new('ShaderNodeValToRGB')
    elements=ramp.color_ramp.elements
    elements.remove(elements[1]);elements[0].position=.18;elements[0].color=(.045,.033,.022,1)
    for pos,color in ((.36,(.105,.063,.027,1)),(.50,(.11,.085,.043,1)),(.63,(.047,.073,.045,1)),(.75,(.040,.105,.073,1)),(.9,(.10,.14,.085,1))):
        e=elements.new(pos);e.color=color
    l.new(noise.outputs['Fac'],ramp.inputs['Fac']);l.new(ramp.outputs['Color'],bsdf.inputs['Base Color'])
    bsdf.inputs['Metallic'].default_value=.68
    rough=n.new('ShaderNodeMapRange');rough.inputs['From Min'].default_value=.2;rough.inputs['From Max'].default_value=.85;rough.inputs['To Min'].default_value=.58;rough.inputs['To Max'].default_value=.82
    l.new(noise.outputs['Fac'],rough.inputs['Value']);l.new(rough.outputs['Result'],bsdf.inputs['Roughness'])
    fine=n.new('ShaderNodeTexNoise');fine.inputs['Scale'].default_value=180;fine.inputs['Detail'].default_value=3
    l.new(coord.outputs['Generated'],fine.inputs['Vector'])
    bump=n.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.22;bump.inputs['Distance'].default_value=.00008
    l.new(fine.outputs['Fac'],bump.inputs['Height']);l.new(bump.outputs['Normal'],bsdf.inputs['Normal'])
    return mat,ramp.outputs['Color'],rough.outputs['Result']


mat,color_socket,rough_socket=bronze()
parts=[]


def point(x,y,z):return Vector((float(x),-float(y),model.HEIGHT-float(z)))


def finish(obj,name):
    obj.name=name
    obj.data.materials.clear();obj.data.materials.append(mat)
    for face in obj.data.polygons:face.use_smooth=True
    parts.append(obj)
    return obj


def mesh(name,vertices,faces):
    data=bpy.data.meshes.new(name);data.from_pydata(vertices,[],faces);data.update()
    obj=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(obj)
    return finish(obj,name)


outer,inner,_=model.surface(0,0,0,nt=96,nz=32)
nt,nz=96,32
verts=[tuple(point(*v)) for ring in outer for v in ring]
faces=[]
for z in range(nz):
    for t in range(nt):
        a=z*nt+t;b=z*nt+(t+1)%nt;c=(z+1)*nt+t;d=(z+1)*nt+(t+1)%nt
        faces.append((a,b,d,c))
body=mesh('钟体_合瓦曲面',verts,faces)
cap_verts=[tuple(point(*v)) for v in outer[0]]+[(0,0,model.HEIGHT)]
mesh('舞部_顶盖',cap_verts,[(t,(t+1)%nt,nt) for t in range(nt)])
rim_verts=[tuple(point(*v)) for v in outer[-1]]+[tuple(point(*v)) for v in inner[-1]]
mesh('弧形钟口',rim_verts,[(t,(t+1)%nt,(t+1)%nt+nt,t+nt) for t in range(nt)])


def cylinder(name,radius,depth,location,vertices=32):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=radius,depth=depth,location=location)
    obj=finish(bpy.context.object,name)
    bevel=obj.modifiers.new('铸造圆角','BEVEL');bevel.width=.00035;bevel.segments=2
    return obj


cylinder('甬_柄',.009,.083,(0,0,model.HEIGHT+.0415))
cylinder('旋_承环',.014,.008,(0,0,model.HEIGHT+.026))
cylinder('甬顶缘',.010,.003,(0,0,model.HEIGHT+.083))
bpy.ops.mesh.primitive_torus_add(major_segments=40,minor_segments=10,location=(.013,0,model.HEIGHT+.025),major_radius=.007,minor_radius=.002,rotation=(math.pi/2,0,0))
finish(bpy.context.object,'侧向悬环')


def line(name,coords,radius=.00045):
    data=bpy.data.curves.new(name,'CURVE');data.dimensions='3D';data.resolution_u=1;data.bevel_depth=radius;data.bevel_resolution=2
    spline=data.splines.new('POLY');spline.points.add(len(coords)-1)
    for p,v in zip(spline.points,coords):p.co=(*v,1)
    obj=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    parts.append(obj)
    return obj


def surface_point(t,u,sign=1,outward=.0004):
    import numpy as np
    p=model.contour(np.array([t]),sign)[0]
    p=p*model.scale_at(u)
    n=Vector((math.sin(t),-sign*math.cos(t),0))
    return point(p[0],p[1],u*model.height_at(model.contour(np.array([t]),sign))[0])+n*outward


for u in (.13,.32,.51,.69):
    coords=[]
    for t in range(nt):
        row=outer[int(round(u*nz)),t]
        v=point(*row);v.x*=1.006;v.y*=1.006;coords.append(tuple(v))
    coords.append(coords[0]);line('横向纹带',coords,.00065)


for sign in (1,-1):
    for u in (.22,.41,.60):
        for frac in (-.72,-.47,-.23,.23,.47,.72):
            t=model.ALPHA*frac
            normal=Vector((math.sin(t),-sign*math.cos(t),0))
            center=surface_point(t,u,sign)+normal*.0026
            bpy.ops.mesh.primitive_cone_add(vertices=16,radius1=.0039,radius2=.0026,depth=.006,location=center)
            obj=finish(bpy.context.object,'枚_分组突起')
            obj.rotation_mode='QUATERNION';obj.rotation_quaternion=Vector((0,0,1)).rotation_difference(normal)
            bevel=obj.modifiers.new('枚端磨损','BEVEL');bevel.width=.0003;bevel.segments=2
    for frac in (-.13,.13):
        line('钲部纵向边框',[tuple(surface_point(model.ALPHA*frac,u,sign)) for u in (.12,.28,.45,.62,.70)],.00055)
    # An original rectilinear interlocking frieze; no copied inscription or image.
    for row in (.30,.49,.68):
        for side in (-1,1):
            coords=[tuple(surface_point(model.ALPHA*side*.19,row-.007,sign,.0007))]
            for k in range(8):
                f0=.19+.64*k/8;f1=f0+.64/16;f2=f0+.64/8
                for f,u in ((f0,row+.007),(f1,row+.007),(f1,row-.007),(f2,row-.007)):
                    coords.append(tuple(surface_point(model.ALPHA*side*f,u,sign,.0007)))
            line('自主回折纹',coords,.00045)
    for side in (-1,1):
        knots=((.18,.78),(.62,.78),(.62,.90),(.28,.90),(.28,.82),(.53,.82),(.53,.87),(.38,.87))
        coords=[tuple(surface_point(model.ALPHA*side*f,u,sign,.00055)) for f,u in knots]
        line('鼓部自主回折纹',coords,.0005)



source_collection=bpy.data.collections.new('可编辑器物源构件')
scene.collection.children.link(source_collection)
for obj in parts:
    for collection in list(obj.users_collection):collection.objects.unlink(obj)
    source_collection.objects.link(obj)

export_collection=bpy.data.collections.new('网页导出与烘焙')
scene.collection.children.link(export_collection)
bpy.ops.object.select_all(action='DESELECT')
copies=[]
for obj in parts:
    duplicate=obj.copy();duplicate.data=obj.data.copy();export_collection.objects.link(duplicate)
    duplicate.select_set(True);bpy.context.view_layer.objects.active=duplicate
    if duplicate.type=='CURVE':bpy.ops.object.convert(target='MESH');duplicate=bpy.context.object
    for modifier in list(duplicate.modifiers):
        bpy.context.view_layer.objects.active=duplicate;bpy.ops.object.modifier_apply(modifier=modifier.name)
    copies.append(duplicate)
bpy.context.view_layer.objects.active=copies[0]
bpy.ops.object.join()
bell=bpy.context.object;bell.name='bell_body'
bell['source']='Original Blender mesh; structural reference: National Museum Zeng Hou Yu yongzhong'
bell['reference']='https://www.chnmuseum.cn/portals/0/web/zt/202409fhgg/#102'
bell['simulation']='Outer contour shared; crown, knobs and ornament excluded from acoustic approximation'
source_collection.hide_render=True;source_collection.hide_viewport=True
bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=1.15,island_margin=.012)
bpy.ops.object.mode_set(mode='OBJECT')
bell.data.materials.clear();bell.data.materials.append(mat)
for poly in bell.data.polygons:poly.material_index=0


def bake_emission(name,socket,size,non_color=False):
    image=bpy.data.images.new(name,width=size,height=size,alpha=False)
    if non_color:image.colorspace_settings.name='Non-Color'
    image.filepath_raw=str(OUT/(name+'.png'));image.file_format='PNG'
    nodes=mat.node_tree.nodes;links=mat.node_tree.links;output=nodes.get('Material Output')
    old=output.inputs['Surface'].links[0].from_socket
    emission=nodes.new('ShaderNodeEmission');links.new(socket,emission.inputs['Color']);links.new(emission.outputs[0],output.inputs['Surface'])
    target=nodes.new('ShaderNodeTexImage');target.image=image;nodes.active=target
    bpy.context.view_layer.objects.active=bell;bell.select_set(True)
    bpy.ops.object.bake(type='EMIT',margin=16,use_clear=True)
    image.save();links.new(old,output.inputs['Surface']);nodes.remove(emission)
    return image,target


base_color,_=bake_emission('bronze_color',color_socket,2048)
roughness,_=bake_emission('bronze_roughness',rough_socket,1024,True)
roughness.colorspace_settings.name='Non-Color'
nodes=mat.node_tree.nodes;normal=bpy.data.images.new('bronze_normal',width=2048,height=2048,alpha=False)
normal.colorspace_settings.name='Non-Color';normal.filepath_raw=str(OUT/'bronze_normal.png');normal.file_format='PNG'
target=nodes.new('ShaderNodeTexImage');target.image=normal;nodes.active=target
bpy.ops.object.bake(type='NORMAL',normal_space='TANGENT',margin=16,use_clear=True)
normal.save()

baked=bpy.data.materials.new('Baked aged bronze');baked.use_nodes=True
n=baked.node_tree.nodes;l=baked.node_tree.links;bsdf=n.get('Principled BSDF');bsdf.inputs['Metallic'].default_value=.62
for image,socket in ((base_color,'Base Color'),(roughness,'Roughness')):
    tex=n.new('ShaderNodeTexImage');tex.image=image;l.new(tex.outputs['Color'],bsdf.inputs[socket])
tex=n.new('ShaderNodeTexImage');tex.image=normal;norm=n.new('ShaderNodeNormalMap');l.new(tex.outputs['Color'],norm.inputs['Color']);l.new(norm.outputs['Normal'],bsdf.inputs['Normal'])
bell.data.materials.clear();bell.data.materials.append(baked)

bpy.ops.object.select_all(action='DESELECT');bell.select_set(True);bpy.context.view_layer.objects.active=bell
bpy.ops.export_scene.gltf(filepath=str(OUT/'workshop-bell.glb'),export_format='GLB',use_selection=True,export_apply=True,export_materials='EXPORT',export_extras=True,export_cameras=False,export_lights=False,export_animations=False)


def area(name,location,power,size,color):
    data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='DISK';data.size=size;data.color=color
    obj=bpy.data.objects.new(name,data);scene.collection.objects.link(obj);obj.location=location
    obj.rotation_euler=(Vector((0,0,.12))-obj.location).to_track_quat('-Z','Y').to_euler()


area('窗侧主光',(-.3,-.4,.5),6.0,.45,(1,.93,.82))
area('右侧柔光',(.3,-.1,.35),2.0,.5,(.8,.9,1))
area('后侧轮廓',(.1,.3,.4),4.0,.35,(1,.95,.85))
bpy.ops.object.camera_add(location=(.30,-.42,.25))
camera=bpy.context.object;camera.name='器物摄影机'
camera.rotation_euler=(Vector((0,0,.12))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.type='ORTHO';camera.data.ortho_scale=.30;scene.camera=camera
scene.render.resolution_x=1200;scene.render.resolution_y=1400
scene.render.film_transparent=True;scene.render.filepath=str(OUT/'bell-study.png')
for image in (base_color,roughness,normal):image.pack()
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'workshop-bell.blend'),compress=True)
bpy.ops.render.render(write_still=True)
bell.data.calc_loop_triangles()
manifest={'tool':bpy.app.version_string,'source':'assets/source/workshop-bell.blend','script':'scripts/build_assets.py',
          'reference':bell['reference'],'vertices':len(bell.data.vertices),'triangles':len(bell.data.loop_triangles),
          'textures':[im.name for im in (base_color,roughness,normal)],
          'sha256':hashlib.sha256((OUT/'workshop-bell.glb').read_bytes()).hexdigest(),
          'files':{p.name:p.stat().st_size for p in OUT.iterdir() if p.is_file() and p.name!='asset-manifest.json'},
          'scope':'original visual reconstruction; ornament and crown not acoustically calibrated'}
(OUT/'asset-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print('ASSET_RESULT '+json.dumps(manifest,ensure_ascii=False),flush=True)
