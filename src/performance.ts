import type { BellKey, NoteEvent, Piece } from './content.ts';
import type { BellState } from './game.ts';
export interface PerformanceRun {pieceId:string;hits:{note:number;offset:number}[];wrong:number;startedAt:number;bpm:number}
export const beginPerformance=(piece:Piece,now:number,bpm=piece.bpm):PerformanceRun=>({pieceId:piece.id,hits:[],wrong:0,startedAt:now,bpm});
export function registerHit(run:PerformanceRun,piece:Piece,key:BellKey,time:number):PerformanceRun {
  const beat=(time-run.startedAt)*run.bpm/60;
  const candidates=piece.notes.map((n,i)=>({n,i,distance:Math.abs(n.beat-beat)})).filter(({n,i,distance})=>
    n.bell===key.bell&&n.tone===key.tone&&distance<=.24&&!run.hits.some(h=>h.note===i)).sort((a,b)=>a.distance-b.distance);
  if(!candidates.length)return {...run,wrong:run.wrong+1};
  return {...run,hits:[...run.hits,{note:candidates[0].i,offset:beat-candidates[0].n.beat}]};
}
export function performanceResult(run:PerformanceRun,piece:Piece):{score:number;hit:number;miss:number;wrong:number;meanOffset:number;passed:boolean} {
  const hit=run.hits.length,miss=piece.notes.length-hit;
  const meanOffset=hit?run.hits.reduce((sum,h)=>sum+Math.abs(h.offset),0)/hit:1;
  const score=Math.max(0,Math.min(100,Math.round(hit/piece.notes.length*100-run.wrong*2-meanOffset*20)));
  return {score,hit,miss,wrong:run.wrong,meanOffset,passed:score>=65&&hit/piece.notes.length>=.7};
}
export interface Composition {id:string;name:string;bpm:number;beats:number;notes:NoteEvent[];updatedAt:number;voices?:BellState[]}
export function normalizeComposition(raw:unknown):Composition {
  if(!raw||typeof raw!=='object')throw new Error('作品数据缺失');
  const c=raw as Composition;
  if(typeof c.id!=='string'||typeof c.name!=='string'||c.name.length>60||c.bpm<40||c.bpm>160||
    !Number.isFinite(c.bpm)||![16,24,32,48].includes(c.beats)||!Array.isArray(c.notes)||c.notes.length>400)throw new Error('作品基本信息无效');
  for(const n of c.notes)if(!Number.isFinite(n.beat)||n.beat<0||n.beat>=c.beats||!Number.isInteger(n.bell)||n.bell<0||n.bell>4||
    ![0,1].includes(n.tone)||!Number.isFinite(n.strength)||n.strength<.2||n.strength>1)throw new Error('作品含有无效音位或节拍');
  if(c.voices){if(c.voices.length!==5)throw new Error('作品钟组不完整');
    for(const v of c.voices)if(!Array.isArray(v.frequencies)||v.frequencies.length!==2||v.frequencies.some(f=>!Number.isFinite(f)||f<20||f>20000)||
      !Array.isArray(v.partials)||v.partials.length!==12||v.partials.some(f=>!Number.isFinite(f)||f<=0)||
      !Array.isArray(v.weights)||v.weights.length!==2||v.weights.some(w=>!Array.isArray(w)||w.length!==12||w.some(n=>!Number.isFinite(n)))||
      !Array.isArray(v.cuts)||v.cuts.length!==3||v.cuts.some(n=>!Number.isInteger(n)||n<0||n>5))throw new Error('作品含有无效钟组快照');
  }
  return {...c,notes:c.notes.map(n=>({...n})).sort((a,b)=>a.beat-b.beat)};
}
