import { PIECES,getPiece,type Unit,type Piece,type BellKey } from './content.ts';
import { beginPerformance,registerHit,performanceResult,normalizeComposition,type Composition,type PerformanceRun } from './performance.ts';
import { compositionWav } from './sound.ts';
import { WorkshopScene } from './scene.ts';
import { $,bindAudio,currentVoices,snapshotVoices,download,escape,heading,unitHeading,toneName,bellName,panel,ignoreGameKey,personalSetReady,type ViewContext,type Dispose } from './ui.ts';

const keyLabel=(bell:number,tone:number)=>`${bellName(bell)}${tone===0?'正':'侧'}`;
const keys=['a','s','d','f','g','q','w','e','r','t'];
function keyBank():string{return `<div class="play-keyboard">${[0,1].map(tone=>`<div><span>${toneName(tone)}</span>${[0,1,2,3,4].map(bell=>`<button data-play="${bell}:${tone}"><b>${bellName(bell)}</b><kbd>${keys[tone*5+bell].toUpperCase()}</kbd></button>`).join('')}</div>`).join('')}</div>`;}
function decodeKey(event:KeyboardEvent):BellKey|null{if(event.repeat||ignoreGameKey(event))return null;const at=keys.indexOf(event.key.toLowerCase());return at<0?null:{bell:at%5,tone:at<5?0:1};}

export function mountMusic(ctx:ViewContext,compose=false):Dispose {
  ctx.host.innerHTML=`${heading('五钟合乐','从合律，到合乐。','示范钟组可以直接演奏；你完成的五钟会以实际验律结果进入“我的钟组”。练习曲均为本项目原创现代短曲。')}
  <div class="music-tabs"><button id="music-play" aria-pressed="${!compose}">按谱演奏</button><button id="music-compose" aria-pressed="${compose}">自由创作</button><a href="#/unit/5-1" class="text-link">先调好自己的五钟 ↗</a></div><div id="music-content"></div>`;
  const child={...ctx,host:$(ctx.host,'#music-content')};child.host.dataset.mode=compose?'compose':'pieces';
  let dispose=compose?mountComposer(child):mountPieceMenu(child);
  $(ctx.host,'#music-play').onclick=()=>{location.hash='/music';};$(ctx.host,'#music-compose').onclick=()=>{location.hash='/music?tab=compose';};
  return ()=>dispose();
}
function mountPieceMenu(ctx:ViewContext):Dispose {
  ctx.host.innerHTML=`<div class="piece-grid">${PIECES.map(p=>`<article><span class="small-label">${p.bpm} 拍 / 分 · ${p.beats} 拍</span><h2>${p.name}</h2><p>${p.description}</p><a class="text-link" href="#/perform/${p.id}">开始演奏 ↗</a></article>`).join('')}</div>`;return ()=>{};
}
export function mountPerformance(ctx:ViewContext,piece:Piece,unit?:Extract<Unit,{kind:'perform'}>):Dispose {
  let mine=personalSetReady(ctx),slow=false,run:PerformanceRun|null=null,playing=false,demo=false,disposed=false,raf=0,endAt=0,startAt=0,locked=false;
  let bank=currentVoices(ctx),scene:WorkshopScene|null=null;
  const started=Date.now();
  ctx.host.innerHTML=`${unit?unitHeading(unit):heading('按谱演奏',piece.name,piece.description,'<a href="#/music" class="text-link">返回曲目 ↗</a>')}
  <div class="performance-toolbar"><label>使用钟组 <select id="performance-bank"><option value="reference" ${mine?'':'selected'}>示范钟组</option><option value="mine" ${mine?'selected':''}>我的钟组</option></select></label><span id="bank-status" class="muted">示范钟组 · 现代五声音列</span><label class="check-label"><input id="slow-practice" type="checkbox"/> 慢速练习</label><button id="demo">先听示范</button><button id="perform-start" class="primary">四拍预备后开始</button><button id="perform-stop">停止</button></div>
  <div class="performance-layout"><section class="score-sheet"><div class="score-title"><h2>${piece.name}</h2><span id="tempo">♩ = ${piece.bpm}</span><span>正 / 侧为敲击位置</span></div><div class="score-window" id="score-window"><div class="score-track" id="score-track" style="--beats:${piece.beats}"><div class="playhead" id="playhead"></div>${Array.from({length:piece.beats},(_,beat)=>`<div class="beat-cell" data-beat="${beat}"><small>${beat%4+1}</small><div>${piece.notes.filter(n=>n.beat===beat).map((n,i)=>`<span class="score-note tone-${n.tone}" data-note-index="${piece.notes.indexOf(n)}">${bellName(n.bell)}<small>${toneName(n.tone)}</small></span>`).join('')||'<span class="rest-note">·</span>'}</div></div>`).join('')}</div></div><div class="conductor"><b id="conductor-status">先听示范，或直接开始。</b><span id="live-score">每个音会核对钟序、音位与节拍落点。</span></div></section>
  <section class="ensemble-stage performance-stage"><div id="performance-scene" class="scene"></div>${keyBank()}</section>
  </div><p class="performance-help">正鼓 A S D F G · 侧鼓 Q W E R T · 也可点击音位与演奏键；错音、漏音和多敲计入结果。</p>${panel('performance-review','演奏结果','<div id="performance-result"></div>')}`;
  function rebuild():void{scene?.dispose();bank=currentVoices(ctx,mine);scene=new WorkshopScene($(ctx.host,'#performance-scene'),bank.models.map((m,i)=>({model:m,cuts:bank.voices[i].cuts})),hit,undefined,ctx.notice);
    $(ctx.host,'#bank-status').textContent=mine?(bank.missing?`已完成 ${5-bank.missing}/5 口 · 缺位暂用示范钟`:'使用你最近完成的五钟 · 保留实际误差'):'示范钟组 · 现代五声音列';}
  function hit(key:BellKey):void{bindAudio(ctx,()=>ctx.audio.strike(bank.voices[key.bell],key.tone));scene?.flash(key);
    if(run&&playing&&ctx.audio.time>=run.startedAt){run=registerHit(run,piece,key,ctx.audio.time);const score=performanceResult(run,piece);$(ctx.host,'#live-score').textContent=`命中 ${score.hit} / ${piece.notes.length} · 多敲或错音 ${score.wrong}`;for(const h of run.hits)ctx.host.querySelector(`[data-note-index="${h.note}"]`)?.classList.add('hit');}
    const b=ctx.host.querySelector(`[data-play="${key.bell}:${key.tone}"]`);b?.classList.add('pressed');setTimeout(()=>b?.classList.remove('pressed'),140);
  }
  function controls(running:boolean):void{locked=running;for(const id of ['perform-start','demo','performance-bank','slow-practice'])$(ctx.host,`#${id}`).toggleAttribute('disabled',running);}
  function stop():void{ctx.audio.stop();playing=false;demo=false;run=null;controls(false);cancelAnimationFrame(raf);$(ctx.host,'#conductor-status').textContent='已停止，可以重新开始。';}
  function finish():void{playing=false;controls(false);if(demo){demo=false;$(ctx.host,'#conductor-status').textContent='示范结束，轮到你试试。';return;}if(!run)return;
    const result=performanceResult(run,piece);$(ctx.host,'#conductor-status').textContent=result.passed?'演奏完成。':'再试一次，先稳住节拍。';
    $(ctx.host,'#performance-result').innerHTML=`<section class="completion"><span class="score-number">${result.score}<small>分</small></span><div><h2>${result.passed?'这段合乐已完成':'听见停顿，再稳住落点'}</h2><p>命中 ${result.hit} · 漏音 ${result.miss} · 错音或多敲 ${result.wrong}。平均偏移 ${result.meanOffset.toFixed(2)} 拍。${slow?'本次为慢速练习。':''}</p></div><button id="try-performance" class="secondary">再演奏一次</button></section>`;
    $(ctx.host,'#try-performance').onclick=()=>{$<HTMLDialogElement>(ctx.host,'#performance-review').close();void start(false);};
    if(unit&&result.passed)ctx.complete(unit,result.score,slow||(mine&&bank.missing>0),started);else $<HTMLDialogElement>(ctx.host,'#performance-review').showModal();
    run=null;
  }
  function frame():void{if(disposed||!playing)return;const beat=(ctx.audio.time-startAt)*(slow?piece.bpm*.75:piece.bpm)/60;
    const marker=$(ctx.host,'#playhead');marker.style.left=`${Math.max(0,beat)*64}px`;
    if(beat<0)$(ctx.host,'#conductor-status').textContent=`预备 ${Math.min(4,Math.ceil(-beat))}`;else $(ctx.host,'#conductor-status').textContent=`${demo?'示范':'演奏'} · 第 ${Math.min(piece.beats,Math.floor(beat)+1)} 拍 / ${piece.beats}`;
    const windowEl=$(ctx.host,'#score-window');if(beat*64>windowEl.scrollLeft+windowEl.clientWidth*.7)windowEl.scrollLeft=Math.max(0,beat*64-windowEl.clientWidth*.3);
    if(ctx.audio.time>endAt){finish();return;}raf=requestAnimationFrame(frame);
  }
  async function start(isDemo:boolean):Promise<void>{if(locked)return;controls(true);ctx.host.querySelectorAll('.score-note.hit').forEach(n=>n.classList.remove('hit'));$(ctx.host,'#performance-result').innerHTML='';
    const bpm=slow?piece.bpm*.75:piece.bpm;demo=isDemo;
    try{const scheduled=isDemo?await ctx.audio.sequence(piece.notes,bank.voices,bpm,.3):await ctx.audio.countIn(4,bpm);if(disposed||scheduled===null){controls(false);return;}startAt=scheduled;
      run=isDemo?null:beginPerformance(piece,startAt,bpm);playing=true;endAt=startAt+(piece.beats+.5)*60/bpm;raf=requestAnimationFrame(frame);
    }catch(error){controls(false);ctx.notice(String(error));}
  }
  $(ctx.host,'#perform-start').onclick=()=>void start(false);$(ctx.host,'#demo').onclick=()=>void start(true);$(ctx.host,'#perform-stop').onclick=stop;
  $(ctx.host,'#performance-bank').onchange=event=>{mine=(event.target as HTMLSelectElement).value==='mine';rebuild();};
  $(ctx.host,'#slow-practice').onchange=event=>{slow=(event.target as HTMLInputElement).checked;$(ctx.host,'#tempo').textContent=`♩ = ${Math.round(slow?piece.bpm*.75:piece.bpm)}`;};
  ctx.host.onclick=event=>{const b=(event.target as Element).closest<HTMLButtonElement>('[data-play]');if(b){const [bell,tone]=b.dataset.play!.split(':').map(Number);hit({bell,tone:tone as 0|1});}};
  const key=(event:KeyboardEvent)=>{const k=decodeKey(event);if(k){event.preventDefault();hit(k);}};window.addEventListener('keydown',key);rebuild();
  return ()=>{disposed=true;cancelAnimationFrame(raf);scene?.dispose();window.removeEventListener('keydown',key);ctx.host.onclick=null;};
}

export function mountComposer(ctx:ViewContext):Dispose {
  let composition:Composition;
  try{composition=normalizeComposition(ctx.progress.active('composer')??{id:crypto.randomUUID(),name:'未命名短句',bpm:76,beats:16,notes:[],updatedAt:Date.now()});}
  catch(error){ctx.notice(`创作草稿未能恢复：${String(error)}`);composition={id:crypto.randomUUID(),name:'未命名短句',bpm:76,beats:16,notes:[],updatedAt:Date.now()};}
  let mine=personalSetReady(ctx),snapshot=!!composition.voices,bank=composition.voices?snapshotVoices(ctx,composition.voices):currentVoices(ctx,mine),recording=false,recordStart=0,raf=0,playStart=0,playing=false,disposed=false,scene:WorkshopScene|null=null;
  ctx.host.innerHTML=`<section class="composer"><div class="composer-title"><div><h2>合乐编辑器</h2><p>每列半拍 · 点击格子写谱，或边弹边录</p></div><button data-panel-open="composition-options">作品选项</button></div>
    <div class="composer-toolbar"><label>短句名称 <input id="composition-name" maxlength="60" value="${escape(composition.name)}"/></label><label>速度 <input id="composition-bpm" type="number" min="40" max="160" value="${composition.bpm}"/> 拍/分</label><label>长度 <select id="composition-length">${[16,24,32,48].map(n=>`<option value="${n}" ${n===composition.beats?'selected':''}>${n} 拍</option>`).join('')}</select></label><label>钟组 <select id="composition-bank"><option value="reference" ${mine?'':'selected'}>示范钟组</option><option value="mine" ${mine?'selected':''}>我的钟组</option></select></label></div>
    <p id="composition-bank-status" class="muted">示范钟组 · 现代练习音列</p><div class="composer-actions"><button id="composition-play" class="primary">播放短句</button><button id="composition-record" aria-pressed="false">边弹边录</button><button id="composition-stop">停止</button><button id="composition-save">保存到档案</button><button data-panel-open="composition-ensemble">试听钟组</button></div><p id="composition-status" role="status">点格子写谱，或从下方五钟弹奏。</p><div class="piano-roll-scroll" id="roll-scroll"><div class="piano-roll" id="piano-roll"></div></div></section>
    <div class="composer-keyboard">${keyBank()}</div>
    ${panel('composition-ensemble','当前钟组','<section class="ensemble-stage composer-stage"><div id="composer-scene" class="scene"></div></section>')}
    ${panel('composition-options','作品选项','<div class="composition-options"><section><h3>短句</h3><div class="button-row"><button id="new-composition">新建短句</button><button id="composition-starter">放入一个起句</button></div><p>新建短句会重开当前草稿，已存入档案的作品仍可回开。起句来自项目原创练习，可继续修改。</p></section><section><h3>导出</h3><div class="button-row"><button id="composition-wav">导出 WAV</button><button id="composition-json">导出乐谱</button></div><p>WAV 使用当前钟组的实际合成声音；保存到档案时保留声音快照。</p></section></div>')}`;
  if(snapshot){const option=document.createElement('option');option.value='snapshot';option.textContent='草稿钟组快照';const select=$<HTMLSelectElement>(ctx.host,'#composition-bank');select.append(option);select.value='snapshot';}
  function saveDraft():void{composition.updatedAt=Date.now();composition.voices=bank.voices;ctx.progress.setActive('composer',composition);}
  function renderGrid():void{const steps=composition.beats*2;
    $(ctx.host,'#piano-roll').innerHTML=`<div class="roll-ruler" style="--steps:${steps}"><span>音位 / 拍</span>${Array.from({length:steps},(_,i)=>`<span>${i%2?'·':i/2+1}</span>`).join('')}</div>${[0,1].flatMap(tone=>[0,1,2,3,4].map(bell=>`<div class="roll-row" style="--steps:${steps}"><b>${keyLabel(bell,tone)}</b>${Array.from({length:steps},(_,i)=>{const active=composition.notes.some(n=>n.bell===bell&&n.tone===tone&&n.beat===i/2);return `<button data-grid="${bell}:${tone}:${i/2}" aria-label="${bellName(bell)}钟${toneName(tone)}第${i/2+1}拍" aria-pressed="${active}" class="${i%8===0?'barline':''}"><span></span></button>`;}).join('')}</div>`)).join('')}<div class="roll-playhead" id="roll-playhead" hidden></div>`;
  }
  function rebuild():void{bank=snapshot&&composition.voices?snapshotVoices(ctx,composition.voices):currentVoices(ctx,mine);scene?.dispose();scene=new WorkshopScene($(ctx.host,'#composer-scene'),bank.models.map((m,i)=>({model:m,cuts:bank.voices[i].cuts})),hit,undefined,ctx.notice);
    $(ctx.host,'#composition-bank-status').textContent=snapshot?'使用草稿保存时的钟组快照':mine?(bank.missing?`我的钟组：${5-bank.missing}/5 已完成，缺位使用示范钟`:'我的钟组：使用实际验律结果'):'示范钟组 · 现代练习音列';}
  function hit(key:BellKey):void{bindAudio(ctx,()=>ctx.audio.strike(bank.voices[key.bell],key.tone));scene?.flash(key);
    if(recording){const beat=Math.round((ctx.audio.time-recordStart)*composition.bpm/60*2)/2;if(beat>=0&&beat<composition.beats){if(!composition.notes.some(n=>n.bell===key.bell&&n.tone===key.tone&&n.beat===beat)){composition.notes.push({...key,beat,strength:.8});saveDraft();renderGrid();}}}
  }
  function stop():void{recording=false;playing=false;cancelAnimationFrame(raf);ctx.audio.stop();$(ctx.host,'#composition-record').setAttribute('aria-pressed','false');$(ctx.host,'#composition-status').textContent=`当前 ${composition.notes.length} 个音，草稿已保存在本机。`;$(ctx.host,'#roll-playhead').hidden=true;}
  function frame():void{if(disposed||(!playing&&!recording))return;const beat=(ctx.audio.time-(recording?recordStart:playStart))*composition.bpm/60;
    const marker=$(ctx.host,'#roll-playhead');marker.hidden=false;marker.style.left=`${96+Math.max(0,beat)*56}px`;$(ctx.host,'#composition-status').textContent=beat<0?'预备四拍，等游标进入第一列。':`${recording?'录制':'播放'} · ${Math.floor(beat)+1} / ${composition.beats} 拍`;
    if(beat>=composition.beats){stop();return;}raf=requestAnimationFrame(frame);
  }
  ctx.host.onclick=event=>{const b=(event.target as Element).closest<HTMLButtonElement>('button');if(!b)return;
    if(b.dataset.play){const [bell,tone]=b.dataset.play.split(':').map(Number);hit({bell,tone:tone as 0|1});}
    if(b.dataset.grid){const [bell,tone,beat]=b.dataset.grid.split(':').map(Number),index=composition.notes.findIndex(n=>n.bell===bell&&n.tone===tone&&n.beat===beat);
      if(index<0){composition.notes.push({bell,tone:tone as 0|1,beat,strength:.8});hit({bell,tone:tone as 0|1});}else composition.notes.splice(index,1);saveDraft();renderGrid();}
  };
  $(ctx.host,'#composition-name').oninput=event=>{composition.name=(event.target as HTMLInputElement).value||'未命名短句';saveDraft();};
  $(ctx.host,'#composition-bpm').onchange=event=>{const input=event.target as HTMLInputElement,value=Number(input.value);if(value<40||value>160||!Number.isFinite(value)){input.value=String(composition.bpm);ctx.notice('速度范围为 40—160 拍/分。');return;}stop();composition.bpm=value;saveDraft();};
  $(ctx.host,'#composition-length').onchange=event=>{stop();composition.beats=Number((event.target as HTMLSelectElement).value);composition.notes=composition.notes.filter(n=>n.beat<composition.beats);saveDraft();renderGrid();};
  $(ctx.host,'#composition-bank').onchange=event=>{stop();const value=(event.target as HTMLSelectElement).value;snapshot=value==='snapshot';mine=value==='mine';rebuild();saveDraft();};
  $(ctx.host,'#composition-play').onclick=()=>{if(!composition.notes.length){ctx.notice('先写下至少一个音。');return;}stop();bindAudio(ctx,async()=>{const scheduled=await ctx.audio.sequence(composition.notes,bank.voices,composition.bpm);if(disposed||scheduled===null)return;playStart=scheduled;playing=true;raf=requestAnimationFrame(frame);});};
  $(ctx.host,'#composition-record').onclick=()=>{if(recording){stop();return;}stop();bindAudio(ctx,async()=>{const scheduled=await ctx.audio.countIn(4,composition.bpm);if(disposed||scheduled===null)return;recordStart=scheduled;recording=true;$(ctx.host,'#composition-record').setAttribute('aria-pressed','true');raf=requestAnimationFrame(frame);});};
  $(ctx.host,'#composition-stop').onclick=stop;
  $(ctx.host,'#composition-starter').onclick=()=>{stop();composition.notes=getPiece('pulse').notes.map(n=>({...n}));saveDraft();renderGrid();$(ctx.host,'#composition-status').textContent='已放入项目原创起句。可以改音位、加停顿，再写成自己的版本。';};
  $(ctx.host,'#composition-save').onclick=()=>{if(!composition.notes.length){ctx.notice('先写下一个音，再保存作品。');return;}saveDraft();composition=normalizeComposition(composition);ctx.progress.saveComposition(composition);ctx.notice(`“${composition.name}”已存入工序档案。`);};
  $(ctx.host,'#composition-wav').onclick=()=>{if(!composition.notes.length){ctx.notice('先写下一个音。');return;}stop();download(compositionWav(composition,bank.voices),`${composition.name}.wav`,'audio/wav');ctx.notice('已导出当前钟组声音合成的 WAV。');};
  $(ctx.host,'#composition-json').onclick=()=>download(JSON.stringify({...composition,voiceSource:mine?'my-bells':'reference'},null,2),`${composition.name}.json`,'application/json');
  $(ctx.host,'#new-composition').onclick=()=>{stop();composition={id:crypto.randomUUID(),name:'未命名短句',bpm:76,beats:16,notes:[],updatedAt:Date.now()};$<HTMLInputElement>(ctx.host,'#composition-name').value=composition.name;$<HTMLInputElement>(ctx.host,'#composition-bpm').value=String(composition.bpm);$<HTMLSelectElement>(ctx.host,'#composition-length').value=String(composition.beats);saveDraft();renderGrid();};
  const key=(event:KeyboardEvent)=>{const k=decodeKey(event);if(k){event.preventDefault();hit(k);}};window.addEventListener('keydown',key);renderGrid();rebuild();
  return ()=>{disposed=true;cancelAnimationFrame(raf);scene?.dispose();window.removeEventListener('keydown',key);ctx.host.onclick=null;};
}
