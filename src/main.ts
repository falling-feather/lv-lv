import './style.css';
import { loadAtlas } from './game.ts';
import { getUnit,getPiece,UNITS,WORKSHOP_ROUTE,nextWorkshopUnit,type Unit } from './content.ts';
import { WorkshopProgress,type StorageDriver } from './progress.ts';
import { WorkshopAudio } from './sound.ts';
import { $,escape,panel,guidePanel,bindPanels,type Dispose,type ViewContext } from './ui.ts';
const app=document.querySelector<HTMLDivElement>('#app')!;
async function boot():Promise<void>{
  app.innerHTML='<div class="loading-page"><div class="loading-mark">律吕</div><p>正在准备工坊与钟体数据…</p></div>';
  const atlas=await loadAtlas(import.meta.env.BASE_URL),audio=new WorkshopAudio();
  const checkName=new URLSearchParams(location.search).get('validation'),validation=checkName!==null;
  if(checkName!==null&&!/^[a-zA-Z0-9-]{0,32}$/.test(checkName))throw new Error('验收存档名称无效');
  const prefix=validation?(checkName&&checkName!=='1'?`validation.${checkName}.`:'validation.'):'';
  const storage:StorageDriver={getItem:key=>localStorage.getItem(prefix+key),setItem:(key,value)=>localStorage.setItem(prefix+key,value)};
  const progress=new WorkshopProgress(storage,String(atlas.model.revision),atlas);
  app.innerHTML=`<div class="app-shell"><header class="topbar"><a class="brand" href="#/home" aria-label="律吕工坊首页"><span class="brand-mark">律吕</span><span>双音编钟工坊</span></a><nav class="main-nav" aria-label="工坊导航"><a href="#/home" data-nav="home">工坊大厅</a><a href="#/commissions" data-nav="commissions">委托关卡</a><a href="#/catalog" data-nav="catalog">器物研究</a><a href="#/practice" data-nav="practice">听辨训练</a><a href="#/music" data-nav="music">五钟合乐</a><a href="#/archive" data-nav="archive">我的档案</a></nav><div class="top-settings"><span id="global-progress">0 / 36</span><button data-panel-open="workshop-guide">操作与资料</button><button id="mute" aria-pressed="false" aria-label="切换声音开关">声音 开</button></div></header><div class="storage-error" id="storage-error" role="status" hidden></div><main id="page"></main></div>${guidePanel()}${panel('unit-result-dialog','关卡完成','<div id="unit-result-content"></div>')}<div class="toast" id="toast" role="status" hidden></div>`;
  if(validation){const banner=document.createElement('div');banner.className='validation-banner';banner.textContent='验收演练 · 使用独立测试存档';app.prepend(banner);}
  const host=$(app,'#page');let dispose:Dispose=()=>{},revision=0,toastTimer=0;
  const notice=(text:string)=>{const toast=$(app,'#toast');toast.textContent=text;toast.hidden=false;clearTimeout(toastTimer);toastTimer=window.setTimeout(()=>toast.hidden=true,7000);};
  const pausePanels=new Set(['workshop-guide','work-notes','work-plot','composition-options']);
  bindPanels(app,()=>{const paused=[...app.querySelectorAll<HTMLDialogElement>('dialog[open]')].some(d=>pausePanels.has(d.id));void audio.setPanelPaused(paused).catch(error=>notice(`暂停或恢复声音失败：${String(error)}`));});
  const sync=()=>{$(app,'#global-progress').textContent=`${Object.keys(progress.data.completed).length} / 36`;$(app,'#storage-error').textContent=progress.error;$(app,'#storage-error').hidden=!progress.error;};
  const complete=(unit:Unit,score:number,assisted:boolean,started:number)=>{
    progress.complete(unit.id,{score,assisted,completedAt:Date.now(),seconds:Math.max(0,Math.round((Date.now()-started)/1000))});sync();audio.stop();
    const index=UNITS.indexOf(unit),onRoute=WORKSHOP_ROUTE.some(s=>s.unitId===unit.id),next=onRoute?nextWorkshopUnit(unit.id):UNITS[index+1],result=document.createElement('section');result.className='unit-result';
    result.innerHTML=`<span class="stamp">已记入档案</span><div><h2>${escape(unit.title)}</h2><strong class="result-score">${score}<small>分${assisted?' · 辅助':''}</small></strong><p>${unit.takeaway}</p></div><div class="button-row">${next?`<a href="#/unit/${next.id}" class="primary">${onRoute?'路线下一步':'下一关'} · ${next.title} ↗</a>`:'<a href="#/music?tab=compose" class="primary">写下自己的合乐 ↗</a>'}<a href="#/commissions?chapter=${unit.chapter}" class="text-link">返回选关</a></div>`;const content=$(app,'#unit-result-content');content.replaceChildren(result);const dialog=$<HTMLDialogElement>(app,'#unit-result-dialog');if(!dialog.open)dialog.showModal();
  };
  const ctx:ViewContext={host,atlas,audio,progress,notice,complete};
  async function render():Promise<void>{
    const turn=++revision;app.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(d=>d.close());dispose();dispose=()=>{};audio.stop();host.onclick=null;host.innerHTML='<div class="page-loading">正在准备这一关…</div>';
    const [path,query='']=(location.hash.slice(1)||'/home').split('?'),params=new URLSearchParams(query),route=path.split('/').filter(Boolean);
    const currentUnit=route[0]==='unit'?UNITS.find(u=>u.id===route[1]):undefined;
    host.dataset.screen=currentUnit?.kind??(route[0]==='perform'?'perform':route[0]==='free'?'tune':route[0]||'home');
    const nav=currentUnit?({inspect:'catalog',ear:'practice',diagnose:'practice',tune:'commissions',assemble:'music',perform:'music'}[currentUnit.kind]):route[0]==='perform'?'music':route[0]==='free'?'commissions':route[0];
    app.querySelectorAll<HTMLAnchorElement>('[data-nav]').forEach(a=>{if(a.dataset.nav===nav)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
    try{
      let mounted:Dispose;
      if(route[0]==='unit'){
        const unit=getUnit(route[1]);
        if(unit.kind==='tune'){const view=await import('./workbench.ts');if(turn!==revision)return;mounted=view.mountWorkbench(ctx,unit);}
        else if(unit.kind==='perform'){const view=await import('./music.ts');if(turn!==revision)return;mounted=view.mountPerformance(ctx,getPiece(unit.piece),unit);}
        else{const view=await import('./activities.ts');if(turn!==revision)return;mounted=unit.kind==='inspect'?view.mountCatalog(ctx,unit):unit.kind==='ear'?view.mountEar(ctx,unit):unit.kind==='diagnose'?view.mountDiagnosis(ctx,unit):view.mountAssembly(ctx,unit);}
      }else if(route[0]==='free'){const view=await import('./workbench.ts');if(turn!==revision)return;mounted=view.mountWorkbench(ctx);}
      else if(route[0]==='music'||route[0]==='perform'){const view=await import('./music.ts');if(turn!==revision)return;mounted=route[0]==='perform'?view.mountPerformance(ctx,getPiece(route[1])):view.mountMusic(ctx,params.get('tab')==='compose');}
      else if(route[0]==='archive'){const view=await import('./archive.ts');if(turn!==revision)return;mounted=view.mountArchive(ctx);}
      else{const view=await import('./activities.ts');if(turn!==revision)return;mounted=route[0]==='catalog'?view.mountCatalog(ctx):route[0]==='commissions'?view.mountCommissions(ctx,Number(params.get('chapter')??0)):route[0]==='practice'?view.mountCommissions(ctx,0,'practice'):view.mountHome(ctx);}
      if(turn!==revision){mounted();return;}dispose=mounted;sync();window.scrollTo(0,0);
    }catch(error){host.innerHTML=`<section class="load-error"><h1>这一页未能打开</h1><p>${escape(error instanceof Error?error.message:String(error))}</p><a href="#/home" class="primary">返回工坊</a></section>`;}
  }
  $(app,'#mute').onclick=()=>{audio.setMuted(!audio.muted);$(app,'#mute').textContent=audio.muted?'声音 关':'声音 开';$(app,'#mute').setAttribute('aria-pressed',String(audio.muted));};
  window.addEventListener('hashchange',()=>void render());
  let lastActivity=Date.now(),lastTick=Date.now();
  document.addEventListener('visibilitychange',()=>lastTick=Date.now());
  for(const name of ['pointerdown','keydown'])window.addEventListener(name,()=>lastActivity=Date.now());
  window.setInterval(()=>{const now=Date.now(),seconds=(now-lastTick)/1000;lastTick=now;if(!document.hidden&&now-lastActivity<60000&&seconds<61){progress.addSeconds(seconds);sync();}},30000);
  window.addEventListener('pagehide',()=>progress.save());await render();
}
void boot().catch(error=>{app.innerHTML=`<div class="load-error"><h1>工坊未能准备完成</h1><p>${escape(error instanceof Error?error.message:String(error))}</p><button onclick="location.reload()">重新加载</button></div>`;});
