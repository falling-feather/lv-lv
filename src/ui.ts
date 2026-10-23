import type { Atlas,BellState } from './game.ts';
import { BellModel } from './game.ts';
import { referenceSet,SET_NOTES,REFERENCES,type Unit } from './content.ts';
import type { WorkshopAudio } from './sound.ts';
import type { WorkshopProgress } from './progress.ts';
export interface ViewContext {
  host:HTMLElement;atlas:Atlas;audio:WorkshopAudio;progress:WorkshopProgress;
  notice:(text:string)=>void;complete:(unit:Unit,score:number,assisted:boolean,started:number)=>void;
}
export type Dispose=()=>void;
export const escape=(s:unknown)=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export const $=<T extends HTMLElement=HTMLElement>(host:ParentNode,selector:string)=>{const node=host.querySelector<T>(selector);if(!node)throw new Error(`界面缺少 ${selector}`);return node;};
export const signed=(n:number)=>`${n>=0?'+':''}${n.toFixed(1)}`;
export const toneName=(tone:number)=>tone===0?'正鼓':'侧鼓';
export const bellName=(bell:number)=>['一','二','三','四','五'][bell];
export const personalSetReady=(ctx:ViewContext)=>SET_NOTES.every(note=>ctx.progress.data.bells.some(b=>b.note===note));
export function pageSlice<T>(items:readonly T[],requested:number,size:number):{items:T[];page:number;pages:number;start:number;end:number;total:number} {
  if(!Number.isInteger(size)||size<1)throw new RangeError('分页容量必须为正整数');
  const pages=Math.max(1,Math.ceil(items.length/size)),page=Math.min(pages-1,Math.max(0,Number.isFinite(requested)?Math.trunc(requested):0)),start=page*size;
  return {items:items.slice(start,start+size),page,pages,start,end:Math.min(items.length,start+size),total:items.length};
}
export function pageControls(group:string,range:ReturnType<typeof pageSlice>):string {
  if(range.total===0)return '';
  return `<nav class="pagination" aria-label="记录分页"><button data-page-group="${group}" data-page-delta="-1" ${range.page===0?'disabled':''}>上一页</button><span>${range.start+1}–${range.end} / ${range.total}</span><button data-page-group="${group}" data-page-delta="1" ${range.page===range.pages-1?'disabled':''}>下一页</button></nav>`;
}
export function heading(kicker:string,title:string,description:string,extra=''):string {
  return `<header class="page-heading"><div class="heading-title"><p class="kicker">${kicker}</p><h1>${title}</h1></div><p class="lead">${description}</p>${extra}</header>`;
}
export function unitHeading(unit:Unit):string{return heading(`关卡 ${unit.id} · 第${unit.chapter}阶段`,unit.title,unit.purpose,`<a class="text-link" href="#/commissions?chapter=${unit.chapter}">返回选关 ↗</a>`);}
export function panel(id:string,title:string,body:string):string {
  return `<dialog id="${id}" class="game-panel" aria-labelledby="${id}-title"><header class="panel-heading"><h2 id="${id}-title">${title}</h2><button class="panel-close" data-panel-close aria-label="关闭${title}">×</button></header><div class="panel-content">${body}</div></dialog>`;
}
export function bindPanels(host:HTMLElement,onState?:()=>void):Dispose {
  const click=(event:MouseEvent)=>{
    const target=event.target as Element,open=target.closest<HTMLElement>('[data-panel-open]');
    if(open){const dialog=host.querySelector<HTMLDialogElement>(`#${open.dataset.panelOpen}`);if(dialog&&!dialog.open){dialog.showModal();onState?.();}}
    const close=target.closest('[data-panel-close]');if(close)close.closest('dialog')?.close();
    if(target instanceof HTMLDialogElement&&target.open){const r=target.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)target.close();}
  };
  const closed=()=>onState?.();host.addEventListener('click',click);host.addEventListener('close',closed,true);
  return ()=>{host.removeEventListener('click',click);host.removeEventListener('close',closed,true);};
}
export function ignoreGameKey(event:KeyboardEvent):boolean {
  const target=event.target;
  return event.defaultPrevented||event.ctrlKey||event.metaKey||event.altKey||!!document.querySelector('dialog[open]')||
    (target instanceof HTMLElement&&(/INPUT|SELECT|TEXTAREA/.test(target.tagName)||target.isContentEditable));
}
export function workspaceSwitch(layout:HTMLElement,stage:HTMLElement,tools:HTMLElement,labels=['看钟','操作']):void {
  const bar=document.createElement('div');bar.className='workspace-switch';bar.setAttribute('aria-label','切换操作区域');
  bar.innerHTML=labels.map((label,i)=>`<button type="button" aria-pressed="${i===0}">${label}</button>`).join('');
  layout.prepend(bar);layout.dataset.pane='stage';stage.classList.add('workspace-stage');tools.classList.add('workspace-tools');
  bar.addEventListener('click',event=>{const button=(event.target as Element).closest('button');if(!button)return;const index=[...bar.children].indexOf(button);layout.dataset.pane=index===0?'stage':'tools';bar.querySelectorAll('button').forEach((b,i)=>b.setAttribute('aria-pressed',String(i===index)));});
}
export function guidePanel():string {
  return panel('workshop-guide','操作与资料',`<div class="guide-sections"><section><h3>操作方法</h3><p>在器物上拖动旋转，滚轮缩放。初态先听正鼓、侧鼓，过程中自主选择试听与测量、规划几步去料；最终复听当前两音后验律。辅助预演可以取消，正式去料不能补回。</p><p>调律：1 / 2 敲击，Q / W / E 选区，空格加工，Enter 验律。演奏：A S D F G 为正鼓，Q W E R T 为侧鼓。输入文字或打开抽屉时暂停这些快捷键。</p><p>进度保存在本机，完整档案可在“我的档案”导出。关卡均可直接进入，辅助和慢速练习会留下标记。</p></section><section><h3>这件器物的依据</h3><p>器形参考曾侯舆甬钟，钟体自主重建，纹样自主简化；未复制文物照片、扫描或铭文。</p><p>两音、磨修响应和声音共用三维线弹性教学近似模型。振形慢放、位移放大；材料、衰减、悬挂与装饰未完成实物校准，绝对音高尚未证明收敛。五钟音列与练习曲为现代设计。</p></section><section class="reference-links">${REFERENCES.map(r=>`<a href="${r.url}" target="_blank" rel="noreferrer"><b>${r.title} ↗</b><span>${r.scope}</span></a>`).join('')}</section></div>`);
}
export function currentVoices(ctx:ViewContext,mine=false):{voices:BellState[];models:BellModel[];missing:number} {
  const models=referenceSet(ctx.atlas);let missing=0;
  const voices=models.map((m,i)=>{
    const saved=mine?[...ctx.progress.data.bells].reverse().find(b=>b.note===SET_NOTES[i]):undefined;
    if(saved){const own=new BellModel(ctx.atlas,saved.spec);models[i]=own;return own.voice(saved.cuts);}
    if(mine)missing++;return m.voice(m.spec.target);
  });return {voices,models,missing};
}
export function snapshotVoices(ctx:ViewContext,voices:BellState[]):{voices:BellState[];models:BellModel[];missing:number} {
  const refs=referenceSet(ctx.atlas),models=voices.map((voice,i)=>{
    const raw=refs[i].state(voice.cuts);return new BellModel(ctx.atlas,{...refs[i].spec,scale:raw.frequencies[0]/voice.frequencies[0]});
  });return {voices,models,missing:0};
}
export function download(content:BlobPart,name:string,type:string):void{
  const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
}
export function bindAudio(ctx:ViewContext,operation:()=>Promise<unknown>):void{void operation().catch(error=>ctx.notice(error instanceof Error?error.message:String(error)));}
export const idle:Dispose=()=>{};
