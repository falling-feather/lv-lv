import { UNITS } from './content.ts';
import { BellModel } from './game.ts';
import { $,bindAudio,currentVoices,download,escape,heading,signed,pageSlice,pageControls,type ViewContext,type Dispose } from './ui.ts';
import { compositionWav } from './sound.ts';
export function mountArchive(ctx:ViewContext):Dispose {
  const p=ctx.progress.data,completed=UNITS.filter(u=>p.completed[u.id]).map(u=>({unit:u,result:p.completed[u.id]})),bells=[...p.bells].reverse(),pageSize=5;
  let resultPage=0,compositionPage=0,stepPage=0,bellIndex=0;
  ctx.host.innerHTML=`${heading('本机手记','工序档案','回听真实工序，重播自己留下的短句；长记录按页查看。')}
  <div class="archive-toolbar"><span>累计活跃约 ${Math.floor(p.activeSeconds/60)} 分钟 · 不作为真人用时验证</span><button id="export-progress">导出完整档案</button><label class="file-button">导入档案<input id="import-progress" type="file" accept="application/json,.json"/></label>${ctx.progress.error?'<button id="export-original">保留原存档</button>':''}</div>
  <div class="archive-tabs" role="tablist" aria-label="档案分类"><button role="tab" data-archive-tab="results" aria-selected="true" aria-controls="archive-results">委托记录</button><button role="tab" data-archive-tab="bells" aria-selected="false" aria-controls="archive-bells">已验律的钟</button><button role="tab" data-archive-tab="compositions" aria-selected="false" aria-controls="archive-compositions">原创短句</button></div>
  <div class="archive-panels"><section class="archive-section" id="archive-results" role="tabpanel"><div class="section-label"><h2>委托记录</h2><span>${completed.length} / 36</span></div><div class="result-list" id="result-list"></div><div id="result-pages"></div></section>
  <section class="archive-section" id="archive-bells" role="tabpanel" hidden><div class="section-label"><h2>已验律的钟</h2><span>${bells.length} 件</span></div>${bells.length?`<label class="archive-select">选择器物 <select id="archive-bell">${bells.map((b,i)=>`<option value="${i}">${escape(b.name)} · 委托 ${b.unitId}</option>`).join('')}</select></label><div id="bell-record"></div>`:'<p class="empty-note">验律完成后，这里保留加工前后声音和逐步工序。</p>'}</section>
  <section class="archive-section" id="archive-compositions" role="tabpanel" hidden><div class="section-label"><h2>原创短句</h2><a href="#/music?tab=compose" class="text-link">继续创作 ↗</a></div><div class="composition-list" id="composition-list"></div><div id="composition-pages"></div></section></div>`;
  function renderResults():void{const window=pageSlice(completed,resultPage,pageSize);resultPage=window.page;
    $(ctx.host,'#result-list').innerHTML=window.items.length?window.items.map(({unit:u,result:r})=>`<a href="#/unit/${u.id}"><span>${u.id}</span><b>${escape(u.title)}</b><span>${r.score} 分${r.assisted?' · 辅助':''}</span><small>${new Date(r.completedAt).toLocaleDateString('zh-CN')}</small></a>`).join(''):'<div class="empty-note"><h3>第一笔记录，从一口钟开始。</h3><p>完成一份委托后，这里留下实际结果。</p><a class="text-link" href="#/commissions">去选一件 ↗</a></div>';
    $(ctx.host,'#result-pages').innerHTML=pageControls('results',window);
  }
  function renderCompositions():void{const window=pageSlice(p.compositions.map((c,index)=>({c,index})),compositionPage,pageSize);compositionPage=window.page;
    $(ctx.host,'#composition-list').innerHTML=window.items.length?window.items.map(({c,index:i})=>`<article><span class="small-label">${c.bpm} 拍/分 · ${c.beats} 拍 · ${c.notes.length} 音</span><h3>${escape(c.name)}</h3><div class="button-row"><button data-composition-play="${i}">试听</button><button data-composition-edit="${i}">继续修改</button><button data-composition-wav="${i}">导出 WAV</button></div></article>`).join(''):'<p class="empty-note">保存的短句会出现在这里。</p>';
    $(ctx.host,'#composition-pages').innerHTML=pageControls('compositions',window);
  }
  function renderBell():void{const b=bells[bellIndex],m=new BellModel(ctx.atlas,b.spec),window=pageSlice(b.session.history.map((r,index)=>({r,index})),stepPage,pageSize);stepPage=window.page;
    $(ctx.host,'#bell-record').innerHTML=`<div class="bell-record"><div><h3>${escape(b.name)}</h3><p>加工 ${b.session.history.length-1} 次 · 模拟去料 ${m.removedGrams(b.cuts).toFixed(1)} g · ${b.session.assisted?'借助辅助':'独立完成'}</p><div class="button-row"><button data-record-play="before:0">修前正鼓</button><button data-record-play="before:1">修前侧鼓</button><button data-record-play="after:0">合律正鼓</button><button data-record-play="after:1">合律侧鼓</button></div></div><div><div class="record-timeline">${window.items.map(({r,index:i})=>`<button data-history="${i}" aria-label="回听第${i}步正鼓与侧鼓"><span>${String(i).padStart(2,'0')}</span><b>${r.zone===null?'接手状态':`${ctx.atlas.zoneNames[r.zone]} · ${r.amount}格`}</b><small>${m.errors(r.cuts).map(signed).join(' / ')} 音分</small></button>`).join('')}</div>${pageControls('steps',window)}</div><p class="muted" id="replay-note">选择工序，依次回听该状态的两音。回看不把材料补回，也不改写实际工序。</p></div>`;
  }
  if(bells.length){renderBell();$(ctx.host,'#archive-bell').onchange=event=>{ctx.audio.stop();bellIndex=Number((event.target as HTMLSelectElement).value);stepPage=0;renderBell();};}
  $(ctx.host,'#export-progress').onclick=()=>download(ctx.progress.export(),'律吕-工序档案.json','application/json');
  const original=ctx.host.querySelector<HTMLButtonElement>('#export-original');if(original)original.onclick=()=>{try{download(ctx.progress.exportOriginal(),'律吕-原始存档.json','application/json');}catch(error){ctx.notice(`原存档读取失败：${String(error)}`);}};
  $(ctx.host,'#import-progress').onchange=event=>{const file=(event.target as HTMLInputElement).files?.[0];if(!file)return;void file.text().then(text=>{ctx.progress.import(text);ctx.notice('档案已合并，完成记录与作品已保留。');location.hash='/archive?imported='+Date.now();}).catch(error=>ctx.notice(`导入失败：${String(error)}`));};
  ctx.host.onclick=event=>{const b=(event.target as Element).closest<HTMLButtonElement>('button');if(!b)return;
    if(b.dataset.archiveTab){ctx.audio.stop();ctx.host.querySelectorAll<HTMLElement>('[data-archive-tab]').forEach(t=>t.setAttribute('aria-selected',String(t===b)));ctx.host.querySelectorAll<HTMLElement>('[role=tabpanel]').forEach(panel=>panel.hidden=panel.id!==`archive-${b.dataset.archiveTab}`);}
    if(b.dataset.pageGroup){ctx.audio.stop();const delta=Number(b.dataset.pageDelta);if(b.dataset.pageGroup==='results'){resultPage+=delta;renderResults();}else if(b.dataset.pageGroup==='compositions'){compositionPage+=delta;renderCompositions();}else if(b.dataset.pageGroup==='steps'){stepPage+=delta;renderBell();}return;}
    if(b.dataset.compositionPlay!==undefined){const c=p.compositions[Number(b.dataset.compositionPlay)];bindAudio(ctx,()=>ctx.audio.sequence(c.notes,c.voices??currentVoices(ctx).voices,c.bpm));}
    if(b.dataset.compositionEdit!==undefined){ctx.progress.setActive('composer',p.compositions[Number(b.dataset.compositionEdit)]);location.hash='/music?tab=compose';}
    if(b.dataset.compositionWav!==undefined){const c=p.compositions[Number(b.dataset.compositionWav)];download(compositionWav(c,c.voices??currentVoices(ctx).voices),`${c.name}.wav`,'audio/wav');}
    if(b.dataset.recordPlay||b.dataset.history!==undefined){const saved=bells[bellIndex],m=new BellModel(ctx.atlas,saved.spec);
      if(b.dataset.recordPlay){const [when,t]=b.dataset.recordPlay.split(':');bindAudio(ctx,()=>ctx.audio.strike(m.voice(when==='before'?saved.spec.initial:saved.cuts),Number(t) as 0|1));}
      else{const step=saved.session.history[Number(b.dataset.history)],state=m.voice(step.cuts);bindAudio(ctx,()=>ctx.audio.clips([{kind:'strike',state,tone:0},{kind:'strike',state,tone:1}],[]));$(ctx.host,'#replay-note').textContent=`正在回听第 ${b.dataset.history} 步：${m.errors(step.cuts).map(signed).join(' / ')} 音分。`;}
    }
  };renderResults();renderCompositions();return ()=>{ctx.host.onclick=null;};
}
