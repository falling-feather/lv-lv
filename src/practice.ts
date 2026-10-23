import { BellModel, type Atlas, type BellSpec, type BellState, type Cuts, type Tone } from './game.ts';
import { midiHz, referenceSet, type BellKey, type LessonKind, type Unit } from './content.ts';

export type Clip={kind:'tone';frequency:number}|{kind:'strike';state:BellState;tone:Tone}|
  {kind:'beat';current:number;target:number}|{kind:'phrase';keys:BellKey[]};
export interface EarQuestion {id:string;prompt:string;reference:Clip[];samples:Clip[][];labels:string[];correct:number;explanation:string}
export const seedOf=(value:string)=>[...value].reduce((n,c)=>(Math.imul(n,31)+c.charCodeAt(0))>>>0,17);
const pick=<T>(items:T[],seed:number)=>items[seed%items.length];

export function makeEarQuestion(atlas:Atlas,unit:Extract<Unit,{kind:'ear'}>,round:number):EarQuestion {
  const seed=seedOf(unit.id)+round*7919,mode:LessonKind=unit.lesson;
  const target=atlas.states.find(s=>s.id==='3:3:3')!;
  const tone=(seed%2) as Tone,scale=target.frequencies[0]/midiHz([60,64,67,72][round%4]);
  const targetHz=target.frequencies[tone]/scale;
  const model=new BellModel(atlas,{initial:[0,0,0],target:target.cuts,scale,tolerance:[6,6],measureLimit:null,unitBudget:null,massBudgetGrams:null,reveal:'always',prediction:false,coarse:true});
  const pool=atlas.states.filter(s=>Math.abs(model.errors(s.cuts)[tone])>7&&Math.abs(model.errors(s.cuts)[tone])<130);
  const state=mode==='direction'&&round%4===3?target:pick(pool,seed),current=state.frequencies[tone]/scale;
  const id=`${unit.id}:${round}`;
  if(mode==='direction')return {id,prompt:'待辨音相对参照，是偏高、偏低，还是已经很接近？',
    reference:[{kind:'tone',frequency:targetHz}],samples:[[{kind:'tone',frequency:current}]],
    labels:['偏高','偏低','已经接近'],correct:Math.abs(model.errors(state.cuts)[tone])<=6?2:current>targetHz?0:1,
    explanation:`本题待辨音${Math.abs(model.errors(state.cuts)[tone])<=6?'已接近':current>targetHz?'高于':'低于'}参照。保持同一音位比较，必要时再听一遍。`};
  if(mode==='position') {
    const voice=model.voice(state.cuts);
    return {id,prompt:'这次待辨声来自哪个敲击位置？',reference:[{kind:'strike',state:voice,tone:0},{kind:'strike',state:voice,tone:1}],
      samples:[[{kind:'strike',state:voice,tone}]],labels:['正鼓','侧鼓'],correct:tone,
      explanation:`待辨声来自${tone===0?'正鼓':'侧鼓'}。参照与待辨声使用同一口钟，同一组模态。`};
  }
  if(mode==='memory') {
    const keys:BellKey[]=Array.from({length:3+round%3},(_,i)=>({bell:(seed+i*i+2*i)%5,tone:0}));
    const correct=seed%3;
    const samples:Clip[][]=Array.from({length:3},(_,option)=>{
      const variant=keys.map(k=>({...k}));
      if(option!==correct){const at=(seed+option)%variant.length;variant[at].bell=(variant[at].bell+1+option)%5;}
      return [{kind:'phrase',keys:variant}];
    });
    return {id,prompt:'记住参照音型，找出顺序相同的一项。',reference:[{kind:'phrase',keys}],samples,
      labels:['音型甲','音型乙','音型丙'],correct,explanation:'比较相邻声音上行、下行和重复的位置，而不只是记住第一个音。'};
  }
  if(mode==='beat') {
    const candidates=atlas.states.map(s=>s.frequencies[tone]/scale).filter(f=>Math.abs(f-targetHz)>.4&&Math.abs(f-targetHz)<8);
    const first=pick(candidates,seed),second=pick(candidates.filter(f=>Math.abs(Math.abs(f-targetHz)-Math.abs(first-targetHz))>.8),seed+37);
    const values=[first,second],correct=Math.abs(first-targetHz)<Math.abs(second-targetHz)?0:1;
    return {id,prompt:'哪组拍动更慢，也更接近合律？',reference:[],samples:values.map(f=>[{kind:'beat',current:f,target:targetHz}]),
      labels:['甲组更慢','乙组更慢'],correct,explanation:'频率差较小的一组，拍动较慢。本题使用同一音位的当前与参照近频叠加。'};
  }
  const alternatives=pool.filter(s=>Math.abs(Math.abs(model.errors(s.cuts)[tone])-Math.abs(model.errors(state.cuts)[tone]))>12);
  const second=pick(alternatives,seed+37),other=second.frequencies[tone]/scale;
  const values=seed%2?[current,other]:[other,current];
  const distance=values.map(f=>Math.abs(f-targetHz));
  const correct=distance[0]<distance[1]?0:1;
  return {id,prompt:'哪一个候选音更接近参照？',reference:[{kind:'tone',frequency:targetHz}],
    samples:values.map(f=>[{kind:'tone',frequency:f}]),labels:['甲更接近','乙更接近'],correct,
    explanation:'高低方向与接近程度要分开判断。更接近的一项，与参照的频率差更小。'};
}

export interface DiagnosisCase {id:string;model:BellModel;repairable:boolean;description:string}
export function diagnosisCase(atlas:Atlas,seed:number,index:number):DiagnosisCase {
  const target:Cuts=[2+(seed+index)%3,2+(seed*3+index)%3,2+(seed+index*2)%3];
  let initial:Cuts=[index%2,0,1];
  const scale=atlas.states.find(s=>s.id===target.join(':'))!.frequencies[0]/midiHz(60+(index%3)*4);
  let spec:BellSpec={initial,target,scale,tolerance:[5,5],measureLimit:null,unitBudget:null,massBudgetGrams:null,
    reveal:'always',prediction:false,coarse:true};
  const preliminary=new BellModel(atlas,spec),cost=preliminary.route(initial).length;
  if(index%3===1){
    const failed=atlas.states.filter(s=>s.cuts.every((n,z)=>n>=initial[z])&&!preliminary.canReach(s.cuts)&&s.cuts.some(c=>c<5));
    initial=pick(failed,seed+index).cuts;spec={...spec,initial,unitBudget:8};
  }else spec={...spec,unitBudget:index%3===2?Math.max(0,cost-1):cost+seed%2};
  const model=new BellModel(atlas,spec);
  return {id:`case-${seed}-${index}`,model,repairable:model.canReach(initial),
    description:index%3===2?'本单加工预算较紧。对照目标与剩余预算，判断是否还能同时完成两音。':'这口钟已经经过部分加工。先核对两音与现有工序，再决定是否继续。'};
}

export interface Arrangement {name:string;description:string;goals:number[];maxBells:number;source:BellKey[]}
export function arrangement(atlas:Atlas,index:number,voices?:BellState[]):Arrangement {
  const set=referenceSet(atlas);
  const sources:BellKey[][]=[
    [0,1,2,3,4].map(bell=>({bell,tone:0})),
    [{bell:0,tone:0},{bell:0,tone:1},{bell:1,tone:0},{bell:1,tone:1}],
    [{bell:0,tone:0},{bell:2,tone:1},{bell:4,tone:0},{bell:1,tone:1},{bell:0,tone:1}],
    [{bell:0,tone:0},{bell:0,tone:1},{bell:2,tone:0},{bell:2,tone:1},{bell:4,tone:0},{bell:4,tone:1}],
  ];
  const source=sources[index];
  return {name:['依音排位','四音两钟','混合音位','六音三钟'][index],
    description:['试听五口钟，将各自的正鼓放入相应参照位置。','四个位置只用两口钟，允许同一口钟使用正、侧两个音位。','把不同音位组织成一组，不必全部使用正鼓。','在三口钟内完成六个参照音，利用每口钟的两个位置。'][index],
    goals:source.map(k=>(voices?.[k.bell]??set[k.bell].voice(set[k.bell].spec.target)).frequencies[k.tone]),
    maxBells:[5,2,4,3][index],source};
}
export function validateArrangement(goals:number[],selection:(BellKey|null)[],voices:BellState[],maxBells:number):{ok:boolean;message:string} {
  if(selection.length!==goals.length||selection.some(k=>k===null))return {ok:false,message:'还有参照位置没有安排音位。'};
  const keys=selection as BellKey[];
  if(new Set(keys.map(k=>k.bell)).size>maxBells)return {ok:false,message:`本单最多使用 ${maxBells} 口钟。试着让同一口钟承担两个音。`};
  for(let i=0;i<keys.length;i++) {
    const key=keys[i],voice=voices[key.bell];
    if(!voice||key.tone>1||key.tone<0)return {ok:false,message:'音位选择无效。'};
    if(Math.abs(1200*Math.log2(voice.frequencies[key.tone]/goals[i]))>12)return {ok:false,message:`第 ${i+1} 位还没有接近参照。可以反复试听后重新安排。`};
  }
  return {ok:true,message:'这组音位已经满足参照与用钟数量要求。'};
}
