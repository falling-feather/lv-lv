import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {hydrateAtlas,BellModel,createSession,transition,type AtlasData} from '../src/game.ts';
import {UNITS,PIECES,referenceSet,WORKSHOP_ROUTE,nextWorkshopUnit,recommendedUnit,intervalPair,intervalSize,specForJob,type Unit} from '../src/content.ts';
import {makeEarQuestion,diagnosisCase,arrangement,validateArrangement} from '../src/practice.ts';
import {beginPerformance,registerHit,performanceResult,normalizeComposition} from '../src/performance.ts';
import {WorkshopProgress,STORAGE_KEY} from '../src/progress.ts';
import {compositionWav} from '../src/sound.ts';
import {pageSlice} from '../src/ui.ts';
const data=JSON.parse(readFileSync(new URL('../public/data/bell-atlas.json',import.meta.url),'utf8')) as AtlasData;
const bytes=readFileSync(new URL('../public/data/bell-atlas.modes.bin',import.meta.url));
const atlas=hydrateAtlas(data,bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
const models=referenceSet(atlas),voices=models.map(m=>m.voice(m.spec.target));
test('ear exercises are deterministic, have audible finite samples and include near judgements',()=>{
  for(const unit of UNITS){if(unit.kind!=='ear')continue;const answers=new Set<number>();
    for(let round=0;round<unit.rounds;round++){const q=makeEarQuestion(atlas,unit,round);assert.deepEqual(q,makeEarQuestion(atlas,unit,round));assert.ok(q.correct>=0&&q.correct<q.labels.length);answers.add(q.correct);
      for(const clips of [q.reference,...q.samples])for(const clip of clips){if(clip.kind==='tone')assert.ok(Number.isFinite(clip.frequency)&&clip.frequency>50);if(clip.kind==='beat')assert.ok(Math.abs(clip.current-clip.target)<8);}
      if(unit.lesson==='memory')assert.equal(new Set(q.samples.map(s=>JSON.stringify(s))).size,3);
    }if(unit.lesson==='direction')assert.ok(answers.has(2));
  }
});
test('diagnosis covers reachable, material-limited and budget-limited cases and derives answers from real states',()=>{
  for(const unit of UNITS){if(unit.kind!=='diagnose')continue;let yes=0,no=0;
    for(let i=0;i<unit.rounds;i++){const c=diagnosisCase(atlas,unit.seed,i);assert.equal(c.repairable,c.model.canReach(c.model.spec.initial));c.repairable?yes++:no++;assert.equal(c.model.isTuned(c.model.spec.initial),false);}
    assert.ok(yes>0&&no>0);
  }
});
test('material-limited and budget-limited teaching cases remain impossible from their own actual initial state',()=>{
  for(const unit of UNITS){if(unit.kind!=='diagnose')continue;
    for(let i=0;i<unit.rounds;i++){const c=diagnosisCase(atlas,unit.seed,i);assert.equal(c.repairable,i%3===0,`${unit.id} case ${i}`);}
  }
});
test('all four arrangements have a valid actual two-tone solution; wrong notes and excess bells fail',()=>{
  for(let i=0;i<4;i++){const a=arrangement(atlas,i);assert.equal(validateArrangement(a.goals,a.source,voices,a.maxBells).ok,true);assert.equal(validateArrangement(a.goals,a.source.map(()=>null),voices,a.maxBells).ok,false);
    const wrong=a.source.map(k=>({...k}));wrong[0]={bell:4,tone:1};assert.equal(validateArrangement(a.goals,wrong,voices,a.maxBells).ok,false);}
  const a=arrangement(atlas,1);assert.equal(validateArrangement(a.goals,a.source,voices,1).ok,false);
});
test('rhythm scoring rejects rest hits and duplicate hits, handles timing offsets, and all pieces can pass',()=>{
  for(const piece of PIECES){let r=beginPerformance(piece,10);for(const n of piece.notes)r=registerHit(r,piece,n,10+n.beat*60/piece.bpm);assert.equal(performanceResult(r,piece).score,100);assert.equal(performanceResult(r,piece).passed,true);
    r=registerHit(r,piece,piece.notes[0],10+piece.notes[0].beat*60/piece.bpm);assert.equal(r.wrong,1);
    const bad=registerHit(beginPerformance(piece,10),piece,piece.notes[0],10+100*60/piece.bpm);assert.equal(bad.hits.length,0);
  }
});
test('local progress resumes drafts, merges results without downgrading, preserves unreadable data and surfaces quota errors',()=>{
  const map=new Map<string,string>(),driver={getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>void map.set(k,v)};
  const p=new WorkshopProgress(driver,String(atlas.model.revision));p.setActive('1-4',{cuts:[1,0,0]});
  p.complete('1-1',{score:90,assisted:false,seconds:200,completedAt:1});
  const restored=new WorkshopProgress(driver,String(atlas.model.revision));assert.deepEqual(restored.active('1-4'),{cuts:[1,0,0]});assert.equal(restored.data.completed['1-1'].score,90);
  const imported=JSON.parse(p.export());imported.completed['1-1'].score=60;restored.import(JSON.stringify(imported));assert.equal(restored.data.completed['1-1'].score,90);
  map.set(STORAGE_KEY,'broken');const bad=new WorkshopProgress(driver,String(atlas.model.revision));bad.setActive('1-4',{});assert.equal(map.get(STORAGE_KEY),'broken');assert.ok(bad.error);
  const quota=new WorkshopProgress({getItem:()=>null,setItem:()=>{throw Error('quota');}},String(atlas.model.revision));assert.equal(quota.save(),false);assert.match(quota.error,/quota/);
});
test('composition normalization rejects invalid notes, WAV export has valid PCM duration and audible data',()=>{
  const piece=PIECES[0],c=normalizeComposition({id:'test',name:'验证短句',bpm:piece.bpm,beats:piece.beats,notes:piece.notes,updatedAt:1});
  assert.throws(()=>normalizeComposition({...c,notes:[{bell:6,tone:0,beat:0,strength:.8}]}));
  const wav=compositionWav(c,voices,12000),view=new DataView(wav);assert.equal(view.getUint32(24,true),12000);assert.equal(view.getUint32(40,true),wav.byteLength-44);
  assert.equal(new TextDecoder().decode(wav.slice(0,4)),'RIFF');let max=0;for(let i=44;i<wav.byteLength;i+=2)max=Math.max(max,Math.abs(view.getInt16(i,true)));assert.ok(max>1000&&max<=32767);
});
test('creative drafts do not replace curriculum resume, and exported scores retain the exact voice snapshot',()=>{
  let stored:string|null=null;const p=new WorkshopProgress({getItem:()=>stored,setItem:(_,v)=>{stored=v;}},String(atlas.model.revision),atlas);
  p.setActive('3-6',{index:0});p.setActive('composer',{name:'草稿'});assert.equal(p.data.lastUnit,'3-6');
  const piece=PIECES[0],c=normalizeComposition({id:'snapshot',name:'声音快照',bpm:76,beats:16,notes:piece.notes,updatedAt:1,voices});p.saveComposition(c);
  const restored=new WorkshopProgress({getItem:()=>stored,setItem:()=>{}},String(atlas.model.revision),atlas);
  assert.deepEqual(restored.data.compositions[0].voices,voices);assert.deepEqual(compositionWav(c,voices,8000),compositionWav(restored.data.compositions[0],restored.data.compositions[0].voices!,8000));
});

test('the recommended route connects different decisions and keeps all its source units accessible',()=>{
  assert.deepEqual(WORKSHOP_ROUTE.map(s=>UNITS.find(u=>u.id===s.unitId)!.kind),['inspect','ear','tune','tune','assemble','perform']);
  assert.equal(recommendedUnit({})!.id,'1-1');assert.equal(nextWorkshopUnit('1-1')!.id,'1-3');assert.equal(nextWorkshopUnit('1-6'),undefined);
  assert.equal(recommendedUnit({'1-1':true})!.id,'1-3');assert.equal(new Set(WORKSHOP_ROUTE.map(s=>s.unitId)).size,6);
});
test('interval references retain the actual bell pair and use explicit modern 300/400-cent comparisons',()=>{
  const voice=voices[2],before=JSON.stringify(voice);assert.deepEqual(intervalPair(voice,'model'),voice.frequencies);
  for(const [kind,expected] of [['minor',300],['major',400]] as const){const [a,b]=intervalPair(voice,kind);assert.equal(a,voice.frequencies[0]);assert.ok(Math.abs(1200*Math.log2(b/a)-expected)<1e-8);}
  assert.notEqual(Math.round(intervalSize(voice)),400);assert.equal(JSON.stringify(voice),before);
});
test('personal arrangement goals come from the actual tuned voices, rather than retuning them to the reference set',()=>{
  const unit=UNITS.find(u=>u.id==='5-1') as Extract<Unit,{kind:'tune'}>;
  const own=unit.jobs.map(j=>{const m=new BellModel(atlas,specForJob(atlas,j));let cuts=[...j.initial] as [number,number,number];for(const z of m.route(cuts))cuts[z]++;return m.voice(cuts);});
  const a=arrangement(atlas,1,own);assert.deepEqual(a.goals,a.source.map(k=>own[k.bell].frequencies[k.tone]));
  assert.equal(validateArrangement(a.goals,a.source,own,a.maxBells).ok,true);assert.notDeepEqual(a.goals,arrangement(atlas,1).goals);
});
test('paged records preserve source order and material history, including empty and last pages',()=>{
  const data=Object.freeze(Array.from({length:11},(_,i)=>i));const first=pageSlice(data,0,5),last=pageSlice(data,99,5);
  assert.deepEqual(first.items,[0,1,2,3,4]);assert.deepEqual(last.items,[10]);assert.equal(last.start,10);assert.equal(last.end,11);assert.equal(last.pages,3);
  assert.deepEqual(pageSlice(data,-3,5).items,first.items);assert.equal(pageSlice([],0,5).end,0);assert.throws(()=>pageSlice(data,0,0));assert.equal(data.length,11);
});
