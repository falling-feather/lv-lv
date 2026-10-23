import { UNITS, type Job } from './content.ts';
import { BellModel,restoreSession,type Atlas,type BellSpec,type Cuts,type Session } from './game.ts';
import { normalizeComposition, type Composition } from './performance.ts';

export interface UnitResult {score:number;assisted:boolean;completedAt:number;seconds:number}
export interface FinishedBell {id:string;unitId:string;name:string;note:number;spec:BellSpec;cuts:Cuts;session:Session;completedAt:number}
export interface ProgressData {
  schema:1;modelRevision:string;completed:Record<string,UnitResult>;active:Record<string,unknown>;
  bells:FinishedBell[];compositions:Composition[];lastUnit:string|null;activeSeconds:number;
}
export interface StorageDriver {getItem(key:string):string|null;setItem(key:string,value:string):void}
export const STORAGE_KEY='lulu.workshop.progress';
const empty=(revision:string):ProgressData=>({schema:1,modelRevision:revision,completed:{},active:{},bells:[],compositions:[],lastUnit:null,activeSeconds:0});
export function parseProgress(text:string,revision:string,atlas?:Atlas):ProgressData {
  const p=JSON.parse(text) as ProgressData;
  if(p.schema!==1||!p.completed||typeof p.completed!=='object'||Array.isArray(p.completed)||!p.active||typeof p.active!=='object'||Array.isArray(p.active)||!Array.isArray(p.bells)||!Array.isArray(p.compositions)||
    !Number.isFinite(p.activeSeconds)||p.activeSeconds<0)throw new Error('存档结构不完整');
  for(const [id,result] of Object.entries(p.completed)) {
    if(!UNITS.some(u=>u.id===id)||!Number.isFinite(result.score)||result.score<0||result.score>100||typeof result.assisted!=='boolean'||
      !Number.isFinite(result.completedAt)||!Number.isFinite(result.seconds)||result.seconds<0)throw new Error('存档含有未知委托或无效结果');
  }
  for(const bell of p.bells){
    if(typeof bell.id!=='string'||typeof bell.name!=='string'||!UNITS.some(u=>u.id===bell.unitId)||!bell.spec||
      !Array.isArray(bell.cuts)||bell.cuts.length!==3||!Number.isFinite(bell.note)||!bell.session||bell.session.phase!=='complete')throw new Error('存档器物记录无效');
    if(bell.cuts.join(':')!==bell.session.cuts.join(':'))throw new Error('器物快照与工序终点不一致');
    if(atlas)restoreSession(bell.session,new BellModel(atlas,bell.spec));
  }
  p.compositions=p.compositions.map(normalizeComposition);
  if(p.modelRevision!==revision)throw new Error('模型数据已经变化，请保留旧档案后重新开始这版工坊');
  return p;
}
export class WorkshopProgress {
  data:ProgressData;
  error='';
  private writable=true;
  private readonly storage:StorageDriver;
  private readonly revision:string;
  private readonly atlas?:Atlas;
  constructor(storage:StorageDriver,revision:string,atlas?:Atlas) {
    this.storage=storage;this.revision=revision;this.atlas=atlas;this.data=empty(revision);
    try {const raw=storage.getItem(STORAGE_KEY);if(raw)this.data=parseProgress(raw,revision,atlas);}
    catch(error){this.writable=false;this.error=`无法读取本机存档：${error instanceof Error?error.message:String(error)}。当前使用临时进度，原记录未覆盖。`;}
  }
  save():boolean {
    if(!this.writable)return false;
    try {this.storage.setItem(STORAGE_KEY,JSON.stringify(this.data));this.error='';return true;}
    catch(error){this.error=`本机保存失败：${error instanceof Error?error.message:String(error)}。请导出当前档案。`;return false;}
  }
  setActive(id:string,activity:unknown):void{this.data.active[id]=activity;if(UNITS.some(u=>u.id===id))this.data.lastUnit=id;this.save();}
  active<T>(id:string):T|undefined{return this.data.active[id] as T|undefined;}
  complete(id:string,result:UnitResult):void {
    const old=this.data.completed[id];
    this.data.completed[id]=old&&old.score>result.score?old:result;
    delete this.data.active[id];this.save();
  }
  finishBell(unitId:string,job:Job,spec:BellSpec,session:Session):void {
    if(session.phase!=='complete')throw new Error('未验律的钟不能收入完成记录');
    const id=`${unitId}:${job.id}:${Date.now()}`;
    this.data.bells.push({id,unitId,name:job.name,note:job.note,spec,cuts:session.cuts,session,completedAt:Date.now()});
    this.save();
  }
  saveComposition(composition:Composition):void {
    const normalized=normalizeComposition(composition),at=this.data.compositions.findIndex(c=>c.id===normalized.id);
    if(at<0)this.data.compositions.push(normalized);else this.data.compositions[at]=normalized;
    this.save();
  }
  addSeconds(seconds:number):void {if(seconds>0&&seconds<61){this.data.activeSeconds+=seconds;this.save();}}
  export():string{return JSON.stringify(this.data,null,2);}
  exportOriginal():string{return this.storage.getItem(STORAGE_KEY)??this.export();}
  import(text:string):void {
    const imported=parseProgress(text,this.revision,this.atlas);
    const completed={...this.data.completed};
    for(const [id,result] of Object.entries(imported.completed))if(!completed[id]||completed[id].score<result.score)completed[id]=result;
    const bells=new Map([...this.data.bells,...imported.bells].map(b=>[b.id,b]));
    const compositions=new Map([...this.data.compositions,...imported.compositions].map(c=>[c.id,c]));
    this.data={...imported,active:{...this.data.active,...imported.active},completed,bells:[...bells.values()],compositions:[...compositions.values()],activeSeconds:Math.max(imported.activeSeconds,this.data.activeSeconds)};
    this.writable=true;this.save();
  }
}
