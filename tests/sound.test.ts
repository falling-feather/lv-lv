import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { strikeSignal,referenceSignal,beatSignal } from '../src/sound.ts';
import type { Atlas } from '../src/game.ts';

const atlas=JSON.parse(readFileSync(new URL('../public/data/bell-atlas.json',import.meta.url),'utf8')) as Atlas;
const state=atlas.states[0],rate=24000;
const energy=(signal:Float32Array,f:number)=>{
  let re=0,im=0;
  for(let i=0;i<signal.length;i++){re+=signal[i]*Math.cos(2*Math.PI*f*i/rate);im+=signal[i]*Math.sin(2*Math.PI*f*i/rate);}
  return re*re+im*im;
};
test('strike signal is bounded, starts silently, and differs by actual strike weights',()=>{
  const a=strikeSignal(state,0,rate),b=strikeSignal(state,1,rate);
  assert.equal(a[0],0);assert.equal(b[0],0);
  let maximum=0,difference=0;
  for(let i=0;i<a.length;i++){maximum=Math.max(maximum,Math.abs(a[i]));difference+=Math.abs(a[i]-b[i]);}
  assert.ok(maximum<.5);assert.ok(difference>10);
  for(const [signal,tone] of [[a,0],[b,1]] as const) {
    assert.ok(energy(signal,state.frequencies[tone])>energy(signal,state.frequencies[tone]+25)*5);
  }
});
test('A/B reference uses the requested frequency rather than a prerecorded note',()=>{
  const signal=referenceSignal(517.3,rate);
  assert.ok(energy(signal,517.3)>energy(signal,527.3)*100);
});
test('simultaneous 440 and 442 Hz give two amplitude beats per second',()=>{
  const s=beatSignal(440,442,rate,1);
  const rms=(center:number)=>{
    const start=Math.round((center-.0125)*rate),end=Math.round((center+.0125)*rate);
    let sum=0;for(let i=start;i<end;i++)sum+=s[i]**2;
    return Math.sqrt(sum/(end-start));
  };
  assert.ok(rms(.5)>rms(.25)*10);
  assert.ok(rms(.5)>rms(.75)*10);
});
