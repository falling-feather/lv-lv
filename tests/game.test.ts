import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BellModel,hydrateAtlas,createSession,transition,restoreSession,judgement,planRemoval, type AtlasData } from '../src/game.ts';
import { UNITS,specForJob } from '../src/content.ts';
const data=JSON.parse(readFileSync(new URL('../public/data/bell-atlas.json',import.meta.url),'utf8')) as AtlasData;
const binary=readFileSync(new URL('../public/data/bell-atlas.modes.bin',import.meta.url));
const atlas=hydrateAtlas(data,binary.buffer.slice(binary.byteOffset,binary.byteOffset+binary.byteLength));
const jobs=UNITS.flatMap(u=>u.kind==='tune'?u.jobs:[]);
const model=new BellModel(atlas,specForJob(atlas,jobs[1]));
const hear=(s=createSession(model,0),m=model)=>transition(transition(s,{type:'strike',tone:0},m),{type:'strike',tone:1},m);
test('every authored commission starts with work to do and has a forward solution inside its budget',()=>{
  for(const job of jobs){const m=new BellModel(atlas,specForJob(atlas,job));assert.equal(m.isTuned(job.initial),false,job.id);assert.ok(m.canReach(job.initial),job.id);}
  assert.equal(new Set(UNITS.map(u=>u.id)).size,36);
});
test('all 216 states share positive walls and tracked modal fields; malformed binary is rejected',()=>{
  assert.equal(atlas.states.length,216);
  for(const s of atlas.states){assert.ok(s.minWallMm>2);assert.ok(s.mac.every(n=>n>.8&&n<1.000001));assert.equal(model.mode(s.cuts,0).length,atlas.modeStride);}
  assert.throws(()=>hydrateAtlas(data,new ArrayBuffer(4)));assert.throws(()=>model.state([6,0,0]));
});
test('initial listening unlocks planned continuous machining, while each cut invalidates final audition',()=>{
  const start=createSession(model,0);assert.deepEqual(transition(start,{type:'cut',zone:0,amount:1,at:1},model).cuts,start.cuts);
  const s=transition(hear(),{type:'cut',zone:0,amount:1,at:1},model);assert.deepEqual(s.cuts,[1,0,0]);assert.deepEqual(s.heard,[false,false]);
  for(const i of [0,1])assert.notEqual(model.state(start.cuts).frequencies[i],model.state(s.cuts).frequencies[i]);
  assert.deepEqual(transition(s,{type:'cut',zone:1,amount:1,at:2},model).cuts,[1,1,0]);
});
test('actual shortest path passes two goals, one goal alone cannot pass and completion cannot be cut',()=>{
  const one=atlas.states.find(s=>{const e=model.errors(s.cuts).map(Math.abs);return (e[0]<=6)!==(e[1]<=6);});assert.ok(one);assert.equal(model.isTuned(one.cuts),false);
  let s=createSession(model,0);for(const zone of model.route(s.cuts)){s=hear(s);s=transition(s,{type:'cut',zone,amount:1,at:1},model);}
  assert.notEqual(transition(s,{type:'verify'},model).phase,'complete');s=transition(hear(s),{type:'verify'},model);assert.equal(s.phase,'complete');assert.deepEqual(transition(s,{type:'cut',zone:0,amount:1,at:2},model),s);
  assert.deepEqual(restoreSession(JSON.parse(JSON.stringify(s)),model).cuts,s.cuts);
});
test('coarse tools never clamp and finite measurement retains stale reading after machining',()=>{
  const job=jobs.find(j=>j.measurements===2)!;const m=new BellModel(atlas,specForJob(atlas,job));let s=hear(createSession(m,0),m);
  s=transition(s,{type:'measure'},m);const measured=s.cuts;
  for(const tone of [0,1] as const)s=transition(s,{type:'predict',tone,answer:judgement(m.errors(s.cuts)[tone],m.spec.tolerance[tone])},m);
  const zone=m.route(s.cuts)[0];s=transition(s,{type:'cut',zone,amount:1,at:1},m);assert.deepEqual(s.measuredAt,measured);
  s=transition(s,{type:'measure'},m);assert.equal(s.measurements,2);s=hear(s,m);s=transition(s,{type:'cut',zone:m.route(s.cuts)[0],amount:1,at:2},m);
  const last=s.measuredAt;s=transition(s,{type:'measure'},m);assert.deepEqual(s.measuredAt,last);assert.equal(s.measurements,2);
  const boundary={...hear(),cuts:[5,0,0] as const};assert.deepEqual(transition(boundary,{type:'cut',zone:0,amount:2,at:1},model).cuts,boundary.cuts);
});
test('irrecoverable processing terminates and malformed history is rejected on resume',()=>{
  let s=hear();for(const zone of [0,1,2,0,1,2,0,1,2,0,1,2,0,1,2] as const){if(s.phase==='spoiled')break;s=transition(hear(s),{type:'cut',zone,amount:1,at:1},model);}
  assert.equal(s.phase,'spoiled');assert.throws(()=>restoreSession({...s,cuts:[0,0,0]},model));
  const bad={...s,history:[s.history[0],{cuts:[1,0,0],zone:2,amount:1,at:2}],cuts:[1,0,0]};assert.throws(()=>restoreSession(bad,model));
});
test('isotropic scaling drives geometry dimensions, mass and both modal frequencies together',()=>{
  const big=new BellModel(atlas,{...model.spec,scale:2}),raw=model.state([2,3,1]),v=big.voice(raw.cuts);
  assert.equal(v.frequencies[0],raw.frequencies[0]/2);assert.equal(v.frequencies[1],raw.frequencies[1]/2);assert.equal(v.massKg,raw.massKg*8);
  assert.ok(model.inner([1,2,3]).every(Number.isFinite));
});
test('preview uses the same removal rule without spending material, granting audition, or changing history',()=>{
  const locked=createSession(model,1);assert.throws(()=>restoreSession({...locked,phase:'tune'},model));assert.equal(planRemoval(locked,0,1,model).ok,false);
  const s=hear(),snapshot=JSON.stringify(s),p=planRemoval(s,0,1,model);assert.ok(p.ok);
  assert.deepEqual(p.cuts,[1,0,0]);assert.ok(p.grams>0);assert.ok(p.deltaCents.every(v=>v!==0));
  assert.equal(JSON.stringify(s),snapshot);assert.equal(model.stock(s.cuts).remaining,model.stock(p.cuts).remaining+1);
  const committed=transition(s,{type:'cut',zone:0,amount:1,at:2},model);assert.deepEqual(committed.cuts,p.cuts);assert.deepEqual(committed.heard,[false,false]);
  assert.equal(planRemoval({...s,cuts:[5,0,0]},0,2,model).ok,false);
});
test('a whole planned sequence still requires a fresh final audition; replacement restores the actual initial blank',()=>{
  let s=hear();for(const zone of model.route(s.cuts))s=transition(s,{type:'cut',zone,amount:1,at:2},model);
  assert.ok(model.isTuned(s.cuts));assert.notEqual(transition(s,{type:'verify'},model).phase,'complete');
  assert.equal(transition(hear(s),{type:'verify'},model).phase,'complete');
  const reset=createSession(model,3);assert.deepEqual(reset.cuts,model.spec.initial);assert.equal(model.removedGrams(reset.cuts),0);assert.equal(reset.history.length,1);
});

