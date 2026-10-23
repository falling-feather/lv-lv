export type Tone = 0 | 1;
export type Zone = 0 | 1 | 2;
export type Cuts = readonly [number, number, number];
export type Judgement = 'high' | 'low' | 'near';
export interface BellState {
  index:number; id:string; cuts:[number,number,number];
  frequencies:[number,number]; partials:number[]; weights:[number[],number[]];
  modeIndices:[number,number]; massKg:number; minWallMm:number; mac:number[];
}
export interface AtlasData {
  schema:2; nt:number; nz:number; maxCuts:number; stepMm:number; zoneNames:string[];
  outer:number[]; initialInner:number[]; cutOffsets:[number[],number[],number[]];
  strikePoints:number[][]; modesFile:string; modeStride:number; defaultTarget:Cuts;
  states:BellState[];
  model:{dimensions:{halfWidth:number;halfDepth:number;height:number;mouthRise:number}; [key:string]:unknown};
}
export interface Atlas extends AtlasData { modeFields:Int16Array }
export function hydrateAtlas(data:AtlasData,bytes:ArrayBuffer):Atlas {
  if(data.schema!==2||data.states.length!==(data.maxCuts+1)**3||
     bytes.byteLength!==data.states.length*2*data.modeStride*2) throw new Error('钟体数据版本或振形长度不完整');
  return {...data,modeFields:new Int16Array(bytes)};
}
export async function loadAtlas(base:string):Promise<Atlas> {
  const response=await fetch(`${base}data/bell-atlas.json`);
  if(!response.ok) throw new Error(`钟体数据加载失败（${response.status}）`);
  const data=await response.json() as AtlasData;
  if(!/^[a-zA-Z0-9._-]+$/.test(data.modesFile))throw new Error('振形文件名无效');
  const modes=await fetch(`${base}data/${data.modesFile}`);
  if(!modes.ok)throw new Error(`振形加载失败（${modes.status}）`);
  return hydrateAtlas(data,await modes.arrayBuffer());
}
export const cents=(current:number,target:number)=>1200*Math.log2(current/target);
export const judgement=(error:number,tolerance:number):Judgement=>Math.abs(error)<=tolerance?'near':error>0?'high':'low';
export interface BellSpec {
  initial:Cuts; target:Cuts; scale:number; tolerance:readonly [number,number];
  measureLimit:number|null; unitBudget:number|null; massBudgetGrams:number|null;
  coarse:boolean; reveal:'always'|'measured'|'ear'; prediction:boolean;
}
export class BellModel {
  readonly atlas:Atlas; readonly spec:BellSpec; readonly target:BellState;
  private readonly states:Map<string,BellState>;
  private readonly routes=new Map<string,Zone[]|null>();
  constructor(atlas:Atlas,spec:BellSpec) {
    this.atlas=atlas;this.spec=spec;
    if(!(spec.scale>0)||!Number.isFinite(spec.scale)||spec.tolerance.length!==2||spec.tolerance.some(n=>!Number.isFinite(n)||n<=0))throw new Error('钟体比例或目标精度无效');
    if([spec.measureLimit,spec.unitBudget].some(n=>n!==null&&(!Number.isInteger(n)||n<0))||
      (spec.massBudgetGrams!==null&&(!Number.isFinite(spec.massBudgetGrams)||spec.massBudgetGrams<0)))throw new Error('测量或材料预算无效');
    this.states=new Map(atlas.states.map(s=>[s.id,s]));
    if(this.states.size!==atlas.states.length)throw new Error('钟体状态重复');
    for(const s of atlas.states) {
      if(s.id!==s.cuts.join(':')||s.frequencies.some(f=>!Number.isFinite(f)||f<=0)||s.minWallMm<=2)throw new Error('钟体数值无效');
    }
    this.state(spec.initial);this.target=this.state(spec.target);
  }
  state(cuts:Cuts):BellState {
    const s=this.states.get(cuts.join(':'));if(!s)throw new RangeError(`不存在的加工状态 ${cuts.join(':')}`);return s;
  }
  voice(cuts:Cuts):BellState {
    const s=this.state(cuts),scale=this.spec.scale;
    return {...s,id:`${s.id}@${scale.toFixed(6)}`,frequencies:[s.frequencies[0]/scale,s.frequencies[1]/scale],
      partials:s.partials.map(f=>f/scale),massKg:s.massKg*scale**3,minWallMm:s.minWallMm*scale};
  }
  errors(cuts:Cuts):[number,number] {
    const f=this.state(cuts).frequencies,t=this.target.frequencies;return [cents(f[0],t[0]),cents(f[1],t[1])];
  }
  isTuned(cuts:Cuts):boolean {return this.errors(cuts).every((e,i)=>Math.abs(e)<=this.spec.tolerance[i]);}
  usedUnits(cuts:Cuts):number{return cuts.reduce((sum,n,i)=>sum+n-this.spec.initial[i],0);}
  removedGrams(cuts:Cuts):number{return (this.state(this.spec.initial).massKg-this.state(cuts).massKg)*this.spec.scale**3*1000;}
  stock(cuts:Cuts):{zones:[number,number,number];remaining:number;limit:number;used:number} {
    const used=this.usedUnits(cuts),limit=this.spec.unitBudget??this.spec.initial.reduce((sum,n)=>sum+this.atlas.maxCuts-n,0);
    return {zones:cuts.map(n=>this.atlas.maxCuts-n) as [number,number,number],remaining:limit-used,limit,used};
  }
  permitted(cuts:Cuts):boolean {
    return cuts.every((n,i)=>n>=this.spec.initial[i]&&n<=this.atlas.maxCuts)&&
      (this.spec.unitBudget===null||this.usedUnits(cuts)<=this.spec.unitBudget)&&
      (this.spec.massBudgetGrams===null||this.removedGrams(cuts)<=this.spec.massBudgetGrams+1e-5);
  }
  private findRoute(cuts:Cuts):Zone[]|null {
    const id=cuts.join(':');if(this.routes.has(id))return this.routes.get(id)!;
    if(!this.permitted(cuts)){this.routes.set(id,null);return null;}
    if(this.isTuned(cuts)){this.routes.set(id,[]);return [];}
    const candidates:Zone[][]=[];
    for(const zone of [0,1,2] as const) {
      if(cuts[zone]>=this.atlas.maxCuts)continue;
      const next:[number,number,number]=[...cuts];next[zone]++;
      const route=this.findRoute(next);if(route!==null)candidates.push([zone,...route]);
    }
    candidates.sort((a,b)=>a.length-b.length);
    const result=candidates[0]??null;this.routes.set(id,result);return result;
  }
  canReach(cuts:Cuts):boolean{return this.findRoute(cuts)!==null;}
  route(cuts:Cuts):Zone[]{const r=this.findRoute(cuts);if(r===null)throw new RangeError('在本单允许的范围内已无法修正');return [...r];}
  inner(cuts:Cuts):Float32Array {
    const out=new Float32Array(this.atlas.initialInner);
    for(const zone of [0,1,2] as const)for(let i=0;i<out.length;i++)out[i]+=this.atlas.cutOffsets[zone][i]*cuts[zone];
    return out;
  }
  mode(cuts:Cuts,tone:Tone):Float32Array {
    const start=(this.state(cuts).index*2+tone)*this.atlas.modeStride;
    return Float32Array.from(this.atlas.modeFields.subarray(start,start+this.atlas.modeStride),n=>n/32767);
  }
}
export interface ProcessRecord {cuts:Cuts;zone:Zone|null;amount:0|1|2;at:number}
export interface Session {
  phase:'listen'|'tune'|'complete'|'spoiled';cuts:Cuts;heard:readonly [boolean,boolean];
  history:readonly ProcessRecord[];measuredAt:Cuts|null;measurements:number;
  predictions:readonly [Judgement|null,Judgement|null];diagnosed:boolean;
  assisted:boolean;mistakes:number;message:string;startedAt:number;
}
export type GameEvent={type:'strike';tone:Tone}|{type:'cut';zone:Zone;amount:1|2;at:number}|
  {type:'measure'}|{type:'predict';tone:Tone;answer:Judgement}|{type:'assist'}|{type:'verify'};
export type RemovalPlan={ok:false;message:string}|{ok:true;cuts:Cuts;deltaCents:[number,number];grams:number;withinBudget:boolean};
export function planRemoval(s:Session,zone:Zone,amount:1|2,model:BellModel):RemovalPlan {
  if(s.phase!=='tune')return {ok:false,message:'先听过初态的两个音位，再规划磨修。'};
  if(!s.diagnosed)return {ok:false,message:'先作出两音的听辨判断，再开始加工。'};
  if(![0,1,2].includes(zone)||![1,2].includes(amount))return {ok:false,message:'磨修区域或加工量无效。'};
  if(amount===2&&!model.spec.coarse)return {ok:false,message:'本单使用精修工具。'};
  if(s.cuts[zone]+amount>model.atlas.maxCuts)return {ok:false,message:'该区已接近保留边界，请改用精修或另一区域。'};
  const cuts:[number,number,number]=[...s.cuts];cuts[zone]+=amount;
  const before=model.state(s.cuts),after=model.state(cuts);
  return {ok:true,cuts,deltaCents:[cents(after.frequencies[0],before.frequencies[0]),cents(after.frequencies[1],before.frequencies[1])],
    grams:model.removedGrams(cuts)-model.removedGrams(s.cuts),withinBudget:model.permitted(cuts)};
}
export function createSession(model:BellModel,now:number):Session {
  const cuts:Cuts=[...model.spec.initial];
  return {phase:'listen',cuts,heard:[false,false],history:[{cuts,zone:null,amount:0,at:now}],
    measuredAt:model.spec.reveal==='always'?cuts:null,measurements:0,predictions:[null,null],
    diagnosed:!model.spec.prediction,assisted:false,mistakes:0,message:'分别敲击正鼓和侧鼓，再开始磨修。',startedAt:now};
}
export function transition(s:Session,e:GameEvent,model:BellModel):Session {
  if(s.phase==='complete'||s.phase==='spoiled')return s;
  if(e.type==='strike') {
    const heard:[boolean,boolean]=[...s.heard];heard[e.tone]=true;
    return {...s,heard,phase:heard.every(Boolean)?'tune':s.phase,message:heard.every(Boolean)?'先判断两音与参照的关系，再选择磨修区域。':s.message};
  }
  if(e.type==='assist')return {...s,assisted:true,measuredAt:s.cuts,diagnosed:true,message:'已借助读数，本轮会保留辅助标记。'};
  if(e.type==='measure') {
    if(model.spec.reveal==='ear'&&!s.assisted)return {...s,message:'本单先凭听辨判断。需要时可借助读数，记录会标明辅助。'};
    if(s.measuredAt?.join(':')===s.cuts.join(':'))return {...s,message:'当前状态已经测量。'};
    if(model.spec.measureLimit!==null&&s.measurements>=model.spec.measureLimit)return {...s,message:'本单测量次数已用完，可继续对照试听或借助读数。'};
    return {...s,measuredAt:s.cuts,measurements:s.measurements+1,message:'已记录当前两音。加工后此读数将成为上次测量。'};
  }
  if(e.type==='predict') {
    if(!s.heard[e.tone])return {...s,message:'先敲击这个音位，再作判断。'};
    const expected=judgement(model.errors(s.cuts)[e.tone],model.spec.tolerance[e.tone]);
    if(e.answer!==expected)return {...s,mistakes:s.mistakes+1,message:'这次判断未吻合。请在同一音位重听当前与参照，留意拍动。'};
    const predictions:[Judgement|null,Judgement|null]=[...s.predictions];predictions[e.tone]=e.answer;
    return {...s,predictions,diagnosed:predictions.every(p=>p!==null),message:'判断正确，两音需要共同考虑。'};
  }
  if(e.type==='verify') {
    if(!s.heard.every(Boolean))return {...s,message:'请重新敲击当前钟体的正鼓和侧鼓，再验律。'};
    if(!model.isTuned(s.cuts))return {...s,message:'两音还没有同时进入目标范围。一次加工也可能牵动已经接近的另一音。'};
    return {...s,phase:'complete',message:'两音已合律。本次工序将记入档案。'};
  }
  const plan=planRemoval(s,e.zone,e.amount,model);if(!plan.ok)return {...s,message:plan.message};
  const cuts=plan.cuts;
  const phase=model.canReach(cuts)?'tune':'spoiled';
  return {...s,cuts,phase,heard:[false,false],history:[...s.history,{cuts,zone:e.zone,amount:e.amount,at:e.at}],
    measuredAt:model.spec.reveal==='always'||s.assisted?cuts:s.measuredAt,
    message:phase==='spoiled'?'本单预算与加工范围内已无法同时合律，请查看工序后换坯重来。':
      `本步：正鼓 ${plan.deltaCents[0].toFixed(1)} / 侧鼓 ${plan.deltaCents[1].toFixed(1)} 音分。`};
}
export function restoreSession(raw:unknown,model:BellModel):Session {
  if(!raw||typeof raw!=='object')throw new Error('存档缺少工序状态');
  const s=raw as Session;
  if(!Array.isArray(s.cuts)||s.cuts.length!==3||!Array.isArray(s.history)||!s.history.length||
     !['listen','tune','complete','spoiled'].includes(s.phase)||!Array.isArray(s.heard)||s.heard.length!==2)throw new Error('存档的工序结构无效');
  let previous:Cuts=model.spec.initial;
  for(let i=0;i<s.history.length;i++) {
    const r:ProcessRecord=s.history[i];model.state(r.cuts);
    if(r.cuts.some((n,z)=>!Number.isInteger(n)||n<previous[z]))throw new Error('存档包含反向加料');
    if(i===0&&(r.zone!==null||r.amount!==0))throw new Error('存档初始工序无效');
    if(i>0&&(![0,1,2].includes(r.zone as number)||![1,2].includes(r.amount)||
      r.cuts.some((n,z)=>n-previous[z]!==((z===r.zone)?r.amount:0))))throw new Error('存档加工区域或加工量不一致');
    previous=r.cuts;
  }
  if(previous.join(':')!==s.cuts.join(':')||s.history[0].cuts.join(':')!==model.spec.initial.join(':'))throw new Error('存档工序与当前钟体不一致');
  if(s.phase==='complete'&&!model.isTuned(s.cuts))throw new Error('存档验律结果无效');
  if(s.measuredAt)model.state(s.measuredAt);
  if(!Number.isInteger(s.measurements)||s.measurements<0)throw new Error('存档测量计数无效');
  if(s.heard.some(v=>typeof v!=='boolean')||!Array.isArray(s.predictions)||s.predictions.length!==2||
     s.predictions.some(v=>v!==null&&!['high','low','near'].includes(v))||!Number.isFinite(s.startedAt))throw new Error('存档听辨记录无效');
  if(s.history.length===1&&s.phase==='tune'&&!s.heard.every(Boolean))throw new Error('存档尚未完成初态辨声');
  if(s.phase==='complete'&&(!s.heard.every(Boolean)||!model.permitted(s.cuts)))throw new Error('存档完成状态无效');
  return s;
}
