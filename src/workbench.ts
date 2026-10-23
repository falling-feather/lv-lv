import { BellModel,createSession,restoreSession,transition,planRemoval,type RemovalPlan,type Session,type GameEvent,type Tone,type Zone } from './game.ts';
import { specForJob,UNITS,type Job,type Unit } from './content.ts';
import { WorkshopScene } from './scene.ts';
import { $,bindAudio,escape,signed,toneName,unitHeading,heading,panel,workspaceSwitch,ignoreGameKey,type ViewContext,type Dispose } from './ui.ts';
interface WorkRecord {index:number;sessions:Record<string,Session>}
export function mountWorkbench(ctx:ViewContext,unit?:Extract<Unit,{kind:'tune'}>):Dispose {
  const free=!unit,source=UNITS.find(u=>u.kind==='tune'&&u.id==='3-1') as Extract<Unit,{kind:'tune'}>;
  const jobs:Job[]=unit?.jobs??[{...source.jobs[0],id:'free-bell',name:'自由磨修',reveal:'always',prediction:false}];
  const id=unit?.id??'free',saved=ctx.progress.active<WorkRecord>(id);
  let record:WorkRecord=saved&&Number.isInteger(saved.index)&&saved.index>=0&&saved.index<jobs.length?saved:{index:0,sessions:{}};
  let scene:WorkshopScene|null=null,zone:Zone=0,tone:Tone=0,amount:1|2=1,section=false,grinding=false,showMode=false;
  let job:Job,model:BellModel,session!:Session,started=Date.now();
  let preview:Extract<RemovalPlan,{ok:true}>|null=null;
  ctx.host.innerHTML=`${unit?unitHeading(unit):heading('自由练习','留一口钟，慢慢试。','这里可以反复观察加工响应，不计入委托完成数。','<a href="#/commissions" class="text-link">查看委托簿 ↗</a>')}
  <div class="work-layout"><section class="object-stage"><div class="stage-title"><div><span class="small-label">甬钟习作</span><h2 id="job-name"></h2></div><span id="job-order" class="folio"></span></div>
    <div class="stage-actions"><button id="section" aria-pressed="false">剖开钟壁</button><button id="mode" aria-pressed="false">观察振形</button><button id="grind" aria-pressed="false">拖动磨修</button></div>
    <div class="scene" id="bell-scene"></div><div class="stage-base"><span id="gesture-tip">拖动旋转 · 滚轮缩放 · 点击音位敲击</span><span>自主建模 · 甬钟结构参考</span></div>
    <div class="cross-section"><svg viewBox="-90 -55 180 110" id="section-svg" aria-label="当前内外壁截面"></svg><span>钟口上方截面</span></div>
  </section><aside class="work-tools"><section class="listening-sheet"><div class="section-label"><h2>听两声</h2><button id="measure" class="text-button">测量当前</button></div><p id="readout-status" class="muted"></p>
    <div class="tone-columns">${[0,1].map(t=>`<div><div class="small-label">${toneName(t)}</div><div class="readout" id="hz-${t}">—</div><p id="target-${t}" class="target-line"></p><div id="error-${t}" class="pitch-error"></div><button data-hit="${t}" class="wide">敲${toneName(t)} <kbd>${t+1}</kbd></button><small id="heard-${t}"></small></div>`).join('')}</div>
    <div class="audition-controls"><label>对照音位 <select id="tone"><option value="0">正鼓</option><option value="1">侧鼓</option></select></label><button id="compare">当前→参照</button><button id="beats">听拍动</button></div>
    <div id="prediction"></div>

  </section><section class="tool-sheet"><div class="section-label"><h2>选一处磨修</h2><span id="stock" class="muted"></span></div>
    <div class="zone-list">${ctx.atlas.zoneNames.map((name,i)=>`<button data-zone="${i}" aria-pressed="${i===0}"><span><b>${['甲','乙','丙'][i]}</b> ${name}</span><small id="depth-${i}"></small><span class="stock-cells" id="zone-stock-${i}" role="img"></span></button>`).join('')}</div>
    <div class="tool-width"><button data-amount="1" aria-pressed="true">精修 · 一格</button><button data-amount="2" aria-pressed="false">粗修 · 两格</button><button id="preview" title="辅助预演不消耗材料，使用后保留辅助标记">辅助预演</button></div>
    <button id="cut" class="primary wide">磨修一次 <kbd>空格</kbd></button><p class="muted" id="tool-description"></p>
  </section></aside></div>
  <div class="task-message"><span id="phase" class="stamp">辨声</span><div><b id="session-message" role="status"></b><p id="job-brief"></p></div><button id="verify" class="primary">双音验律 ↗</button></div>
  <div class="bench-utility"><button data-panel-open="work-notes">工序</button><button data-panel-open="work-plot">靶图</button><button id="restart" class="text-button" title="正式去料不可撤销；换一件相同初态的钟坯重新演练">换坯</button></div>
  ${panel('work-notes','工序与工艺提示','<div class="work-bottom"><section class="process-sheet"><div class="section-label"><h2>工序手记</h2></div><div id="process-list"></div></section><aside class="work-guidance"><h3>下一步怎么判断</h3><p id="material" class="material-line"></p><p id="guidance">先比较两项目标，再分配不同区域的去料量。中途可听、可测；最终两音一起验律。</p><button id="hint">查看一次工艺提示</button><button id="assist" class="text-button">借助当前读数</button><p class="muted">使用工艺提示或借助读数，会在本轮记录中保留辅助标记。</p></aside></div>')}
  ${panel('work-plot','双音靶图','<div class="plot-wrap"><svg id="target-plot" viewBox="0 0 300 150" aria-label="正鼓与侧鼓偏差靶图"></svg><p>同一个点，记录同一口钟的两音。有限测量关卡只显示已测得的状态。</p></div>')}
  ${panel('piece-result','本件合律','<div id="job-result"></div>')}`;
  const host=ctx.host,save=()=>{record.sessions[job.id]=session;ctx.progress.setActive(id,record);};
  $(host,'.task-message').insertBefore($(host,'.bench-utility'),$(host,'#verify'));
  $(host,'.task-message').insertBefore($(host,'#cut'),$(host,'#verify'));
  $(host,'#verify').className='secondary';
  for(const t of [0,1] as const){const parent=$(host,`#hz-${t}`).parentElement!;$(parent,'.small-label').append($(host,`#heard-${t}`));$(host,`#heard-${t}`).className='tone-heard';}
  workspaceSwitch($(host,'.work-layout'),$(host,'.object-stage'),$(host,'.work-tools'),['观察与敲击','调律工具']);
  function bootJob():void {
    preview=null;job=jobs[record.index];model=new BellModel(ctx.atlas,specForJob(ctx.atlas,job));
    try{session=record.sessions[job.id]?restoreSession(record.sessions[job.id],model):createSession(model,Date.now());}
    catch(error){session=createSession(model,Date.now());ctx.notice(`这件工序未能恢复：${error instanceof Error?error.message:String(error)}`);}
    started=session.startedAt;scene?.dispose();scene=new WorkshopScene($(host,'#bell-scene'),[{model,cuts:session.cuts}],key=>hit(key.tone),z=>dispatch({type:'cut',zone:z,amount,at:Date.now()}),ctx.notice);
    section=false;grinding=false;showMode=false;for(const name of ['section','grind','mode'])$(host,`#${name}`).setAttribute('aria-pressed','false');
    $(host,'#job-name').textContent=job.name;$(host,'#job-order').textContent=`${String(record.index+1).padStart(2,'0')} / ${String(jobs.length).padStart(2,'0')}`;
    $(host,'#job-brief').textContent=job.brief;$(host,'#job-result').innerHTML='';update();
  }
  function hit(t:Tone):void{tone=t;$<HTMLSelectElement>(host,'#tone').value=String(t);bindAudio(ctx,()=>ctx.audio.strike(model.voice(preview?.cuts??session.cuts),t));scene?.flash({bell:0,tone:t});if(!preview)dispatch({type:'strike',tone:t});}
  function cancelPreview(refresh=true):void{if(!preview)return;preview=null;ctx.audio.stop();scene?.setState(session.cuts,zone);if(refresh)update();}
  function togglePreview():void {
    if(preview){cancelPreview();return;}
    const plan=planRemoval(session,zone,amount,model);if(!plan.ok){ctx.notice(plan.message);return;}
    session=transition(session,{type:'assist'},model);save();preview=plan;ctx.audio.stop();scene?.setState(plan.cuts,zone);update();
  }
  function dispatch(event:GameEvent):void {
    if(preview&&event.type==='verify'){ctx.notice('预演不能验律入档，请先确认去料或取消预演。');return;}
    cancelPreview(false);const old=session;session=transition(session,event,model);save();
    if(event.type==='cut'&&old.cuts!==session.cuts)scene?.setState(session.cuts,zone);
    update();if(old.phase!=='complete'&&session.phase==='complete'){
      if(!free)ctx.progress.finishBell(id,job,model.spec,session);
      showResult();
    }
  }
  function nextJob():void { ctx.audio.stop();$<HTMLDialogElement>(host,'#piece-result').close();record.index++;save();bootJob(); }
  function showResult():void {
    const all=record.index===jobs.length-1;
    if(all&&unit){const sessions=jobs.map(j=>record.sessions[j.id]);ctx.complete(unit,Math.max(60,100-sessions.reduce((sum,s)=>sum+s.mistakes*3,0)),sessions.some(s=>s.assisted),started);return;}
    $(host,'#job-result').innerHTML=`<section class="completion"><span class="stamp">合律</span><div><h2>${escape(job.name)}已完成</h2><p>加工 ${session.history.length-1} 次，去除 ${model.removedGrams(session.cuts).toFixed(1)} 克模拟材料。${session.assisted?'本轮借助了提示。':'本轮独立完成。'}</p></div>${!all?'<button class="primary" id="next-job">处理下一件 ↗</button>':'<button class="primary" data-panel-close>返回工作台</button>'}</section>`;
    if(!all)$(host,'#next-job').onclick=nextJob;
    $<HTMLDialogElement>(host,'#piece-result').showModal();
  }
  function update():void {
    const displayCuts=preview?.cuts??session.cuts;
    const visible=job.reveal==='always'||session.assisted||session.measuredAt!==null;
    const readCuts=preview?.cuts??(job.reveal==='always'||session.assisted?session.cuts:session.measuredAt);
    const fresh=readCuts?.join(':')===displayCuts.join(':'),voice=readCuts?model.voice(readCuts):null,errors=readCuts?model.errors(readCuts):null;
    $(host,'#readout-status').textContent=preview?`辅助预演 · 未去料 · 预计 ${preview.grams.toFixed(1)} g${preview.withinBudget?'':'（将超预算）'}`:job.reveal==='always'?'实时读数':session.assisted?'已借助当前读数':readCuts?(fresh?'本次测量':'上次测量 · 加工后尚未更新'):'读数收起 · 先对照试听';
    for(const t of [0,1] as const){$(host,`#hz-${t}`).innerHTML=visible&&voice?`${voice.frequencies[t].toFixed(1)}<small> Hz</small>`:'—';
      $(host,`#target-${t}`).textContent=`参照 ${(model.target.frequencies[t]/model.spec.scale).toFixed(1)} Hz · ±${job.tolerance[t]} 音分`;
      $(host,`#error-${t}`).textContent=errors?`${signed(errors[t])} 音分${fresh?'':'（上次）'}`:'先听，再判断';
      $(host,`#error-${t}`).classList.toggle('in-tune',!!errors&&Math.abs(errors[t])<=job.tolerance[t]);
      $(host,`#heard-${t}`).textContent=preview?'试听预演':session.heard[t]?'当前已听':session.phase==='listen'?'初态待听':'验律前复听';}
    $(host,'#measure').textContent=job.measurements===null?'测量当前':`测量 ${session.measurements}/${job.measurements}`;
    $(host,'#prediction').innerHTML=job.prediction&&!session.diagnosed?`<div class="prediction"><b>先判断两个音，之后开放磨修</b>${[0,1].map(t=>`<div><span>${toneName(t)}</span>${(['high','low','near'] as const).map((answer,i)=>`<button data-predict="${t}:${answer}" ${session.predictions[t]?'disabled':''}>${['偏高','偏低','已接近'][i]}</button>`).join('')}${session.predictions[t]?'✓':''}</div>`).join('')}</div>`:'';
    $(host,'.tool-sheet').hidden=job.prediction&&!session.diagnosed;
    const stock=model.stock(session.cuts);
    $(host,'#stock').textContent=job.budget===null?`区域余量 ${stock.remaining} 格`:`预算余量 ${stock.remaining} / ${stock.limit} 格`;
    for(const z of [0,1,2] as const){$(host,`#depth-${z}`).textContent=`已去 ${((session.cuts[z]-job.initial[z])*ctx.atlas.stepMm*model.spec.scale).toFixed(2)} mm`;
      const cells=$(host,`#zone-stock-${z}`);cells.setAttribute('aria-label',`本区余量 ${stock.zones[z]} 格`);
      cells.innerHTML=Array.from({length:ctx.atlas.maxCuts},(_,i)=>`<i class="${i<job.initial[z]?'existing':i<session.cuts[z]?'spent':preview&&i<preview.cuts[z]?'planned':''}"></i>`).join('');}
    $(host,'#preview').textContent=preview?'取消预演':'辅助预演';$(host,'#compare').textContent=preview?'预演→参照':'当前→参照';
    $(host,'#preview').toggleAttribute('disabled',session.phase!=='tune'||!session.diagnosed);
    for(const b of host.querySelectorAll<HTMLButtonElement>('[data-amount="2"]'))b.disabled=!job.coarse;
    $(host,'#cut').toggleAttribute('disabled',session.phase!=='tune'||!session.diagnosed);
    $(host,'#cut').innerHTML=`${preview?'确认去料':'磨修一次'} <kbd>空格</kbd>`;
    $(host,'#verify').toggleAttribute('disabled',!!preview||session.phase==='spoiled'||(session.phase==='complete'&&record.index===jobs.length-1));
    $(host,'#verify').textContent=session.phase==='complete'&&record.index<jobs.length-1?'处理下一件 ↗':'双音验律 ↗';
    $(host,'#session-message').textContent=preview?`预演：正鼓 ${signed(preview.deltaCents[0])} / 侧鼓 ${signed(preview.deltaCents[1])} 音分（未去料）`:session.message;$(host,'#job-brief').textContent=preview?'辅助预演可取消；确认后才计去料，并保留辅助标记。':job.brief;$(host,'#phase').textContent=preview?'预演':{listen:'辨声',tune:'磨修',complete:'合律',spoiled:'换坯'}[session.phase];
    $(host,'#tool-description').textContent=`每格 ${(.15*model.spec.scale).toFixed(2)} mm · 可连续修形；验律前复听两音。`;
    $(host,'#material').textContent=`当前最薄 ${model.voice(session.cuts).minWallMm.toFixed(2)} mm · 模拟去料 ${model.removedGrams(session.cuts).toFixed(1)} g`;
    const at=Math.round(ctx.atlas.nz*.75)*ctx.atlas.nt*3;
    const polygon=(values:ArrayLike<number>)=>Array.from({length:ctx.atlas.nt},(_,i)=>`${values[at+i*3]*1000},${values[at+i*3+1]*1000}`).join(' ');
    $(host,'#section-svg').innerHTML=`<polygon points="${polygon(ctx.atlas.outer)}" fill="#ae8b5a"/><polygon points="${polygon(model.inner(displayCuts))}" fill="#eee8db"/><path d="M-85 0H85M0-50V50" stroke="#625d5140" stroke-dasharray="3 4"/>`;
    const allErrors=ctx.atlas.states.map(s=>model.errors(s.cuts)),domain=Math.max(40,...allErrors.flat().map(Math.abs)),x=(v:number)=>150+v/domain*120,y=(v:number)=>72-v/domain*52;
    $(host,'#target-plot').innerHTML=`<path d="M25 72H275M150 15V130" stroke="#c2b9a7"/><rect x="${x(-job.tolerance[0])}" y="${y(job.tolerance[1])}" width="${240*job.tolerance[0]/domain}" height="${104*job.tolerance[1]/domain}" fill="#68847244"/><circle cx="150" cy="72" r="3" fill="#688472"/>${errors?`<circle cx="${x(errors[0])}" cy="${y(errors[1])}" r="5" fill="#aa4836"/><text x="20" y="145">${preview?'预演':fresh?'当前':'上次测量'} · ${signed(errors[0])} / ${signed(errors[1])}</text>`:'<text x="55" y="110">测量后显示双音偏差</text>'}<text x="271" y="66">正</text><text x="155" y="20">侧</text>`;
    $(host,'#process-list').innerHTML=session.history.map((r,i)=>`<div class="process-row"><span>${String(i).padStart(2,'0')}</span><b>${r.zone===null?'接手状态':`${ctx.atlas.zoneNames[r.zone]} · ${r.amount===2?'粗修':'精修'}`}</b><small>甲 ${r.cuts[0]} · 乙 ${r.cuts[1]} · 丙 ${r.cuts[2]}</small></div>`).join('');
  }
  host.onclick=event=>{const button=(event.target as Element).closest<HTMLButtonElement>('button');if(!button)return;
    if(button.dataset.hit!==undefined)hit(Number(button.dataset.hit) as Tone);
    if(button.dataset.zone!==undefined){cancelPreview(false);zone=Number(button.dataset.zone) as Zone;host.querySelectorAll('[data-zone]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));scene?.setState(session.cuts,zone);update();}
    if(button.dataset.amount!==undefined){cancelPreview(false);amount=Number(button.dataset.amount) as 1|2;host.querySelectorAll('[data-amount]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));update();}
    if(button.dataset.predict){const [t,answer]=button.dataset.predict.split(':');dispatch({type:'predict',tone:Number(t) as Tone,answer:answer as 'high'|'low'|'near'});}
  };
  $(host,'#preview').onclick=togglePreview;
  $(host,'#cut').onclick=()=>dispatch({type:'cut',zone,amount,at:Date.now()});$(host,'#verify').onclick=()=>{if(session.phase==='complete'&&record.index<jobs.length-1)nextJob();else dispatch({type:'verify'});};$(host,'#measure').onclick=()=>dispatch({type:'measure'});
  $(host,'#assist').onclick=()=>dispatch({type:'assist'});
  $(host,'#hint').onclick=()=>{dispatch({type:'assist'});try{const route=model.route(session.cuts);$(host,'#guidance').textContent=route.length?`先在${ctx.atlas.zoneNames[route[0]]}精修一格，再重新听两音。这只是本次状态的一种可行工序。`:'两音已进入范围，复听后可以验律。';}catch{$(host,'#guidance').textContent='本单允许的范围内已无法完成，保留教训后换坯。';}};
  $(host,'#tone').onchange=event=>{tone=Number((event.target as HTMLSelectElement).value) as Tone;};
  $(host,'#compare').onclick=()=>bindAudio(ctx,()=>ctx.audio.compare(model.voice(preview?.cuts??session.cuts).frequencies[tone],model.target.frequencies[tone]/model.spec.scale));
  $(host,'#beats').onclick=()=>bindAudio(ctx,()=>ctx.audio.beats(model.voice(preview?.cuts??session.cuts).frequencies[tone],model.target.frequencies[tone]/model.spec.scale));
  $(host,'#restart').onclick=()=>{cancelPreview(false);ctx.audio.stop();session=createSession(model,Date.now());save();$(host,'#job-result').innerHTML='';host.querySelector('.unit-result')?.remove();scene?.setState(session.cuts,zone);update();};
  $(host,'#section').onclick=()=>{section=!section;scene?.setSection(section);if(!section&&grinding){grinding=false;scene?.setGrinding(false);$(host,'#grind').setAttribute('aria-pressed','false');}$(host,'#section').setAttribute('aria-pressed',String(section));};
  $(host,'#mode').onclick=()=>{showMode=!showMode;scene?.setMode(showMode);$(host,'#mode').setAttribute('aria-pressed',String(showMode));$(host,'#gesture-tip').textContent=showMode?'振形慢放、位移放大 · 点击音位观察':'拖动旋转 · 滚轮缩放 · 点击音位敲击';};
  $(host,'#grind').onclick=()=>{grinding=!grinding;section=grinding||section;scene?.setGrinding(grinding);$(host,'#grind').setAttribute('aria-pressed',String(grinding));$(host,'#section').setAttribute('aria-pressed',String(section));$(host,'#gesture-tip').textContent=grinding?'按住亮色内壁，来回磨过一段距离后松手':'拖动旋转 · 滚轮缩放 · 点击音位敲击';};
  const key=(event:KeyboardEvent)=>{if(ignoreGameKey(event))return;
    if(event.repeat)return;if(event.key==='1'||event.key==='2')hit(Number(event.key)-1 as Tone);
    else if(['q','w','e'].includes(event.key.toLowerCase())){zone=['q','w','e'].indexOf(event.key.toLowerCase()) as Zone;host.querySelector<HTMLButtonElement>(`[data-zone="${zone}"]`)?.click();}
    else if(event.code==='Space'){event.preventDefault();dispatch({type:'cut',zone,amount,at:Date.now()});}else if(event.key==='Enter')dispatch({type:'verify'});
  };
  window.addEventListener('keydown',key);bootJob();if(session.phase==='complete')showResult();
  return ()=>{scene?.dispose();window.removeEventListener('keydown',key);host.onclick=null;};
}
