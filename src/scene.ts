import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { BellModel,type Cuts,type Tone,type Zone } from './game.ts';
import type { BellKey } from './content.ts';

let asset:Promise<THREE.Group>|undefined;
const getAsset=()=>asset??=new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/workshop-bell.glb`).then(g=>g.scene);
const point=(x:number,y:number,z:number,height:number)=>new THREE.Vector3(x,height-z,y);
const positions=(values:ArrayLike<number>,height:number)=>{
  const out=new Float32Array(values.length);
  for(let i=0;i<values.length;i+=3)out.set([values[i],height-values[i+2],values[i+1]],i);
  return out;
};
export interface SceneBell {model:BellModel;cuts:Cuts}
export class WorkshopScene {
  readonly ready:Promise<void>;
  private readonly renderer:THREE.WebGLRenderer;
  private readonly scene=new THREE.Scene();
  private readonly camera=new THREE.PerspectiveCamera(31,1,.01,30);
  private readonly controls:OrbitControls;
  private readonly roots:THREE.Group[]=[];
  private readonly ownedGeometry:THREE.BufferGeometry[]=[];
  private readonly materials:THREE.Material[]=[];
  private readonly markers:HTMLButtonElement[]=[];
  private readonly clip=new THREE.Plane(new THREE.Vector3(0,0,-1),0);
  private readonly observer:ResizeObserver;
  private readonly ray=new THREE.Raycaster();
  private inner:THREE.Mesh|null=null;
  private dots:THREE.Points|null=null;
  private modeBase:Float32Array|null=null;
  private modeField:Float32Array|null=null;
  private zoneWeights:Float32Array|null=null;
  private section=false;
  private showMode=false;
  private grinding=false;
  private zone:Zone=0;
  private struckAt=-100;
  private disposed=false;
  private drag:{x:number;y:number;distance:number;done:boolean}|null=null;
  private grindAt=-100;
  private readonly tool=new THREE.Group();
  private readonly dust:THREE.Points;
  private readonly environment:THREE.WebGLRenderTarget;
  private readonly reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  constructor(private host:HTMLElement,private bells:SceneBell[],private onStrike:(key:BellKey)=>void,
              private onGrind?:(zone:Zone)=>void,private onError?:(message:string)=>void) {
    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.8));this.renderer.setClearColor(0x000000,0);
    this.renderer.localClippingEnabled=true;this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.0;
    this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFShadowMap;
    this.renderer.domElement.setAttribute('aria-label',bells.length===1?'可旋转、剖开和磨修的甬钟模型':'可敲击的五钟组');
    host.prepend(this.renderer.domElement);
    const pmrem=new THREE.PMREMGenerator(this.renderer),room=new RoomEnvironment();
    this.environment=pmrem.fromScene(room,.04);this.scene.environment=this.environment.texture;this.scene.environmentIntensity=.7;room.dispose();pmrem.dispose();
    this.scene.add(new THREE.HemisphereLight(0xfff4db,0x4c463c,1.0));
    const light=new THREE.DirectionalLight(0xffead0,2.8);light.position.set(-2,4,3);light.castShadow=true;
    light.shadow.mapSize.set(1024,1024);light.shadow.camera.left=-2;light.shadow.camera.right=2;light.shadow.camera.top=2;light.shadow.camera.bottom=-2;light.shadow.bias=-.0002;this.scene.add(light);
    const fill=new THREE.DirectionalLight(0xdce6ed,1.35);fill.position.set(2,1,-2);this.scene.add(fill);
    const floorG=this.own(new THREE.PlaneGeometry(12,12)),floorM=this.material(new THREE.ShadowMaterial({color:0x40382f,opacity:.19}));
    const floor=new THREE.Mesh(floorG,floorM);floor.rotation.x=-Math.PI/2;floor.position.y=-.003;floor.receiveShadow=true;this.scene.add(floor);
    const maxScale=Math.max(...bells.map(b=>b.model.spec.scale));
    bells.forEach((bell,i)=>{
      const root=new THREE.Group();root.scale.setScalar(bell.model.spec.scale);root.position.x=(i-(bells.length-1)/2)*maxScale*.158;
      this.roots.push(root);this.scene.add(root);
      for(const tone of [0,1] as const){const button=document.createElement('button');button.className=`strike-point tone-${tone}`;button.hidden=true;
        button.innerHTML=`<i></i><span>${bells.length===1?(tone===0?'正鼓':'侧鼓'):`${i+1}·${tone===0?'正':'侧'}`}</span>`;
        button.setAttribute('aria-label',`${bells.length===1?'':`第${i+1}口钟`}${tone===0?'正鼓':'侧鼓'}敲击点`);
        button.addEventListener('click',()=>this.onStrike({bell:i,tone}));host.append(button);this.markers.push(button);
      }
    });
    if(bells.length>1){
      const wood=this.material(new THREE.MeshStandardMaterial({color:0x665039,roughness:.85})),iron=this.material(new THREE.MeshStandardMaterial({color:0x514c40,metalness:.7,roughness:.65}));
      const span=maxScale*.158*(bells.length-1)+maxScale*.24,top=maxScale*.29;
      const beam=new THREE.Mesh(this.own(new THREE.BoxGeometry(span,maxScale*.014,maxScale*.019)),wood);beam.position.set(0,top,-.015);beam.castShadow=true;this.scene.add(beam);
      for(const sign of [-1,1]){const post=new THREE.Mesh(this.own(new THREE.BoxGeometry(maxScale*.012,top,maxScale*.018)),wood);post.position.set(sign*(span/2-maxScale*.012),top/2,-.015);post.castShadow=true;this.scene.add(post);
        const foot=new THREE.Mesh(this.own(new THREE.BoxGeometry(maxScale*.035,maxScale*.009,maxScale*.10)),wood);foot.position.set(post.position.x,maxScale*.0045,-.015);foot.castShadow=true;this.scene.add(foot);}
      this.roots.forEach((root,i)=>{const bottom=bells[i].model.spec.scale*.237,h=top-bottom;
        const tie=new THREE.Mesh(this.own(new THREE.CylinderGeometry(maxScale*.0015,maxScale*.0015,h,8)),iron);tie.position.set(root.position.x,bottom+h/2,-.015);this.scene.add(tie);});
    }
    this.camera.position.set(bells.length===1?.28*maxScale:.08,maxScale*.24,bells.length===1?.48*maxScale:maxScale*.158*bells.length*2.1);
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=true;this.controls.enablePan=false;
    this.controls.target.set(0,maxScale*.112,0);this.controls.minDistance=.25*maxScale;this.controls.maxDistance=2.2*maxScale;
    this.controls.minPolarAngle=.15;this.controls.maxPolarAngle=Math.PI*.89;
    const handle=new THREE.Mesh(this.own(new THREE.CylinderGeometry(.0014,.002,.032,8)),this.material(new THREE.MeshStandardMaterial({color:0x6b482c,roughness:.85})));
    const stone=new THREE.Mesh(this.own(new THREE.BoxGeometry(.008,.015,.004)),this.material(new THREE.MeshStandardMaterial({color:0x73716a,roughness:1})));
    handle.position.y=.02;this.tool.add(handle,stone);this.tool.visible=false;this.tool.scale.setScalar(maxScale);this.scene.add(this.tool);
    const dustG=this.own(new THREE.BufferGeometry());dustG.setAttribute('position',new THREE.BufferAttribute(new Float32Array(90),3));
    this.dust=new THREE.Points(dustG,this.material(new THREE.PointsMaterial({color:0xb08a54,size:.003*maxScale,transparent:true,opacity:0,depthWrite:false})));this.scene.add(this.dust);
    this.ready=getAsset().then(source=>{
      if(this.disposed)return;
      this.roots.forEach(root=>{const copy=source.clone(true);copy.traverse(child=>{if(child instanceof THREE.Mesh){
        const originals=Array.isArray(child.material)?child.material:[child.material];
        const clones=originals.map(m=>{const c=m.clone();c.clippingPlanes=this.section?[this.clip]:[];this.materials.push(c);return c;});
        child.material=Array.isArray(child.material)?clones:clones[0];child.castShadow=true;child.receiveShadow=true;
      }});root.add(copy);});
      if(bells.length===1)this.buildInterior();
    }).catch(error=>{if(!this.disposed)this.onError?.(`器物模型加载失败：${String(error)}`);});
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(host);this.resize();
    this.renderer.domElement.addEventListener('pointerdown',this.pointerDown);
    this.renderer.domElement.addEventListener('pointermove',this.pointerMove);
    this.renderer.domElement.addEventListener('pointerup',this.pointerUp);
    this.renderer.domElement.addEventListener('pointercancel',this.pointerUp);
    this.renderer.setAnimationLoop(()=>this.frame());
  }
  private own<T extends THREE.BufferGeometry>(g:T):T{this.ownedGeometry.push(g);return g;}
  private material<T extends THREE.Material>(m:T):T{this.materials.push(m);return m;}
  private buildInterior():void {
    const {model,cuts}=this.bells[0],{nt,nz}=model.atlas,height=model.atlas.model.dimensions.height;
    const g=this.own(new THREE.BufferGeometry());g.setAttribute('position',new THREE.BufferAttribute(positions(model.inner(cuts),height),3));
    const ids:number[]=[];for(let z=0;z<nz;z++)for(let t=0;t<nt;t++){const a=z*nt+t,b=z*nt+(t+1)%nt,c=(z+1)*nt+t,d=(z+1)*nt+(t+1)%nt;ids.push(a,b,c,b,d,c);}
    g.setIndex(ids);g.computeVertexNormals();
    this.inner=new THREE.Mesh(g,this.material(new THREE.MeshStandardMaterial({color:0xffffff,metalness:.62,roughness:.7,side:THREE.DoubleSide,vertexColors:true,clippingPlanes:this.section?[this.clip]:[]})));
    this.inner.visible=this.section;this.roots[0].add(this.inner);
    this.dots=new THREE.Points(this.own(new THREE.BufferGeometry()),this.material(new THREE.PointsMaterial({color:0xb84c35,size:.0015,transparent:true,opacity:.8,depthTest:false})));
    this.dots.visible=this.showMode;this.roots[0].add(this.dots);this.setState(cuts,this.zone);
  }
  setState(cuts:Cuts,zone:Zone=this.zone):void {
    this.bells[0].cuts=cuts;this.zone=zone;if(!this.inner)return;
    const model=this.bells[0].model,height=model.atlas.model.dimensions.height;
    const currentInner=model.inner(cuts);this.modeBase=positions(currentInner,height);
    this.inner.geometry.setAttribute('position',new THREE.BufferAttribute(this.modeBase.slice(),3));this.inner.geometry.computeVertexNormals();
    const delta=model.atlas.cutOffsets[zone],weights=new Float32Array(delta.length/3);let max=0;
    for(let i=0;i<weights.length;i++){weights[i]=Math.hypot(delta[i*3],delta[i*3+1]);max=Math.max(max,weights[i]);}
    const colors=new Float32Array(delta.length),base=new THREE.Color(0x76634b),worked=new THREE.Color(0xa77d43),selected=new THREE.Color(0xd9a861);
    for(let i=0;i<weights.length;i++){weights[i]/=max||1;const removed=Math.hypot(currentInner[i*3]-model.atlas.initialInner[i*3],currentInner[i*3+1]-model.atlas.initialInner[i*3+1]);const wear=Math.min(1,removed/(model.atlas.stepMm/1000*3));const grain=1+.035*Math.sin(i*17.13);const c=base.clone().lerp(worked,wear*.7).lerp(selected,weights[i]*.35).multiplyScalar(grain);colors.set([c.r,c.g,c.b],i*3);}
    this.zoneWeights=weights;this.inner.geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
    this.dots?.geometry.setAttribute('position',new THREE.BufferAttribute(this.modeBase.slice(),3));
    this.modeField=null;
  }
  setSection(value:boolean):void{this.section=value;for(const root of this.roots)root.traverse(c=>{if(c instanceof THREE.Mesh){for(const m of Array.isArray(c.material)?c.material:[c.material]){m.clippingPlanes=value?[this.clip]:[];m.needsUpdate=true;}}});if(this.inner)this.inner.visible=value;}
  setMode(value:boolean):void{this.showMode=value;if(this.dots)this.dots.visible=value;}
  setGrinding(value:boolean):void{this.grinding=value;this.setSection(value||this.section);this.controls.enabled=!value;this.host.classList.toggle('is-grinding',value);}
  focusPart(index:number):void {
    const s=this.bells[0].model.spec.scale;
    const views=[[.25,.23,.40],[.20,.35,.28],[.25,.15,.38],[0,.14,.44],[.16,.10,.42],[.17,-.10,.32]];
    const p=views[index]??views[0];this.camera.position.set(p[0]*s,p[1]*s,p[2]*s);this.controls.target.set(0,.115*s,0);this.controls.update();
  }
  flash(key:BellKey):void{this.struckAt=performance.now()/1000;const marker=this.markers[key.bell*2+key.tone];marker?.classList.add('struck');setTimeout(()=>marker?.classList.remove('struck'),180);if(key.bell===0&&this.dots){const f=this.bells[0].model.mode(this.bells[0].cuts,key.tone),out=new Float32Array(f.length);for(let i=0;i<f.length;i+=3)out.set([f[i],-f[i+2],f[i+1]],i);this.modeField=out;}}
  private hit(event:PointerEvent):THREE.Intersection|null {
    if(!this.inner||!this.zoneWeights)return null;const r=this.renderer.domElement.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2((event.clientX-r.left)/r.width*2-1,-(event.clientY-r.top)/r.height*2+1),this.camera);
    const hit=this.ray.intersectObject(this.inner).find(h=>h.face&&(!this.section||this.clip.distanceToPoint(h.point)>=0)&&Math.max(this.zoneWeights![h.face.a],this.zoneWeights![h.face.b],this.zoneWeights![h.face.c])>.22);
    return hit??null;
  }
  private pointerDown=(event:PointerEvent)=>{if(!this.grinding||!this.hit(event))return;event.preventDefault();this.drag={x:event.clientX,y:event.clientY,distance:0,done:false};this.renderer.domElement.setPointerCapture(event.pointerId);};
  private pointerMove=(event:PointerEvent)=>{
    if(!this.grinding)return;const hit=this.hit(event);this.tool.visible=!!hit;if(hit){this.tool.position.copy(hit.point);this.tool.rotation.z=Math.sin(event.clientX*.1)*.15;}
    if(!this.drag||this.drag.done||!hit)return;
    this.drag.distance+=Math.hypot(event.clientX-this.drag.x,event.clientY-this.drag.y);this.drag.x=event.clientX;this.drag.y=event.clientY;
    if(this.drag.distance>80){this.drag.done=true;this.grindAt=performance.now()/1000;const p=this.dust.geometry.getAttribute('position');
      for(let i=0;i<p.count;i++)p.setXYZ(i,hit.point.x,hit.point.y,hit.point.z);p.needsUpdate=true;this.onGrind?.(this.zone);}
  };
  private pointerUp=()=>{this.drag=null;this.tool.visible=false;};
  private resize():void{const width=this.host.clientWidth,height=this.host.clientHeight;if(!width||!height)return;this.renderer.setSize(width,height);this.camera.aspect=width/height;
    if(this.bells.length>1){const scale=Math.max(...this.bells.map(b=>b.model.spec.scale));this.camera.position.set(.08,scale*.24,Math.max(.72,1.7/this.camera.aspect)*scale);this.controls.target.set(0,scale*.14,0);}
    this.camera.updateProjectionMatrix();}
  private frame():void {
    if(this.disposed)return;this.controls.update();const now=performance.now()/1000;
    if(this.dots&&this.modeBase&&this.modeField){const p=this.dots.geometry.getAttribute('position'),a=this.reduced?0:Math.sin((now-this.struckAt)*12)*Math.exp(-Math.max(0,now-this.struckAt)/2)*.003;
      for(let i=0;i<p.count;i++)p.setXYZ(i,this.modeBase[i*3]+this.modeField[i*3]*a,this.modeBase[i*3+1]+this.modeField[i*3+1]*a,this.modeBase[i*3+2]+this.modeField[i*3+2]*a);p.needsUpdate=true;}
    const age=now-this.grindAt;(this.dust.material as THREE.PointsMaterial).opacity=Math.max(0,.7-age);
    if(age<.7){const p=this.dust.geometry.getAttribute('position');for(let i=0;i<p.count;i++){p.setX(i,p.getX(i)+Math.sin(i*17)*.0002);p.setY(i,p.getY(i)-.0003);p.setZ(i,p.getZ(i)+Math.cos(i*11)*.0002);}p.needsUpdate=true;}
    this.renderer.render(this.scene,this.camera);
    this.roots.forEach((root,i)=>{const model=this.bells[i].model;for(const tone of [0,1] as const){const v=model.atlas.strikePoints[tone],p=point(v[0],v[1],v[2],model.atlas.model.dimensions.height);root.localToWorld(p);p.project(this.camera);
      const marker=this.markers[i*2+tone];marker.style.left=`${(p.x*.5+.5)*this.host.clientWidth}px`;marker.style.top=`${(-p.y*.5+.5)*this.host.clientHeight}px`;marker.hidden=this.grinding||p.z>1||Math.abs(p.x)>1||Math.abs(p.y)>1;}});
  }
  dispose():void{this.disposed=true;this.renderer.setAnimationLoop(null);this.observer.disconnect();this.controls.dispose();this.environment.dispose();
    this.renderer.domElement.removeEventListener('pointerdown',this.pointerDown);this.renderer.domElement.removeEventListener('pointermove',this.pointerMove);this.renderer.domElement.removeEventListener('pointerup',this.pointerUp);this.renderer.domElement.removeEventListener('pointercancel',this.pointerUp);
    this.ownedGeometry.forEach(g=>g.dispose());this.materials.forEach(m=>m.dispose());this.renderer.dispose();this.renderer.forceContextLoss();this.renderer.domElement.remove();this.markers.forEach(m=>m.remove());}
}
