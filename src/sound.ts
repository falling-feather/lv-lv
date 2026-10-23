import type { BellState, Tone } from './game.ts';
import type { Clip } from './practice.ts';
import type { Composition } from './performance.ts';
import type { NoteEvent } from './content.ts';

const edge = (t: number, duration: number, ramp=.015) => Math.min(1,t/ramp,(duration-t)/ramp);
export function strikeSignal(state: BellState,tone: Tone,sampleRate: number,duration=2.8): Float32Array {
  const buffer=new Float32Array(Math.ceil(sampleRate*duration));
  for(let j=0;j<state.partials.length;j++) {
    const f=state.partials[j],w=state.weights[tone][j];
    // Perceptual decay preset, intentionally not a measured bronze damping law.
    const decay=.24+1.05*Math.pow(state.partials[0]/f,.45);
    for(let i=0;i<buffer.length;i++) {
      const t=i/sampleRate;
      buffer[i]+= .48*w*Math.sin(2*Math.PI*f*t)*Math.exp(-t/decay)*(1-Math.exp(-t/.0015))*Math.max(0,edge(t,duration));
    }
  }
  return buffer;
}
export function referenceSignal(frequency: number,sampleRate: number,duration=.7): Float32Array {
  return Float32Array.from({length:Math.ceil(sampleRate*duration)},(_,i)=> {
    const t=i/sampleRate;
    return .22*Math.sin(2*Math.PI*frequency*t)*Math.max(0,edge(t,duration,.025));
  });
}
export function beatSignal(current: number,target: number,sampleRate: number,duration=4): Float32Array {
  return Float32Array.from({length:Math.ceil(sampleRate*duration)},(_,i)=> {
    const t=i/sampleRate;
    return .15*(Math.sin(2*Math.PI*current*t)+Math.sin(2*Math.PI*target*t))*Math.max(0,edge(t,duration,.04));
  });
}

export class WorkshopAudio {
  private context: AudioContext | null=null;
  private gain: GainNode | null=null;
  private compressor: DynamicsCompressorNode | null=null;
  private sources: AudioBufferSourceNode[]=[];
  private epoch=0;
  private panelPause=Promise.resolve();
  private readonly cache=new Map<string,Float32Array>();
  muted=false;
  async ready(): Promise<void> {
    if(!this.context) {
      this.context=new AudioContext();
      this.gain=this.context.createGain();
      this.gain.gain.value=this.muted?0:.65;
      this.compressor=this.context.createDynamicsCompressor();
      this.compressor.threshold.value=-12;this.compressor.ratio.value=6;
      this.gain.connect(this.compressor);this.compressor.connect(this.context.destination);
    }
    if(this.context.state!=='running') await this.context.resume();
    if(this.context.state!=='running') throw new Error('浏览器尚未开启声音，请再次点击敲击按钮');
  }
  setMuted(value: boolean): void {
    this.muted=value;
    if(this.context&&this.gain) this.gain.gain.setTargetAtTime(value?0:.65,this.context.currentTime,.015);
  }
  get time():number{return this.context?.currentTime??0;}
  setPanelPaused(paused:boolean):Promise<void> {
    // 调用方会报告失败；一次失败不能阻塞后续的关闭／恢复操作。
    this.panelPause=this.panelPause.catch(()=>{}).then(async()=>{
      if(!this.context)return;
      if(paused&&this.context.state==='running')await this.context.suspend();
      if(!paused&&this.context.state==='suspended')await this.context.resume();
    });return this.panelPause;
  }
  stop(): void {
    this.epoch++;
    for(const source of this.sources) source.stop();
    this.sources=[];
  }
  private play(signal: Float32Array,delay=0,strength=1): void {
    if(!this.context||!this.gain) throw new Error('声音尚未开启');
    const buffer=this.context.createBuffer(1,signal.length,this.context.sampleRate);
    buffer.copyToChannel(new Float32Array(signal),0);
    const source=this.context.createBufferSource();
    const velocity=this.context.createGain();velocity.gain.value=strength;
    source.buffer=buffer;source.connect(velocity);velocity.connect(this.gain);
    this.sources.push(source);
    source.onended=()=>{this.sources=this.sources.filter(n=>n!==source);source.disconnect();velocity.disconnect();};
    source.start(this.context.currentTime+delay);
  }
  private signal(state:BellState,tone:Tone):Float32Array {
    const key=`${state.id}:${tone}:${this.context!.sampleRate}`;
    let signal=this.cache.get(key);
    if(!signal) {
      signal=strikeSignal(state,tone,this.context!.sampleRate);
      if(this.cache.size>=32) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key,signal);
    }
    return signal;
  }
  async strike(state: BellState,tone: Tone,strength=1): Promise<void> {
    const epoch=this.epoch;await this.ready();if(epoch!==this.epoch)return;
    this.play(this.signal(state,tone),0,strength);
  }
  async compare(current: number,target: number): Promise<void> {
    const epoch=++this.epoch;await this.ready();if(epoch!==this.epoch)return;this.stop();
    this.play(referenceSignal(current,this.context!.sampleRate),0);
    this.play(referenceSignal(target,this.context!.sampleRate),.95);
    this.play(referenceSignal(current,this.context!.sampleRate),1.9);
    this.play(referenceSignal(target,this.context!.sampleRate),2.85);
  }
  async beats(current: number,target: number): Promise<void> {
    const epoch=++this.epoch;await this.ready();if(epoch!==this.epoch)return;this.stop();
    this.play(beatSignal(current,target,this.context!.sampleRate));
  }
  async clips(clips:Clip[],voices:BellState[]):Promise<boolean> {
    this.stop();const epoch=this.epoch;await this.ready();if(epoch!==this.epoch)return false;
    let delay=0;
    for(const clip of clips) {
      if(clip.kind==='tone'){this.play(referenceSignal(clip.frequency,this.context!.sampleRate),delay);delay+=1.05;}
      else if(clip.kind==='strike'){this.play(this.signal(clip.state,clip.tone),delay);delay+=1.9;}
      else if(clip.kind==='beat'){this.play(beatSignal(clip.current,clip.target,this.context!.sampleRate),delay);delay+=4.3;}
      else for(const key of clip.keys){this.play(this.signal(voices[key.bell],key.tone),delay,.8);delay+=.6;}
    }
    const finishedAt=this.time+Math.max(0,delay-.15);
    // 完成标记跟随实际音频时间，资料暂停和切页取消都不能提前记为已听。
    while(epoch===this.epoch&&this.time<finishedAt)await new Promise(resolve=>setTimeout(resolve,Math.min(200,Math.max(20,(finishedAt-this.time)*1000))));
    return epoch===this.epoch;
  }
  async sequence(notes:NoteEvent[],voices:BellState[],bpm:number,delay=.1):Promise<number|null> {
    this.stop();const epoch=this.epoch;await this.ready();if(epoch!==this.epoch)return null;
    const start=this.time+delay;
    for(const n of notes)this.play(this.signal(voices[n.bell],n.tone),delay+n.beat*60/bpm,n.strength);
    return start;
  }
  async countIn(beats:number,bpm:number):Promise<number|null> {
    this.stop();const epoch=this.epoch;await this.ready();if(epoch!==this.epoch)return null;
    for(let i=0;i<beats;i++)this.play(referenceSignal(i===0?960:720,this.context!.sampleRate,.09),.1+i*60/bpm,.4);
    return this.time+.1+beats*60/bpm;
  }
}

export function compositionWav(composition:Composition,voices:BellState[],sampleRate=24000):ArrayBuffer {
  const length=Math.ceil((composition.beats*60/composition.bpm+3)*sampleRate),mix=new Float32Array(length);
  const cache=new Map<string,Float32Array>();
  for(const note of composition.notes){const key=`${note.bell}:${note.tone}`;let signal=cache.get(key);
    if(!signal){signal=strikeSignal(voices[note.bell],note.tone,sampleRate);cache.set(key,signal);}
    const start=Math.round(note.beat*60/composition.bpm*sampleRate);
    for(let i=0;i<signal.length&&start+i<length;i++)mix[start+i]+=signal[i]*note.strength;
  }
  const peak=mix.reduce((m,v)=>Math.max(m,Math.abs(v)),0),gain=peak>.9?.9/peak:1;
  const bytes=new ArrayBuffer(44+length*2),view=new DataView(bytes);
  const label=(at:number,value:string)=>[...value].forEach((c,i)=>view.setUint8(at+i,c.charCodeAt(0)));
  label(0,'RIFF');view.setUint32(4,36+length*2,true);label(8,'WAVE');label(12,'fmt ');view.setUint32(16,16,true);
  view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*2,true);
  view.setUint16(32,2,true);view.setUint16(34,16,true);label(36,'data');view.setUint32(40,length*2,true);
  for(let i=0;i<length;i++)view.setInt16(44+i*2,Math.round(mix[i]*gain*32767),true);
  return bytes;
}
