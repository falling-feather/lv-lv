import { BellModel,cents, type Atlas, type BellSpec, type BellState, type Cuts, type Tone } from './game.ts';

export type LessonKind='direction'|'near'|'beat'|'position'|'memory';
export interface Job {
  id:string;name:string;brief:string;initial:Cuts;target:Cuts;note:number;
  tolerance:readonly [number,number];measurements:number|null;budget:number|null;
  reveal:'always'|'measured'|'ear';prediction:boolean;coarse:boolean;
}
interface UnitBase {id:string;chapter:number;title:string;purpose:string;minutes:number;takeaway:string}
type UnitActivity=(
  {kind:'inspect'}|{kind:'ear';lesson:LessonKind;rounds:number}|
  {kind:'tune';jobs:Job[]}|{kind:'diagnose';seed:number;rounds:number}|
  {kind:'assemble';arrangement:number}|{kind:'perform';piece:string}
);
export type Unit=UnitBase&UnitActivity;
export const CHAPTERS=[
  {id:1,name:'初识一口钟',summary:'认出器物结构，找到同一钟体的两个敲击位置。'},
  {id:2,name:'先用耳朵判断',summary:'比较高低、接近程度与拍动，建立自己的听辨依据。'},
  {id:3,name:'掌握三处磨修',summary:'试出加工区域的差别，在粗修和精修之间作选择。'},
  {id:4,name:'接手返修委托',summary:'面对已有工序、测量限制和材料预算，决定如何继续。'},
  {id:5,name:'把五口钟编成一组',summary:'调好、排好，再利用一钟双音减少用钟数量。'},
  {id:6,name:'从合律到合乐',summary:'练习节奏和音位切换，用自己调过的钟留下一个短句。'},
] as const;
const noteNames=['宫位 C4','商位 D4','角位 E4','徵位 G4','羽位 A4'];
export const SET_NOTES=[60,62,64,67,69] as const;
export const midiHz=(midi:number)=>440*2**((midi-69)/12);
let jobCounter=0;
function job(name:string,target:Cuts,overrides:Partial<Omit<Job,'id'|'name'|'target'>>={}):Job {
  return {id:`job-${++jobCounter}`,name,brief:'同时协调正鼓与侧鼓，不只追随其中一个读数。',
    initial:[0,0,0],target,note:64,tolerance:[6,6],measurements:null,budget:null,
    reveal:'always',prediction:false,coarse:true,...overrides};
}
function fiveJobs(prefix:string,measured=false):Job[] {
  const targets:Cuts[]=[[3,2,2],[2,4,2],[4,2,3],[2,3,4],[3,4,3]];
  return SET_NOTES.map((note,i)=>job(`${prefix} · ${noteNames[i]}`,targets[i],{
    note,reveal:measured?'measured':'always',measurements:measured?3:null,prediction:measured,
    brief:'完成这口钟后，它会保留实际工序与声音，进入你的五钟组。'}));
}
function unit(id:string,chapter:number,title:string,purpose:string,minutes:number,takeaway:string,
              activity:UnitActivity):Unit {
  return {id,chapter,title,purpose,minutes,takeaway,...activity} as Unit;
}
export const UNITS:Unit[]=[
  unit('1-1',1,'把钟看清楚','观察六个结构部位，转动器物，区分器形与声音的关系。',4,'合瓦截面是认识双音的起点，器物上的每个突起不等于一个音。',{kind:'inspect'}),
  unit('1-2',1,'找到两个敲击位置','听参照，再辨认这次敲的是正鼓还是侧鼓。',4,'换敲击位置，改变的是同一钟体各模态的激发权重。',{kind:'ear',lesson:'position',rounds:6}),
  unit('1-3',1,'判断偏高还是偏低','先比较当前音与参照，不必急着记住数字。',4,'比较前要选定同一个音位，避免把正鼓与侧鼓混为一谈。',{kind:'ear',lesson:'direction',rounds:6}),
  unit('1-4',1,'第一次磨修','从少量去料开始，观察两音一起变化。',4,'去除材料同时改变质量与刚度，变化由模型决定。',{kind:'tune',jobs:[job('初修',[1,1,1],{coarse:false,budget:4})]}),
  unit('1-5',1,'协调而非追赶','在两个音位之间来回核对，保留修正余量。',4,'一音接近目标，另一音也可能继续变化。',{kind:'tune',jobs:[job('留出余量',[2,2,2],{coarse:false})]}),
  unit('1-6',1,'让敲击有节奏','按四拍提示敲击，听见声音之间的间隔。',4,'音高与节奏是两种不同的判断。',{kind:'perform',piece:'pulse'}),
  unit('2-1',2,'小幅偏差也能听见','在较小音分差中判断高低，允许反复试听。',4,'接近时可以换用拍频辅助，不必依靠绝对音感。',{kind:'ear',lesson:'direction',rounds:8}),
  unit('2-2',2,'哪一个更接近','比较两个候选音，找出更接近参照的一项。',4,'接近程度与偏高偏低不是同一个问题。',{kind:'ear',lesson:'near',rounds:8}),
  unit('2-3',2,'听拍动的快慢','比较两组近频叠加，判断哪组离合律更近。',4,'近频差越小，拍动越慢；两音齐奏不自动等于拍频。',{kind:'ear',lesson:'beat',rounds:8}),
  unit('2-4',2,'辨认音位与音色','在不同大小的习钟中认出正鼓和侧鼓。',4,'大小影响音高，敲位仍由同一器物的振形决定。',{kind:'ear',lesson:'position',rounds:8}),
  unit('2-5',2,'听过，再看工序','结合当前声音与先前去料量，判断还能否继续修正。',4,'错误判断可以重听；错误去料则需要承担本单范围内的后果。',{kind:'diagnose',seed:2,rounds:4}),
  unit('2-6',2,'暂时收起读数','先作出两音的判断，再凭参照与拍频修音。',5,'测量用于核对，耳朵也应参与决策。',{kind:'tune',jobs:[job('听辨委托',[3,2,2],{reveal:'ear',prediction:true,coarse:false})]}),
  unit('3-1',3,'鼓部、斜侧与口缘','体验第三个加工区域，对照三种共同响应。',4,'三个区域提供不同修正方向，不能把它们看作独立音高旋钮。',{kind:'tune',jobs:[job('三处响应',[3,2,3])]}),
  unit('3-2',3,'粗修之后要收手','粗修一次去两格，接近目标时换用精修。',5,'粗修提高加工效率，也会更快消耗保留余量。',{kind:'tune',jobs:[job('粗细有别',[4,3,2],{budget:10})]}),
  unit('3-3',3,'给正鼓更窄的范围','对正鼓使用更严格的目标，同时兼顾侧鼓。',5,'同一件器物的两项要求可以不同，但仍需一起满足。',{kind:'tune',jobs:[job('保住正鼓',[3,1,4],{tolerance:[3,8]})]}),
  unit('3-4',3,'换一项严格要求','把注意力转向侧鼓，重新安排工序。',5,'之前有效的次序，不一定适合新的目标约束。',{kind:'tune',jobs:[job('保住侧鼓',[1,4,3],{tolerance:[8,3]})]}),
  unit('3-5',3,'有限的加工余量','在允许的去料总量内完成，不靠无限试磨。',5,'先预测响应，再动手，可以减少无效去料。',{kind:'tune',jobs:[job('余量七格',[2,3,2],{budget:7,coarse:false})]}),
  unit('3-6',3,'只测两次','保存测量记录，之后通过耳朵与加工记录继续判断。',6,'加工后的上次读数不再是当前读数。',{kind:'tune',jobs:[job('两次测量',[3,3,2],{reveal:'measured',measurements:2,prediction:true})]}),
  unit('4-1',4,'这口钟还能修吗','读已有工序，听当前与目标，判断继续或换坯。',5,'本关不可达是有限加工范围的结论，不等于真实器物绝无修复方法。',{kind:'diagnose',seed:7,rounds:6}),
  unit('4-2',4,'从别人留下的工序接手','起点已经去过料，避免沿用全新钟坯的习惯。',5,'接手时先确认当前状态，再决定剩余工序。',{kind:'tune',jobs:[job('接手已修钟',[4,3,3],{initial:[1,1,0],reveal:'measured',measurements:3})]}),
  unit('4-3',4,'预算也会改变可修性','材料范围相同，加工预算不同，结论可能不同。',5,'判断可修性时，目标、边界和预算都要明确。',{kind:'diagnose',seed:13,rounds:6}),
  unit('4-4',4,'处理两口不同状态的钟','一口留有余量，一口需要从中途接手。',6,'每件器物都有自己的工序记录，不能把一个结果复制过去。',{kind:'tune',jobs:[job('前件',[2,4,2],{reveal:'measured',measurements:2}),job('后件',[4,4,2],{initial:[2,1,1],reveal:'measured',measurements:2,prediction:true})]}),
  unit('4-5',4,'完成一份小批委托','连续处理三口大小不同的习钟，分别验律。',7,'相似形体的尺寸缩放，会同时影响两个音。',{kind:'tune',jobs:[job('小钟',[3,2,2],{note:72}),job('中钟',[2,3,3],{note:64}),job('大钟',[3,3,4],{note:55})]}),
  unit('4-6',4,'记住一段音型','先听短句，再从三个候选中认出相同音型。',4,'听辨也包括顺序和停顿。',{kind:'ear',lesson:'memory',rounds:6}),
  unit('5-1',5,'调好第一套五钟','五件分别完成，保留实际达到的状态。',8,'成编的声音来自各自的工序结果。',{kind:'tune',jobs:fiveJobs('第一套五钟')}),
  unit('5-2',5,'给钟架排位','试听候选钟，把正确音位放到参照位置。',4,'位置服务演奏，也是一种音高组织。',{kind:'assemble',arrangement:0}),
  unit('5-3',5,'四个音，最多两口钟','利用一钟双音选择组合，减少用钟数量。',5,'双音的价值在成组使用时更直接。',{kind:'assemble',arrangement:1}),
  unit('5-4',5,'带测量限制再做一套','把听辨与批量调律结合，逐件留下可靠记录。',9,'一组完成的钟，包含多个独立而相关的判断。',{kind:'tune',jobs:fiveJobs('第二套五钟',true)}),
  unit('5-5',5,'混合正鼓与侧鼓排位','同一套钟可以用不同音位组成新的排列。',5,'音位选择也是配器的一部分。',{kind:'assemble',arrangement:2}),
  unit('5-6',5,'双音交替','在同一口钟的两个位置间切换，完成短句。',5,'换音位的动作必须跟上节奏。',{kind:'perform',piece:'alternate'}),
  unit('6-1',6,'把停顿也奏出来','练习弱起和休止，避免每一拍都敲击。',5,'沉默也是乐句的组成部分。',{kind:'perform',piece:'rests'}),
  unit('6-2',6,'用更少的钟配齐音型','在有限钟数内安排一组混合音位。',5,'同样的参照音型，可以寻找不同器物组合。',{kind:'assemble',arrangement:3}),
  unit('6-3',6,'五钟轮转','在不同钟之间移动，保持节奏稳定。',6,'器物、音位和节拍开始同时参与决策。',{kind:'perform',piece:'round'}),
  unit('6-4',6,'最后一份五钟委托','带着已有经验完成整组，并带入后续合乐。',9,'最后听到的钟组保留你的实际验律误差。',{kind:'tune',jobs:fiveJobs('出师钟组',true)}),
  unit('6-5',6,'两个声部的问答','对照先后出现的音型，完成正侧呼应。',6,'两种音位可以形成有组织的问答。',{kind:'perform',piece:'answer'}),
  unit('6-6',6,'五钟终曲','综合节奏、停顿和双音切换，完成原创练习终曲。',7,'继续进入自由创作，把自己的短句留在档案中。',{kind:'perform',piece:'finale'}),
];
export const TOTAL_DESIGN_MINUTES=UNITS.reduce((sum,u)=>sum+u.minutes,0);
export const getUnit=(id:string)=>{const u=UNITS.find(u=>u.id===id);if(!u)throw new Error('找不到这份委托');return u;};
export const WORKSHOP_ROUTE=[
  {unitId:'1-1',label:'认器',decision:'观察敲位与合瓦截面'},
  {unitId:'1-3',label:'听辨',decision:'判断当前与参照的高低'},
  {unitId:'1-4',label:'试调',decision:'协调一口钟的两个目标'},
  {unitId:'5-1',label:'五钟',decision:'分别调好自己的钟组'},
  {unitId:'5-3',label:'成编',decision:'用两口钟承担四个音位'},
  {unitId:'1-6',label:'合乐',decision:'按节拍演奏个人钟组'},
] as const;
export function nextWorkshopUnit(id:string):Unit|undefined {
  const index=WORKSHOP_ROUTE.findIndex(s=>s.unitId===id);return index>=0&&index<WORKSHOP_ROUTE.length-1?getUnit(WORKSHOP_ROUTE[index+1].unitId):undefined;
}
export function recommendedUnit(completed:Readonly<Record<string,unknown>>):Unit|undefined {
  const step=WORKSHOP_ROUTE.find(s=>!completed[s.unitId]);return step?getUnit(step.unitId):UNITS.find(u=>!completed[u.id]);
}
export type IntervalReference='model'|'minor'|'major';
export function intervalPair(voice:BellState,reference:IntervalReference):[number,number] {
  if(reference==='model')return [...voice.frequencies];
  if(reference!=='minor'&&reference!=='major')throw new Error('音程参照不存在');
  return [voice.frequencies[0],voice.frequencies[0]*2**((reference==='minor'?300:400)/1200)];
}
export const intervalSize=(voice:BellState)=>cents(voice.frequencies[1],voice.frequencies[0]);
export function specForJob(atlas:Atlas,job:Job):BellSpec {
  const target=atlas.states.find(s=>s.id===job.target.join(':'));if(!target)throw new Error(`目标状态不存在：${job.id}`);
  return {initial:job.initial,target:job.target,scale:target.frequencies[0]/midiHz(job.note),
    tolerance:job.tolerance,measureLimit:job.measurements,unitBudget:job.budget,massBudgetGrams:null,
    coarse:job.coarse,reveal:job.reveal,prediction:job.prediction};
}
export function referenceSet(atlas:Atlas):BellModel[] {
  return fiveReferenceJobs.map(j=>new BellModel(atlas,specForJob(atlas,j)));
}
const fiveReferenceJobs:Job[]=SET_NOTES.map((note,i)=>({id:`reference-${i}`,name:noteNames[i],brief:'现代练习音列参照，非古谱复原',
  initial:[0,0,0],target:[3,3,3],note,tolerance:[6,6],measurements:null,budget:null,reveal:'always',prediction:false,coarse:true}));
export interface BellKey {bell:number;tone:Tone}
export interface NoteEvent extends BellKey {beat:number;strength:number}
export interface Piece {id:string;name:string;bpm:number;beats:number;notes:NoteEvent[];description:string}
function phrase(values:(number|null)[],offset=0,tone:Tone=0):NoteEvent[] {
  return values.flatMap((bell,i)=>bell===null?[]:[{beat:offset+i,bell,tone,strength:.8}]);
}
export const PIECES:Piece[]=[
  {id:'pulse',name:'四拍初练',bpm:66,beats:16,notes:phrase([0,null,1,null,2,null,1,null,0,null,3,null,2,null,0,null]),description:'每两拍一个音，先保持落点稳定。'},
  {id:'alternate',name:'两声交替',bpm:72,beats:24,notes:[...phrase([0,1,2,null,2,1,0,null]),...phrase([0,1,2,null,2,1,0,null],8,1),...phrase([0,2,1,3,2,null,0,null],16)],description:'第二句换侧鼓，注意按键行。'},
  {id:'rests',name:'弱起与停顿',bpm:76,beats:24,notes:[...phrase([null,0,1,null,2,null,1,0]),...phrase([null,2,3,null,4,null,3,2],8),...phrase([0,null,1,2,null,3,2,null],16,1)],description:'从空拍开始，保留句间停顿。'},
  {id:'round',name:'五钟轮转',bpm:82,beats:32,notes:[...phrase([0,1,2,3,4,3,2,1]),...phrase([0,2,1,3,2,4,3,null],8),...phrase([4,3,2,1,0,1,2,3],16,1),...phrase([0,null,2,1,3,2,4,null],24)],description:'跨钟移动，保持稳定，不追赶已经错过的音。'},
  {id:'answer',name:'正侧问答',bpm:86,beats:32,notes:[...phrase([0,1,null,2,1,null,0,null]),...phrase([0,1,null,2,1,null,0,null],8,1),...phrase([2,3,null,4,3,2,1,null],16),...phrase([2,3,null,4,3,2,0,null],24,1)],description:'正鼓提出一句，侧鼓回应一句。'},
  {id:'finale',name:'五钟终曲',bpm:90,beats:48,notes:[...phrase([0,1,2,null,3,2,1,0]),...phrase([0,1,2,3,4,null,3,2],8,1),...phrase([1,null,0,1,2,3,null,2],16),...phrase([4,3,2,null,1,2,3,4],24,1),...phrase([0,2,1,3,2,4,3,null],32),...phrase([2,1,0,null,3,2,0,null],40,1)],description:'综合音位、钟序和停顿。曲目为本项目原创现代练习。'},
];
export const getPiece=(id:string)=>{const p=PIECES.find(p=>p.id===id);if(!p)throw new Error('曲目不存在');return p;};
export const CATALOG_PARTS=[
  {id:'yong',name:'甬',label:'顶部柄状结构',text:'沿顶部的甬向下观察，找到它与钟体之间的连接。转动器物，看清顶部各层结构。',point:[0,.205,0]},
  {id:'wu',name:'舞',label:'钟体顶部',text:'把视角抬高，观察顶部如何与弧形钟壁相接，再对比长、短两个方向。',point:[.025,.16,.018]},
  {id:'mei',name:'枚',label:'分组突起',text:'数一组钟枚，观察它们与横向纹带的关系，再对比正反两面的布局。',point:[.04,.105,.035]},
  {id:'zheng',name:'钲',label:'正面中部',text:'找到正面中部的纵向区域。沿这里向下观察，区分上部纹带与下部鼓区。',point:[0,.085,.037]},
  {id:'gu',name:'鼓',label:'下部敲击区域',text:'先敲正鼓，再敲侧鼓。保持同一口钟，比较音高和余音的变化，并打开振形观察。',point:[0,.045,.041]},
  {id:'mouth',name:'合瓦截面',label:'从钟口观察',text:'绕到下方，观察由两段弧面围合的截面与弧形口沿。它保留了区别于旋转圆钟的非轴对称特征。',point:[.05,.008,.012]},
] as const;
export const REFERENCES=[
  {title:'国家博物馆：曾侯舆甬钟',url:'https://www.chnmuseum.cn/portals/0/web/zt/202409fhgg/#102',scope:'器形、部位、钟枚与纹饰组织参考；模型自主重建。'},
  {title:'编钟复制与内壁加工研究',url:'https://link.springer.com/article/10.1007/s12520-024-01979-6',scope:'双音共同调节与加工痕迹依据。'},
  {title:'文物部门：曾侯乙编钟',url:'https://wwj.baoji.gov.cn/zzzb/wbwy/202503/t20250313_1127774.html',scope:'成编与一钟双音的背景资料；不借此声称复原古谱。'},
];
