import { CATALOG_PARTS,UNITS,CHAPTERS,WORKSHOP_ROUTE,recommendedUnit,intervalPair,intervalSize,type IntervalReference,type Unit } from './content.ts';
import { WorkshopScene } from './scene.ts';
import { makeEarQuestion,diagnosisCase,arrangement,validateArrangement,type Clip } from './practice.ts';
import { $,bindAudio,currentVoices,escape,heading,unitHeading,toneName,bellName,idle,workspaceSwitch,personalSetReady,pageSlice,pageControls,type ViewContext,type Dispose } from './ui.ts';
import type { BellKey } from './content.ts';

export function mountHome(ctx:ViewContext):Dispose {
  const completed=Object.keys(ctx.progress.data.completed).length,next=recommendedUnit(ctx.progress.data.completed);
  const previous=ctx.progress.data.lastUnit,resume=previous?UNITS.find(u=>u.id===previous&&ctx.progress.data.active[previous]):undefined;
  const target=resume??next;
  ctx.host.innerHTML=`${heading('律吕 · 双音编钟工坊','选择一道工序','观察、听辨、磨修，再把五口钟编成一段合乐。',`<span class="lobby-progress">${completed}<small> / 36 关</small></span>`)}
  <nav class="journey-strip" aria-label="推荐研习路线">${WORKSHOP_ROUTE.map((step,i)=>`<a href="#/unit/${step.unitId}" title="${step.decision}" class="${ctx.progress.data.completed[step.unitId]?'done':''}"><span>${i+1}</span>${step.label}<small>${ctx.progress.data.completed[step.unitId]?'✓':'→'}</small></a>`).join('')}</nav>
  <div class="lobby"><section class="lobby-object"><div class="lobby-object-label"><span class="small-label">甬钟习作</span><button class="text-button" data-panel-open="workshop-guide">器物与声音依据 ↗</button></div><div class="lobby-specimen"><img src="${import.meta.env.BASE_URL}models/bell-study.png" alt="自主建模的甬钟，具有长甬、分组钟枚、纹带和弧形口沿"/></div><div class="lobby-free"><a href="#/free" class="secondary">自由磨修</a><a href="#/music?tab=compose" class="secondary">自由合乐</a><a href="#/archive" class="text-link">查看我的档案 ↗</a></div></section>
  <section class="lobby-selection"><div class="lobby-chapters">${CHAPTERS.map(c=>{const units=UNITS.filter(u=>u.chapter===c.id),done=units.filter(u=>ctx.progress.data.completed[u.id]).length;return `<a href="#/commissions?chapter=${c.id}" class="lobby-chapter"><div><span class="chapter-number">${String(c.id).padStart(2,'0')}</span><small>${done} / ${units.length}</small></div><h2>${c.name}</h2><p>${c.summary}</p><span class="chapter-meter"><i style="width:${done/units.length*100}%"></i></span></a>`;}).join('')}</div>
  <div class="lobby-continue"><div><span class="small-label">${resume?'继续上次的工序':next?'建议从这里开始':'六阶段已完成'}</span><h2>${target?`${target.id} · ${target.title}`:'留下自己的合乐'}</h2><p>${ctx.progress.data.bells.length} 件已验律 · ${ctx.progress.data.compositions.length} 份短句</p></div><a class="primary" href="${target?`#/unit/${target.id}`:'#/music?tab=compose'}">${resume?'继续':next?'进入关卡':'自由创作'} ↗</a></div></section></div>`;
  return idle;
}
export function mountCommissions(ctx:ViewContext,chapter=0,kind=''):Dispose {
  const matching=UNITS.filter(u=>!kind||['ear','diagnose'].includes(u.kind));
  const available=CHAPTERS.filter(c=>matching.some(u=>u.chapter===c.id));
  const next=matching.find(u=>!ctx.progress.data.completed[u.id])??matching[0];
  let selected=available.some(c=>c.id===chapter)?chapter:next.chapter;
  ctx.host.innerHTML=`${heading(kind?'听辨训练':'委托关卡',kind?'选一组训练':'选择关卡','每一阶段引入新的判断。各关均可直接进入，工序会自动保存。')}
  <div class="commission-browser"><nav class="chapter-sidebar" id="chapter-filter" aria-label="选择阶段">${available.map(c=>`<button data-chapter="${c.id}" aria-pressed="${c.id===selected}"><span>${String(c.id).padStart(2,'0')}</span><b>${c.name}</b><small>${matching.filter(u=>u.chapter===c.id&&ctx.progress.data.completed[u.id]).length} / ${matching.filter(u=>u.chapter===c.id).length}</small></button>`).join('')}</nav><div id="commission-body" class="commission-body"></div></div>`;
  const render=()=>{const c=CHAPTERS.find(c=>c.id===selected)!,units=matching.filter(u=>u.chapter===selected);
    $(ctx.host,'#commission-body').innerHTML=`<div class="chapter-heading"><span>${String(c.id).padStart(2,'0')}</span><div><h2>${c.name}</h2><p>${c.summary}</p></div></div><div class="commission-list">${units.map(u=>{const result=ctx.progress.data.completed[u.id],active=ctx.progress.data.active[u.id];return `<a href="#/unit/${u.id}" class="commission-row"><span class="unit-number">${u.id}</span><div><h3>${u.title}</h3><p>${u.purpose}</p></div><span class="task-kind">${({inspect:'识器',ear:'听辨',tune:'调律',diagnose:'诊断',assemble:'成编',perform:'演奏'})[u.kind]}</span><span class="unit-state ${result?'done':''}">${result?`${result.score} 分${result.assisted?' · 辅助':''}`:active?'继续工序':'开始'}</span><span class="row-arrow">↗</span></a>`;}).join('')}</div>`;
  };
  $(ctx.host,'#chapter-filter').onclick=event=>{const b=(event.target as Element).closest<HTMLButtonElement>('[data-chapter]');if(!b)return;selected=Number(b.dataset.chapter);ctx.host.querySelectorAll('[data-chapter]').forEach(n=>n.setAttribute('aria-pressed',String(n===b)));render();};render();return idle;
}
export function mountCatalog(ctx:ViewContext,unit?:Extract<Unit,{kind:'inspect'}>):Dispose {
  const start=Date.now(),saved=unit?ctx.progress.active<{parts:string[];heard:boolean[]}>(unit.id):undefined;
  const parts=new Set(saved?.parts??[]),heard=saved?.heard??[false,false];let active=0,section=false,mode=false,pairBusy=false,disposed=false;
  const {models}=currentVoices(ctx),model=models[2];
  ctx.host.innerHTML=`${unit?unitHeading(unit):heading('器物研究','转动它，听见两声。','选择部位观察，敲击正鼓与侧鼓，比较同一钟体的两个音位。')}
  <div class="catalog-layout"><section class="object-stage"><div class="stage-title"><span class="small-label">结构观察</span><span class="folio">甬钟</span></div><div class="stage-actions"><button id="catalog-section" aria-pressed="false">剖开钟壁</button><button id="catalog-mode" aria-pressed="false">观察振形</button></div><div class="scene" id="catalog-scene"></div><div class="stage-base"><span>拖动旋转 · 点击音位敲击</span><span id="observed-count"></span></div></section>
  <aside class="catalog-notes"><div class="catalog-tabs"><button data-catalog-tab="parts" aria-pressed="true">认器</button><button data-catalog-tab="interval" aria-pressed="false">音程听窗</button></div><div id="catalog-parts" class="catalog-parts"><div class="catalog-index">${CATALOG_PARTS.map((p,i)=>`<button data-part="${i}" aria-pressed="${i===0}"><span>${String(i+1).padStart(2,'0')}</span><b>${p.name}</b><small>${p.label}</small><i data-seen="${p.id}"></i></button>`).join('')}</div><div class="observation"><span id="part-label" class="small-label"></span><h2 id="part-name"></h2><p id="part-text"></p><p class="muted" id="catalog-heard"></p><div class="button-row"><button data-hit="0">敲正鼓 <kbd>1</kbd></button><button data-hit="1">敲侧鼓 <kbd>2</kbd></button></div></div></div><section id="catalog-interval" class="interval-lab" hidden><span class="small-label">同一口钟 · 两个敲位</span><h2>两声相隔多远？</h2><div class="interval-pitches"><span>正鼓<b id="interval-low"></b></span><span>侧鼓<b id="interval-high"></b></span></div><p id="interval-size"></p><button id="catalog-pair" class="primary">依次听本钟两音</button><div class="interval-controls"><select id="interval-reference" aria-label="音程参照"><option value="model">模型音高 · 纯音对照</option><option value="minor">小三度参照 · 300 音分</option><option value="major">大三度参照 · 400 音分</option></select><button id="interval-play">听参照</button></div><p class="muted">参照统一用纯音比较间隔；300/400 音分为现代十二平均律参照，不改变模型，不作古代定音复原。</p></section></aside></div>
  <div class="task-message"><span class="stamp">识器</span><div><b>${unit?'观察六个部位，并分别敲击两个音位。':'从钟口和两个敲位，理解同一钟体。'}</b><p>圆点标记已观察部位，资料可以随时打开查看。</p></div><button data-panel-open="workshop-guide">器物资料</button>${unit?'<button id="catalog-finish" class="primary">完成观察 ↗</button>':''}</div>`;
  workspaceSwitch($(ctx.host,'.catalog-layout'),$(ctx.host,'.object-stage'),$(ctx.host,'.catalog-notes'),['观察钟体','选择部位']);
  const scene=new WorkshopScene($(ctx.host,'#catalog-scene'),[{model,cuts:model.spec.target}],key=>hit(key.tone),undefined,ctx.notice);
  function update():void{const part=CATALOG_PARTS[active];$(ctx.host,'#part-label').textContent=part.label;$(ctx.host,'#part-name').textContent=part.name;$(ctx.host,'#part-text').textContent=part.text;
    $(ctx.host,'#observed-count').textContent=`${parts.size} / 6 处已观察`;$(ctx.host,'#catalog-heard').textContent=`正鼓${heard[0]?'已听':'待听'} · 侧鼓${heard[1]?'已听':'待听'}`;
    ctx.host.querySelectorAll<HTMLElement>('[data-seen]').forEach(n=>n.textContent=parts.has(n.dataset.seen!)?'●':'○');
    if(unit)ctx.progress.setActive(unit.id,{parts:[...parts],heard});
  }
  const catalogVoice=model.voice(model.spec.target),size=intervalSize(catalogVoice);
  $(ctx.host,'#interval-low').textContent=`${catalogVoice.frequencies[0].toFixed(1)} Hz`;
  $(ctx.host,'#interval-high').textContent=`${catalogVoice.frequencies[1].toFixed(1)} Hz`;
  $(ctx.host,'#interval-size').textContent=`模型音程 ${size.toFixed(1)} 音分。对照 300 与 400 音分，比较你听到的距离。`;
  async function playPair():Promise<void>{if(pairBusy)return;pairBusy=true;const button=$(ctx.host,'#catalog-pair');button.textContent='正在听正鼓 → 侧鼓…';
    try{const played=await ctx.audio.clips([{kind:'strike',state:catalogVoice,tone:0},{kind:'strike',state:catalogVoice,tone:1}],[]);if(disposed)return;if(played){heard[0]=true;heard[1]=true;update();}}
    finally{pairBusy=false;if(!disposed)button.textContent='依次听本钟两音';}}
  $(ctx.host,'#catalog-pair').onclick=()=>bindAudio(ctx,playPair);
  $(ctx.host,'#interval-play').onclick=()=>{const reference=$<HTMLSelectElement>(ctx.host,'#interval-reference').value as IntervalReference;
    const f=intervalPair(catalogVoice,reference);bindAudio(ctx,()=>ctx.audio.clips(f.map(frequency=>({kind:'tone' as const,frequency})),[]));};
  function hit(tone:0|1):void{bindAudio(ctx,()=>ctx.audio.strike(model.voice(model.spec.target),tone));scene.flash({bell:0,tone});heard[tone]=true;update();}
  ctx.host.onclick=event=>{const b=(event.target as Element).closest<HTMLButtonElement>('button');if(!b)return;
    if(b.dataset.catalogTab){ctx.host.querySelectorAll('[data-catalog-tab]').forEach(t=>t.setAttribute('aria-pressed',String(t===b)));$(ctx.host,'#catalog-parts').hidden=b.dataset.catalogTab!=='parts';$(ctx.host,'#catalog-interval').hidden=b.dataset.catalogTab!=='interval';}
    if(b.dataset.part!==undefined){active=Number(b.dataset.part);parts.add(CATALOG_PARTS[active].id);scene.focusPart(active);ctx.host.querySelectorAll('[data-part]').forEach(n=>n.setAttribute('aria-pressed',String(n===b)));update();}
    if(b.dataset.hit!==undefined)hit(Number(b.dataset.hit) as 0|1);
  };
  $(ctx.host,'#catalog-section').onclick=()=>{section=!section;scene.setSection(section);$(ctx.host,'#catalog-section').setAttribute('aria-pressed',String(section));};
  $(ctx.host,'#catalog-mode').onclick=()=>{mode=!mode;scene.setMode(mode);$(ctx.host,'#catalog-mode').setAttribute('aria-pressed',String(mode));};
  if(unit)$(ctx.host,'#catalog-finish').onclick=()=>{if(parts.size<6||!heard.every(Boolean)){ctx.notice('还有部位或音位尚未观察。');return;}ctx.complete(unit,100,false,start);};
  parts.add(CATALOG_PARTS[0].id);update();return ()=>{disposed=true;scene.dispose();ctx.host.onclick=null;};
}
interface EarState {round:number;firstCorrect:number;wrong:boolean;answered:boolean;heard:number[];started:number}
export function mountEar(ctx:ViewContext,unit:Extract<Unit,{kind:'ear'}>):Dispose {
  let saved=ctx.progress.active<EarState>(unit.id),s:EarState=saved&&saved.round<unit.rounds?saved:{round:0,firstCorrect:0,wrong:false,answered:false,heard:[],started:Date.now()},disposed=false,busy=false;
  const voices=currentVoices(ctx).voices;
  ctx.host.innerHTML=`${unitHeading(unit)}<div class="ear-layout"><section class="ear-work"><div class="exercise-progress"><span>听辨练习</span><b id="ear-round"></b></div><div id="ear-question"></div><p id="ear-feedback" class="exercise-feedback" role="status"></p><button id="ear-next" class="primary" hidden>下一题 ↗</button></section><aside class="margin-note"><span class="note-number">听</span><h2>给耳朵一点依据</h2><p>先听参照，再听每个候选。可以重复播放，回答前不限制试听次数。</p><p>答错后保留解释，可以再辨一次。成绩记录首次判断的正确率。</p><div class="listening-lines"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><a href="#/catalog" class="text-link">回到器物，找找音位 ↗</a></aside></div>`;
  function save():void{ctx.progress.setActive(unit.id,s);}
  function render():void{const q=makeEarQuestion(ctx.atlas,unit,s.round);$(ctx.host,'#ear-round').textContent=`${s.round+1} / ${unit.rounds}`;
    $(ctx.host,'#ear-question').innerHTML=`<h2>${q.prompt}</h2>${q.reference.length?`<div class="reference-audio"><span>参照</span><button data-audio="-1">${unit.lesson==='position'?'依次听正鼓、侧鼓':'听参照'}</button><small>${s.heard.includes(-1)?'已听':'待听'}</small></div>`:''}<div class="sample-list">${q.samples.map((_,i)=>`<div><span>${q.samples.length>1?`候选${['甲','乙','丙'][i]}`:'待辨声'}</span><button data-audio="${i}">点击试听</button><small>${s.heard.includes(i)?'已听':'待听'}</small></div>`).join('')}</div><div class="answer-options">${q.labels.map((label,i)=>`<button data-answer="${i}" ${s.answered?'disabled':''}>${label}</button>`).join('')}</div>`;
    $(ctx.host,'#ear-feedback').textContent=s.answered?`判断正确。${q.explanation}`:'';$(ctx.host,'#ear-next').hidden=!s.answered;
    $(ctx.host,'#ear-next').textContent=s.round===unit.rounds-1?'完成本项听辨 ↗':'下一题 ↗';
  }
  ctx.host.onclick=event=>{const b=(event.target as Element).closest<HTMLButtonElement>('button');if(!b)return;const q=makeEarQuestion(ctx.atlas,unit,s.round);
    if(b.dataset.audio!==undefined&&!busy){const index=Number(b.dataset.audio),clips=index===-1?q.reference:q.samples[index];busy=true;b.textContent='正在试听…';bindAudio(ctx,async()=>{try{const heard=await ctx.audio.clips(clips,voices);if(disposed)return;if(heard)s.heard=[...new Set([...s.heard,index])];save();render();}finally{busy=false;}});}
    if(b.dataset.answer!==undefined&&!s.answered){const required=q.samples.map((_,i)=>i);if(q.reference.length)required.push(-1);
      if(!required.every(n=>s.heard.includes(n))){ctx.notice('先把参照与每个候选都听过，再作判断。');return;}
      if(Number(b.dataset.answer)===q.correct){if(!s.wrong)s.firstCorrect++;s.answered=true;save();render();}
      else{s.wrong=true;save();$(ctx.host,'#ear-feedback').textContent=`这次没有吻合。${q.explanation} 再听一遍后重选。`;}
    }
  };
  $(ctx.host,'#ear-next').onclick=()=>{if(s.round===unit.rounds-1){ctx.complete(unit,Math.round(s.firstCorrect/unit.rounds*100),false,s.started);$(ctx.host,'#ear-next').hidden=true;return;}
    s={...s,round:s.round+1,wrong:false,answered:false,heard:[]};save();render();};render();return ()=>{disposed=true;ctx.host.onclick=null;};
}
export function mountDiagnosis(ctx:ViewContext,unit:Extract<Unit,{kind:'diagnose'}>):Dispose {
  type State={round:number;correct:number;wrong:boolean;answered:boolean;heard:boolean[];started:number};
  const saved=ctx.progress.active<State>(unit.id);let s:State=saved&&saved.round<unit.rounds?saved:{round:0,correct:0,wrong:false,answered:false,heard:[false,false],started:Date.now()};
  ctx.host.innerHTML=`${unitHeading(unit)}<div class="diagnosis-layout"><section class="case-sheet"><div class="section-label"><h2>返修记录</h2><b id="case-count"></b></div><div id="case-body"></div><div class="answer-options"><button data-decision="yes">继续磨修</button><button data-decision="no">换一件钟坯</button></div><p id="case-feedback" role="status"></p><button id="case-next" class="primary" hidden>下一件 ↗</button></section><aside class="margin-note"><span class="note-number">判</span><h2>先判断，再动手</h2><p>去除的材料不会自动长回来。先确认现有工序、两音目标和剩余预算。</p><p>“换坯”指本关提供的加工范围内不可达，不是对真实文物修复的判断。</p></aside></div>`;
  const save=()=>ctx.progress.setActive(unit.id,s);
  function render():void{const c=diagnosisCase(ctx.atlas,unit.seed,s.round),m=c.model,v=m.voice(m.spec.initial),t=m.voice(m.spec.target);
    $(ctx.host,'#case-count').textContent=`${s.round+1} / ${unit.rounds}`;
    $(ctx.host,'#case-body').innerHTML=`<p class="lead">${c.description}</p><dl class="case-facts"><div><dt>已加工格数</dt><dd>甲 ${m.spec.initial[0]} / 乙 ${m.spec.initial[1]} / 丙 ${m.spec.initial[2]}</dd></div><div><dt>每区上限</dt><dd>5 格</dd></div><div><dt>本单剩余预算</dt><dd>${m.spec.unitBudget===null?'不额外限制':`${m.spec.unitBudget} 格`}</dd></div></dl><table class="readout-table"><thead><tr><th>音位</th><th>当前</th><th>目标</th><th>允许误差</th></tr></thead><tbody>${[0,1].map(i=>`<tr><td>${toneName(i)}</td><td>${v.frequencies[i].toFixed(1)} Hz</td><td>${t.frequencies[i].toFixed(1)} Hz</td><td>±5 音分</td></tr>`).join('')}</tbody></table><div class="button-row">${[0,1].map(i=>`<button data-case-listen="${i}">听${toneName(i)}当前→目标 ${s.heard[i]?'✓':''}</button>`).join('')}</div>`;
    $(ctx.host,'#case-next').hidden=!s.answered;ctx.host.querySelectorAll<HTMLButtonElement>('[data-decision]').forEach(b=>b.disabled=s.answered);$(ctx.host,'#case-feedback').textContent=s.answered?(c.repairable?'判断正确：仍存在不反向加料的可行工序。':'判断正确：本单给定边界与预算内已经不可达。'):'';
  }
  ctx.host.onclick=event=>{const b=(event.target as Element).closest<HTMLButtonElement>('button');if(!b)return;const c=diagnosisCase(ctx.atlas,unit.seed,s.round);
    if(b.dataset.caseListen!==undefined){const tone=Number(b.dataset.caseListen) as 0|1;bindAudio(ctx,()=>ctx.audio.compare(c.model.voice(c.model.spec.initial).frequencies[tone],c.model.voice(c.model.spec.target).frequencies[tone]));s.heard[tone]=true;save();render();}
    if(b.dataset.decision&&!s.answered){if(!s.heard.every(Boolean)){ctx.notice('先核对两音的当前与目标。');return;}if((b.dataset.decision==='yes')===c.repairable){if(!s.wrong)s.correct++;s.answered=true;save();render();}else{s.wrong=true;save();$(ctx.host,'#case-feedback').textContent='再核对一次现有工序与预算。仅一音接近，不代表两音可以同时完成。';}}
  };
  $(ctx.host,'#case-next').onclick=()=>{if(s.round===unit.rounds-1){ctx.complete(unit,Math.round(s.correct/unit.rounds*100),false,s.started);$(ctx.host,'#case-next').hidden=true;return;}s={...s,round:s.round+1,wrong:false,answered:false,heard:[false,false]};save();render();};render();return ()=>{ctx.host.onclick=null;};
}
export function mountAssembly(ctx:ViewContext,unit:Extract<Unit,{kind:'assemble'}>):Dispose {
  type Saved={selection:(BellKey|null)[];page?:number;bank?:'reference'|'mine'};
  const saved=ctx.progress.active<Saved>(unit.id),started=Date.now();let assignmentPage=saved?.page??0;
  let mine=saved?saved.bank==='mine':personalSetReady(ctx),bank=currentVoices(ctx,mine),a=arrangement(ctx.atlas,unit.arrangement,bank.voices),scene:WorkshopScene|null=null;
  let selection=saved?.selection?.length===a.goals.length?saved.selection:a.goals.map(()=>null);
  ctx.host.innerHTML=`${unitHeading(unit)}<div class="assembly-layout"><section class="assembly-sheet"><div class="section-label"><h2>${a.name}</h2><span>最多 ${a.maxBells} 口钟</span></div><label class="bank-picker">使用钟组<select id="assembly-bank"><option value="reference" ${mine?'':'selected'}>示范钟组</option><option value="mine" ${mine?'selected':''}>我的钟组</option></select></label><p id="assembly-bank-status"></p><p>${a.description}</p><div class="assembly-slots" id="assembly-slots"></div><div id="assignment-pages"></div><div id="assembly-pairs" class="assembly-pairs" aria-live="polite"></div><p id="assembly-result" role="status"></p><button id="assembly-check" class="primary">核对这组音位 ↗</button></section><section class="ensemble-stage"><div class="stage-title"><h2>待编五钟</h2><p>同一口钟的正、侧音位可以各承担一个位置。点击试听，也可拖入参照位。</p></div><div id="assembly-scene" class="scene"></div><div class="key-bank">${bank.voices.flatMap((_,bell)=>[0,1].map(tone=>`<button draggable="true" data-key="${bell}:${tone}">${bellName(bell)}钟 · ${toneName(tone)}</button>`)).join('')}</div></section></div>`;
  workspaceSwitch($(ctx.host,'.assembly-layout'),$(ctx.host,'.ensemble-stage'),$(ctx.host,'.assembly-sheet'),['敲钟试听','安排音位']);
  function rebuild():void{bank=currentVoices(ctx,mine);a=arrangement(ctx.atlas,unit.arrangement,bank.voices);scene?.dispose();
    scene=new WorkshopScene($(ctx.host,'#assembly-scene'),bank.models.map((m,i)=>({model:m,cuts:bank.voices[i].cuts})),hit,undefined,ctx.notice);
    $(ctx.host,'#assembly-bank-status').textContent=mine?(bank.missing?`个人 ${5-bank.missing}/5 口 · 缺位借用示范钟`:'你的五钟 · 保留实际验律误差'):'示范钟组 · 可先练习听辨排位';render();}
  function hit(key:BellKey):void{bindAudio(ctx,()=>ctx.audio.strike(bank.voices[key.bell],key.tone));scene?.flash(key);}
  function render():void{const window=pageSlice(a.goals.map((hz,index)=>({hz,index})),assignmentPage,2);assignmentPage=window.page;$(ctx.host,'#assignment-pages').innerHTML=pageControls('assignment',window);$(ctx.host,'#assembly-slots').innerHTML=window.items.map(({index:i})=>`<div class="assembly-slot" data-slot="${i}"><b>参照 ${i+1}</b><button data-goal="${i}">听参照</button><select data-choice="${i}" aria-label="参照${i+1}的音位"><option value="">选择音位</option>${bank.voices.flatMap((_,bell)=>[0,1].map(tone=>`<option value="${bell}:${tone}" ${selection[i]?.bell===bell&&selection[i]?.tone===tone?'selected':''}>${bellName(bell)}钟 · ${toneName(tone)}</option>`)).join('')}</select><button data-selected="${i}" ${selection[i]?'':'disabled'}>听所选</button></div>`).join('');
    const assigned=selection.filter((k):k is BellKey=>k!==null),used=[...new Set(assigned.map(k=>k.bell))];
    $(ctx.host,'#assembly-pairs').innerHTML=`<b>已排 ${assigned.length}/${a.goals.length} 位 · 用钟 ${used.length}/${a.maxBells}</b><div>${used.map(bell=>`<span>${bellName(bell)}钟 → ${[...new Set(assigned.filter(k=>k.bell===bell).map(k=>toneName(k.tone)))].join('＋')}</span>`).join('')}</div>`;
  }
  const save=()=>ctx.progress.setActive(unit.id,{selection,page:assignmentPage,bank:mine?'mine':'reference'});
  const set=(i:number,value:string)=>{const [bell,tone]=value.split(':').map(Number);selection[i]=value?{bell,tone:tone as 0|1}:null;save();render();};
  ctx.host.onclick=event=>{const b=(event.target as Element).closest<HTMLButtonElement>('button');if(!b)return;
    if(b.dataset.pageGroup==='assignment'){assignmentPage+=Number(b.dataset.pageDelta);render();save();return;}
    if(b.dataset.key){const [bell,tone]=b.dataset.key.split(':').map(Number);hit({bell,tone:tone as 0|1});}
    if(b.dataset.goal!==undefined)bindAudio(ctx,()=>ctx.audio.clips([{kind:'tone',frequency:a.goals[Number(b.dataset.goal)]}],bank.voices));
    if(b.dataset.selected!==undefined){const key=selection[Number(b.dataset.selected)];if(key)hit(key);}
  };
  ctx.host.onchange=event=>{const select=event.target as HTMLSelectElement;if(select.id==='assembly-bank'){mine=select.value==='mine';save();$(ctx.host,'#assembly-result').textContent='已切换钟组，请重新核对参照。';rebuild();return;}if(select.dataset.choice!==undefined)set(Number(select.dataset.choice),select.value);};
  ctx.host.ondragstart=event=>{const b=(event.target as Element).closest<HTMLElement>('[data-key]');if(b)event.dataTransfer?.setData('text/plain',b.dataset.key!);};
  ctx.host.ondragover=event=>{if((event.target as Element).closest('[data-slot]'))event.preventDefault();};
  ctx.host.ondrop=event=>{const slot=(event.target as Element).closest<HTMLElement>('[data-slot]'),value=event.dataTransfer?.getData('text/plain');if(slot&&value&&/^[0-4]:[01]$/.test(value)){event.preventDefault();set(Number(slot.dataset.slot),value);}};
  $(ctx.host,'#assembly-check').onclick=()=>{const result=validateArrangement(a.goals,selection,bank.voices,a.maxBells);$(ctx.host,'#assembly-result').textContent=result.message;if(result.ok)ctx.complete(unit,100,mine&&bank.missing>0,started);};rebuild();
  return ()=>{scene?.dispose();ctx.host.onclick=null;ctx.host.onchange=null;ctx.host.ondragstart=null;ctx.host.ondragover=null;ctx.host.ondrop=null;};
}
