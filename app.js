import { validSubtasks, toggleSubtask, completeSubtasks, subtaskProgress } from './subtasks.js?v=4';
let draftSubtasks = [], editorBase = null;
const expandedSubtasks=new Set();
import { CloudSync } from './cloud.js?v=4';
let cloudClient;
let cloud = null, accountScope = 'guest';
import { loadSnapshot, saveSnapshot } from './storage.js?v=4';
const serverMode = window.RIXU_CONFIG?.storage === 'server';
let snapshotAvailable = false;
const $ = s => document.querySelector(s);
const pad = n => String(n).padStart(2, '0');
const dateKey = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parseDate = s => new Date(`${s}T12:00:00`);
const addDays = (s,n) => {const d=parseDate(s);d.setDate(d.getDate()+n);return dateKey(d)};
const today = () => dateKey(new Date());
const weekStart = s => {const d=parseDate(s);return addDays(s,-((d.getDay()+6)%7))};
const escape = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const weekday = s => ['周日','周一','周二','周三','周四','周五','周六'][parseDate(s).getDay()];
const fullDate = s => {const d=parseDate(s);return `${d.getMonth()+1}月${d.getDate()}日 ${weekday(s)}`};
let storageKey='rixu-data-v1', queueKey='rixu-pending-v1';
let storageAvailable=true;
function read(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback}catch{return fallback}}
function write(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true}catch{storageAvailable=false;toast('本机存储不可用，请及时导出备份');return false}}
let tasks=read(storageKey,[]), pending=read(queueKey,[]);
if(!Array.isArray(tasks))tasks=[];
if(!Array.isArray(pending))pending=[];
let prefs=read('rixu-prefs-v1',{showCompleted:true,hideDemo:false});
let state={page:'list',filter:'today',view:'month',anchor:today(),selected:today(),miniMonth:today(),search:''};
let connected=false,busy=false,lastSuccess=0,importBusy=false;
const filters=[['today','今天','sun'],['tomorrow','明天','sunrise'],['week','本周','calendar'],['nextweek','下周','calendar'],['month','本月','calendar'],['unscheduled','未安排','inbox'],['overdue','已逾期','clock'],['done','已完成','check'],['trash','回收站','trash']];
const icons={sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',sunrise:'<path d="M3 17h18M6 14a6 6 0 0 1 12 0M12 2v4M3 8l3 2m15-2-3 2M4 21h16"/>',calendar:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 2v5m10-5v5M3 11h18M8 15h2m4 0h2"/>',inbox:'<path d="m3 14 3-9h12l3 9v6H3Z M3 14h6l1 3h4l1-3h6"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/>',check:'<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',trash:'<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>'};
const checkIcon='<svg viewBox="0 0 20 20"><path d="m4 10 4 4 8-8"/></svg>';
const activeTasks=()=>tasks.filter(t=>!t.deletedAt);
const visibleTasks=()=>activeTasks().filter(t=>(prefs.showCompleted||!t.completed)&&matchesSearch(t));
const sortTasks=arr=>arr.sort((a,b)=>Number(a.completed)-Number(b.completed)||(a.date||'9999').localeCompare(b.date||'9999')||(a.time||'99:99').localeCompare(b.time||'99:99')||Number(b.priority==='high')-Number(a.priority==='high')||(a.createdAt||'').localeCompare(b.createdAt||''));
function matchesSearch(t){return !state.search||`${t.title} ${t.notes||''} ${t.category||''}`.toLowerCase().includes(state.search.toLowerCase())}
function inFilter(t,f){const td=today(),ws=weekStart(td);if(f==='trash')return !!t.deletedAt;if(t.deletedAt)return false;switch(f){case'today':return t.date===td;case'tomorrow':return t.date===addDays(td,1);case'week':return t.date>=ws&&t.date<=addDays(ws,6);case'nextweek':return t.date>=addDays(ws,7)&&t.date<=addDays(ws,13);case'month':return t.date?.slice(0,7)===td.slice(0,7);case'unscheduled':return !t.date;case'overdue':return !!t.date&&t.date<td&&!t.completed;case'done':return t.completed;default:return true}}
function filterTasks(f=state.filter){return sortTasks(tasks.filter(t=>inFilter(t,f)&&matchesSearch(t)&&(f==='trash'||f==='done'||prefs.showCompleted||!t.completed)))}
function saveLocal(){write(storageKey,tasks);if(serverMode)write(queueKey,pending);persistSnapshot();render();sync()}
function persistSnapshot(){saveSnapshot(tasks,accountScope).then(()=>{snapshotAvailable=true;updateSync()}).catch(()=>{snapshotAvailable=false;if(!storageAvailable)toast("设备保存失败，请立即导出备份");updateSync()})}
function mutate(id,patch,baseline){const original=tasks.find(t=>t.id===id);const base=baseline|| (original?structuredClone(original):{});if(original){patch=Object.fromEntries(Object.entries(patch).filter(([key,value])=>JSON.stringify(value)!==JSON.stringify(base[key])))}const now=new Date().toISOString();patch={...(!original?{createdAt:now}:{}),...patch,updatedAt:now};let existing=tasks.find(t=>t.id===id);if(existing)Object.assign(existing,patch);else tasks.push({id,createdAt:now,...patch});if(serverMode)pending.push({opId:uid(),id,patch:{...(existing?{}:{createdAt:now}),...patch}});if(cloud?.user)cloud.record(id,patch,base);if(!importBusy)saveLocal()}
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').hidden=true,3300)}
function updateSync(){renderCloud();if(cloud?.user){$('#sync-status').textContent=cloud.status;$('#sync-status').title='当前账号的计划会在联网时自动同步';return}const text=!storageAvailable?(snapshotAvailable?'已存入设备备用存储':'保存异常，请导出'):!serverMode?'已保存在此设备':connected?(pending.length?'正在同步…':'已保存到本机服务'):'仅保存在此设备';$('#sync-status').textContent=text;$('#sync-status').title=!serverMode?'记录保存在当前设备，尚未启用跨设备云同步':connected?'同一服务地址下的设备共享数据':'离线数据保存在当前设备，联网后会尝试同步'}
async function sync(){if(cloud?.user)return cloud.sync();if(!serverMode||busy||importBusy||location.protocol==='file:')return;busy=true;try{if(pending.length){const batch=pending.slice();const r=await fetch('/api/tasks',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({operations:batch}),signal:AbortSignal.timeout(7000)});if(!r.ok)throw Error('sync');const result=await r.json();const sent=new Set(batch.map(o=>o.opId));pending=pending.filter(o=>!sent.has(o.opId));tasks=result.tasks;overlayPending();write(queueKey,pending);write(storageKey,tasks);persistSnapshot()}else{const r=await fetch('/api/tasks',{cache:'no-store',signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error('fetch');const result=await r.json();if(!result.initialized&&!tasks.length&&!localStorage.getItem('rixu-initialized')){seed();busy=false;return sync()}tasks=result.tasks;overlayPending();write(storageKey,tasks);persistSnapshot()}connected=true;lastSuccess=Date.now();render()}catch{connected=false;updateSync()}finally{busy=false;if(pending.length&&connected)setTimeout(sync,200)}}
function overlayPending(){for(const op of pending){let t=tasks.find(t=>t.id===op.id);if(t)Object.assign(t,op.patch);else tasks.push({id:op.id,...op.patch})}}
function seed(){const td=today();const examples=[['给今天排个轻重缓急',td,'09:00','生活',true,'花五分钟，选出今天最值得完成的一件事。','normal'],['读完正在看的那一章',td,'10:30','学习',false,'不追求读得多，记下一点自己的想法。','high'],['整理本周的工作安排',td,'14:00','工作',false,'把大事拆小一点，给自己留一些余地。','high'],['出门走走，顺路买点水果',td,'17:30','生活',false,'慢慢走，看看今天的天空。','normal'],['回顾今天，准备明天',td,'21:00','生活',false,'完成了什么？有什么可以明天继续？','normal'],['整理读书笔记',addDays(td,1),'10:00','学习',false,'','normal'],['完成项目资料初稿',addDays(td,1),'14:30','工作',false,'','high'],['周末给自己做顿饭',addDays(weekStart(td),5),'18:00','生活',false,'','normal'],['规划下一周',addDays(weekStart(td),7),'09:00','生活',false,'','normal'],['找时间整理一下照片','','','生活',false,'不急，想起来的时候再做。','normal'],['补上昨天的阅读记录',addDays(td,-1),'20:00','学习',true,'过去的计划也能补建、补记完成。','normal']];for(const [title,date,time,category,completed,notes,priority]of examples){const id=uid(),now=new Date().toISOString(),patch={title,date,time,category,completed,notes,priority,completedDate:completed?date:'',createdAt:now,updatedAt:now,deletedAt:null};tasks.push({id,...patch});pending.push({opId:uid(),id,patch})}write('rixu-initialized',true);write(storageKey,tasks);write(queueKey,pending);render()}
function taskCard(t,compact=false){
  const progress=subtaskProgress(t.subtasks);
  return `<article class="${compact?'week-task':'task-card'} ${t.completed?'completed':''}" data-task-id="${escape(t.id)}">
    ${t.deletedAt?'':`<button class="check ${t.completed?'checked':''} ${t.priority==='high'?'high':''}" data-toggle="${escape(t.id)}" aria-label="${t.completed?'撤销完成':'标记完成'}：${escape(t.title)}" aria-pressed="${!!t.completed}">${t.completed?checkIcon:''}</button>`}
    <button class="task-detail" data-edit="${escape(t.id)}"><span class="task-name">${escape(t.title)}</span><span class="task-meta">${t.time?`<span class="task-time">${escape(t.time)}</span>`:''}<span class="tag ${t.category==='工作'?'work':t.category==='学习'?'study':''}">${escape(t.category||'生活')}</span>${t.priority==='high'?'<span class="priority-dot" title="重要"></span>':''}${progress.total?`<span class="subtask-badge">子任务 ${progress.done}/${progress.total}</span>`:''}${t.completed&&t.completedDate?`<span>${escape(t.completedDate.slice(5).replace('-','/'))} 完成</span>`:''}</span>${t.notes&&!compact?`<span class="task-note">${escape(t.notes)}</span>`:''}</button>
    ${t.deletedAt?`<button class="restore-button" data-restore="${escape(t.id)}">恢复</button>`:compact?'':`<button class="task-menu" data-edit="${escape(t.id)}" aria-label="编辑：${escape(t.title)}">···</button>`}
    ${progress.total&&!compact&&!t.deletedAt?`<details class="subtask-preview" ${expandedSubtasks.has(t.id)?'open':''}><summary>子任务 ${progress.done}/${progress.total}<span>展开步骤</span></summary>${(t.subtasks||[]).map(item=>`<div class="subtask-preview-row"><button class="check ${item.completed?'checked':''}" data-parent="${escape(t.id)}" data-subtask-toggle="${escape(item.id)}" aria-label="${item.completed?'撤销':'完成'}子任务：${escape(item.title)}" aria-pressed="${item.completed}">${item.completed?checkIcon:''}</button><span class="${item.completed?'subtask-done':''}">${escape(item.title)}${item.completedAt?`<small>完成于 ${escape(formatCompletion(item.completedAt))}</small>`:''}</span></div>`).join('')}</details>`:''}
  </article>`;
}

function empty(title='这里还留着一片空白',description='安排一件想做的事，或给自己一点休息。'){return `<div class="empty-state"><div class="empty-icon">✧</div><h3>${title}</h3><p>${description}</p></div>`}
function render(){renderNav();$('#list-page').hidden=state.page!=='list';$('#calendar-page').hidden=state.page!=='calendar';$('#demo-banner').hidden=prefs.hideDemo||(!serverMode&&tasks.length>0);document.querySelectorAll('[data-page]').forEach(b=>{const selected=b.dataset.page===state.page;b.classList.toggle('active',selected);if(b.getAttribute('role')==='tab')b.setAttribute('aria-selected',selected)});if(state.page==='list')renderList();else renderCalendar();$('#show-completed').textContent=prefs.showCompleted?'◉ 隐藏已完成':'○ 显示已完成';$('#settings-show-completed').checked=prefs.showCompleted;updateSync();if($('#settings-dialog').open)renderSettings()}
function renderNav(){const html=filters.map(([id,label,icon],i)=>`${i===5||i===8?'<div class="filter-divider"></div>':''}<button class="filter ${state.filter===id?'active':''}" data-filter="${id}"><svg viewBox="0 0 24 24">${icons[icon]}</svg><span>${label}</span><span class="count">${tasks.filter(t=>inFilter(t,id)&&(id==='done'||id==='trash'||!t.completed)).length}</span></button>`).join('');$('#filters').innerHTML=html;$('#mobile-filters').innerHTML=filters.map(([id,label])=>`<button data-filter="${id}" class="${state.filter===id?'active':''}">${label}</button>`).join('')}
function renderList(){const td=today(),arr=filterTasks(),all=tasks.filter(t=>inFilter(t,state.filter)),done=all.filter(t=>t.completed).length;$('#list-title').textContent=filters.find(f=>f[0]===state.filter)?.[1]||'计划';$('#list-eyebrow').textContent=`${parseDate(td).getFullYear()} 年 ${fullDate(td)}`;$('#list-subtitle').textContent=state.filter==='trash'?'删除的计划会留在这里，随时可以恢复。':state.filter==='done'?'每一次完成，都有迹可循。':`${all.filter(t=>!t.completed).length} 件待完成 · 按自己的节奏，一件一件来`;$('#progress-card').innerHTML=!['trash','done','unscheduled'].includes(state.filter)&&all.length?`<div class="progress-card"><div><h3>${done===all.length?'都完成了，给自己一点掌声。':'把注意力，留给重要的小事。'}</h3><p>已完成 ${done} / ${all.length} 个计划，${done?'每一步都算数。':'从一件小事开始。'}</p></div><div class="progress-ring" style="--progress:${Math.round(done/all.length*100)}%"><span>${Math.round(done/all.length*100)}%</span></div></div>`:'';let html='';if(!arr.length)html=empty(state.search?'没有找到相关计划':state.filter==='trash'?'回收站是空的':state.filter==='done'?'还没有完成记录':'这里还留着一片空白',state.search?'换个关键词试试。':state.filter==='trash'?'删除的计划会保留在这里。':undefined);else if(['today','tomorrow','unscheduled','trash'].includes(state.filter)){const todo=arr.filter(t=>!t.completed),completed=arr.filter(t=>t.completed);if(todo.length)html+=`<div class="group-title">${state.filter==='trash'?'已删除':'待完成'} <span>${todo.length}</span></div>`+todo.map(t=>taskCard(t)).join('');if(completed.length)html+=`<div class="group-title">已完成 <span>${completed.length}</span></div>`+completed.map(t=>taskCard(t)).join('')}else{let date;for(const t of arr){if(t.date!==date){date=t.date;html+=`<div class="group-title">${date?escape(fullDate(date)):'未安排日期'}</div>`}html+=taskCard(t)}}$('#task-list').innerHTML=html;$('#show-completed').hidden=['trash','done'].includes(state.filter);$('.inline-add').hidden=state.filter==='trash';renderMini()}
function monthCells(anchor){const d=parseDate(anchor);d.setDate(1);const start=weekStart(dateKey(d));return Array.from({length:42},(_,i)=>addDays(start,i))}
function renderMini(){const d=parseDate(state.miniMonth);$('#mini-calendar').innerHTML=`<div class="mini-heading"><span>${d.getFullYear()} 年 ${d.getMonth()+1} 月</span><span><button data-mini="-1" aria-label="小日历上个月">‹</button><button data-mini="1" aria-label="小日历下个月">›</button></span></div><div class="mini-grid">${['一','二','三','四','五','六','日'].map(x=>`<span>${x}</span>`).join('')}${monthCells(state.miniMonth).map(s=>`<button class="mini-day ${s.slice(0,7)!==state.miniMonth.slice(0,7)?'other':''} ${s===today()?'today':''} ${s===state.selected?'selected':''} ${activeTasks().some(t=>t.date===s)?'has-task':''}" data-select="${s}" aria-label="查看 ${s}">${parseDate(s).getDate()}</button>`).join('')}</div>`}
function renderCalendar(){const d=parseDate(state.anchor);$('#calendar-title').textContent=state.view==='month'?`${d.getFullYear()} 年 ${d.getMonth()+1} 月`:`${fullDate(weekStart(state.anchor)).split(' ')[0]} — ${fullDate(addDays(weekStart(state.anchor),6)).split(' ')[0]}`;$('#calendar-subtitle').textContent=state.view==='month'?'月光铺开，日子一格一格慢慢过。':'一周的安排，一眼就能看清。';document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===state.view);b.setAttribute('aria-pressed',b.dataset.view===state.view)});const visible=visibleTasks();if(state.view==='month'){const selected=sortTasks(visible.filter(t=>t.date===state.selected));$('#calendar-body').innerHTML=`<div class="month-layout"><div class="month-board"><div class="week-labels">${['周一','周二','周三','周四','周五','周六','周日'].map(s=>`<span>${s}</span>`).join('')}</div><div class="month-grid">${monthCells(state.anchor).map(s=>{const items=sortTasks(visible.filter(t=>t.date===s));return `<div class="month-cell ${s.slice(0,7)!==state.anchor.slice(0,7)?'other':''} ${s===today()?'today':''} ${s===state.selected?'selected':''}" data-select="${s}" tabindex="0" role="button" aria-label="${s}，${items.length} 个计划"><span class="day-num">${parseDate(s).getDate()}</span>${items.slice(0,3).map(t=>`<button class="month-task ${t.category==='工作'?'work':t.category==='学习'?'study':''} ${t.completed?'done':''}" data-edit="${escape(t.id)}" title="${escape(t.title)}">${escape(t.title)}</button>`).join('')}${items.length>1?`<span class="more-tasks" data-total="${items.length}">${items.length>3?`共 ${items.length} 项`:`${items.length} 项`}</span>`:''}</div>`}).join('')}</div></div><section class="selected-day-panel"><h3>${escape(fullDate(state.selected))}${state.selected===today()?' · 今天':''}</h3><p>${selected.filter(t=>!t.completed).length} 件待完成，留一点时间给自己。</p>${selected.length?selected.map(t=>taskCard(t)).join(''):empty('这一天，等你安排','也可以给过去的日子补上记录。')}<button class="inline-add" data-new-date="${state.selected}">＋ 为这一天添加计划</button></section></div>`}else{const start=weekStart(state.anchor);$('#calendar-body').innerHTML=`<div class="week-scroll"><div class="week-board">${Array.from({length:7},(_,i)=>{const s=addDays(start,i),items=sortTasks(visible.filter(t=>t.date===s));return `<section class="week-column ${s===today()?'today':''}"><div class="week-column-head"><span>${weekday(s)}${s===today()?' · 今天':''}</span><strong>${parseDate(s).getDate()}</strong></div>${items.length?items.map(t=>taskCard(t,true)).join(''):'<div class="week-empty">还没有安排</div>'}<button class="week-add" data-new-date="${s}" aria-label="为 ${s} 添加计划">＋</button></section>`}).join('')}</div></div>`}}
function defaultDate(){if(state.page==='calendar')return state.selected;if(state.filter==='tomorrow')return addDays(today(),1);if(state.filter==='unscheduled')return '';if(state.filter==='nextweek')return addDays(weekStart(today()),7);return today()}
function openEditor(id=null,date=defaultDate()){const t=tasks.find(x=>x.id===id);if(t?.deletedAt){toast('请先恢复这条计划，再进行编辑');return}editorBase=t?structuredClone(t):null;$('#task-form').reset();$('#task-id').value=t?.id||'';$('#editor-heading').textContent=t?'编辑计划':'新建计划';$('#task-title').value=t?.title||'';$('#task-date').value=t?t.date:date;$('#task-time').value=t?.time||'';$('#task-category').value=t?.category||'生活';$('#task-priority').value=t?.priority||'normal';$('#task-notes').value=t?.notes||'';draftSubtasks=structuredClone(t?.subtasks||[]);renderSubtaskEditor();$('#task-completed').checked=!!t?.completed;$('#task-completed-date').value=t?.completedDate||t?.date||date||today();$('#completed-date-field').hidden=!t?.completed;$('#editor-extra').hidden=!t;$('#task-dialog').showModal();if(!t)setTimeout(()=>$('#task-title').focus(),60)}
function closeEditor(){$('#task-dialog').close()}
$('#task-form').addEventListener('submit',e=>{e.preventDefault();const title=$('#task-title').value.trim();if(!title){$('#task-title').setCustomValidity('请填写计划名称');$('#task-title').reportValidity();return}$('#task-title').setCustomValidity('');const date=$('#task-date').value,time=$('#task-time').value;if(time&&!date){toast('设置时间时，请同时选择日期');$('#task-date').focus();return}if(draftSubtasks.some(item=>!item.title.trim())){toast('请填写子任务名称，或移除空白子任务');return}const completed=$('#task-completed').checked,id=$('#task-id').value||uid();mutate(id,{title,date,time,category:$('#task-category').value,priority:$('#task-priority').value,notes:$('#task-notes').value.trim(),...(JSON.stringify(draftSubtasks)!==JSON.stringify(editorBase?.subtasks||[])?{subtasks:structuredClone(draftSubtasks)}:{}),completed,completedDate:completed?($('#task-completed-date').value||date||today()):'',deletedAt:null},editorBase);closeEditor();toast('计划已保存')});
$('#task-title').addEventListener('input',()=>$('#task-title').setCustomValidity(''));
$('#task-completed').addEventListener('change',()=>{$('#completed-date-field').hidden=!$('#task-completed').checked;draftSubtasks=completeSubtasks(draftSubtasks,$('#task-completed').checked);renderSubtaskEditor();if(!$('#task-id').value)$('#task-completed-date').value=$('#task-date').value||today()});
function confirmAction(title,message){return new Promise(resolve=>{const dialog=$('#confirm-dialog');$('#confirm-title').textContent=title;$('#confirm-message').textContent=message;const finish=result=>{dialog.close();resolve(result)};$('#confirm-ok').onclick=()=>finish(true);$('#confirm-cancel').onclick=()=>finish(false);dialog.oncancel=e=>{e.preventDefault();finish(false)};dialog.showModal()})}
async function deleteTask(){const id=$('#task-id').value;if(await confirmAction('移入回收站？','计划和完成记录都会保留，可以随时恢复。')){mutate(id,{deletedAt:new Date().toISOString()});closeEditor();toast('已移入回收站')}}
function renderSettings(){renderCloud();$('#storage-description').textContent=cloud?.user?'当前显示此账号的计划。离线修改保存在设备，恢复连接后同步；冲突会保留副本。退出后仅显示未登录的本机计划。':!serverMode?'记录只保存在当前设备，并保存一份设备内备用快照；不会上传到网站或 GitHub。可在上方登录同一邮箱账号启用手机和平板同步。':connected?'当前数据保存在本机服务。连接同一个服务地址的设备会自动同步；离线修改会暂存在当前设备，重新连接后提交。':'当前数据保存在此设备的浏览器中。请导出备份；连接本机服务后可同步。';$('#settings-stats').innerHTML=`<span>${activeTasks().length} 个计划</span><span>${activeTasks().filter(t=>t.completed).length} 个已完成</span><span>${tasks.filter(t=>t.deletedAt).length} 个回收站</span>`}
function exportData(){const data={app:'rixu',version:1,exportedAt:new Date().toISOString(),tasks};const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`日序备份-${today()}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);toast('已生成备份，请查看下载列表或选择保存到文件')}
function validateTask(t){return t&&validSubtasks(t.subtasks)&&typeof t==='object'&&typeof t.id==='string'&&t.id.length>0&&t.id.length<=100&&typeof t.title==='string'&&t.title.trim().length>0&&t.title.length<=200&&typeof t.date==='string'&&(!t.date||validDate(t.date))&&typeof t.completed==='boolean'&&['生活','学习','工作'].includes(t.category)&&['normal','high'].includes(t.priority)&&typeof t.notes==='string'&&t.notes.length<=10000&&typeof t.time==='string'&&(!t.time||/^([01]\d|2[0-3]):[0-5]\d$/.test(t.time))&&(!t.time||!!t.date)&&(!t.completedDate||validDate(t.completedDate))}
function validDate(s){return /^\d{4}-\d\d-\d\d$/.test(s)&&s>='1900-01-01'&&s<='2200-12-31'&&dateKey(parseDate(s))===s}
$('#import-file').addEventListener('change',async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;if(file.size>10*1024*1024){toast('备份文件超过 10MB，请检查文件');return}let data;try{data=JSON.parse(await file.text());if(data.app!=='rixu'||data.version!==1||!Array.isArray(data.tasks)||data.tasks.length>10000||!data.tasks.every(validateTask))throw Error()}catch{toast('无法读取：请选择有效的日序 JSON 备份');return}if(!await confirmAction('导入备份？',`共 ${data.tasks.length} 条计划，将与现有数据合并。\n相同 ID 的计划以备份内容为准；建议先导出当前数据。`))return;importBusy=true;for(const t of data.tasks){const {id}=t;const patch=Object.fromEntries(['title','date','time','notes','category','priority','completed','completedDate','createdAt','updatedAt','deletedAt','subtasks'].filter(k=>k in t).map(k=>[k,t[k]]));mutate(id,patch)}importBusy=false;saveLocal();toast(`已导入 ${data.tasks.length} 条计划`)});
function setShowCompleted(value){prefs.showCompleted=value;write('rixu-prefs-v1',prefs);render()}
$('#settings-show-completed').addEventListener('change',e=>setShowCompleted(e.target.checked));
$('#search').addEventListener('input',e=>{state.search=e.target.value.trim();render()});
function shiftMonth(s,n){const d=parseDate(s);d.setDate(1);d.setMonth(d.getMonth()+n);return dateKey(d)}
document.addEventListener('click',async e=>{const b=e.target.closest('button,a.brand,[data-select]');if(!b)return;if(b.matches('a.brand')){e.preventDefault();state.page='list';state.filter='today';render();return}const ds=b.dataset;if(ds.subtaskToggle){const task=tasks.find(t=>t.id===ds.parent);const subtasks=toggleSubtask(task.subtasks||[],ds.subtaskToggle);const completed=subtasks.every(item=>item.completed);mutate(task.id,{subtasks,completed,completedDate:completed?(task.completedDate||today()):''});return}else if(ds.subtaskRemove){draftSubtasks=draftSubtasks.filter(item=>item.id!==ds.subtaskRemove);alignDraftCompletion();renderSubtaskEditor();return}else if(ds.page){state.page=ds.page;render()}else if(ds.filter){state.filter=ds.filter;state.page='list';render()}else if(ds.view){state.view=ds.view;render()}else if(ds.edit){openEditor(ds.edit)}else if(ds.toggle){const t=tasks.find(t=>t.id===ds.toggle);mutate(t.id,{completed:!t.completed,completedDate:!t.completed?(t.date&&t.date<today()?t.date:today()):'',...(t.subtasks?.length?{subtasks:completeSubtasks(t.subtasks,!t.completed)}:{})})}else if(ds.restore){mutate(ds.restore,{deletedAt:null});toast('计划已恢复')}else if(ds.newDate){openEditor(null,ds.newDate)}else if(ds.select){state.selected=ds.select;if(state.page!=='calendar'){state.page='calendar';state.view='month';state.anchor=ds.select}render()}else if(ds.mini){state.miniMonth=shiftMonth(state.miniMonth,Number(ds.mini));renderMini()}else if(ds.date){$('#task-date').value=ds.date==='today'?today():ds.date==='tomorrow'?addDays(today(),1):'';if(ds.date==='none')$('#task-time').value=''}else switch(ds.action){case'new':openEditor();break;case'add-subtask':if(draftSubtasks.length>=100){toast('每个计划最多添加 100 个子任务');break}draftSubtasks.push({id:uid(),title:'',completed:false,completedAt:''});alignDraftCompletion();renderSubtaskEditor();$('#subtask-list .subtask-row:last-child .subtask-title').focus();break;case'cloud-sync':sync();break;case'cloud-import':importGuest();break;case'cloud-logout':if(await confirmAction('退出当前账号？','待同步内容仍保留在此账号的设备缓存里，下次登录后继续同步。')){await cloudClient.auth.signOut({scope:'local'});}break;case'install':$('#install-dialog').showModal();break;case'close-install':$('#install-dialog').close();break;case'close-editor':closeEditor();break;case'delete-task':deleteTask();break;case'copy-task':editorBase=null;draftSubtasks=completeSubtasks(draftSubtasks,false);renderSubtaskEditor();$('#task-id').value='';$('#editor-heading').textContent='复制计划';$('#editor-extra').hidden=true;$('#task-completed').checked=false;$('#completed-date-field').hidden=true;toast('修改日期后保存，即可保留两份计划');break;case'settings':renderSettings();$('#settings-dialog').showModal();break;case'close-settings':$('#settings-dialog').close();break;case'export':exportData();break;case'import':$('#import-file').click();break;case'toggle-completed':setShowCompleted(!prefs.showCompleted);break;case'hide-demo':prefs.hideDemo=true;write('rixu-prefs-v1',prefs);render();break;case'search':$('#search-wrap').hidden=!$('#search-wrap').hidden;if(!$('#search-wrap').hidden)$('#search').focus();break;case'clear-search':state.search='';$('#search').value='';$('#search-wrap').hidden=true;render();break;case'calendar-today':state.anchor=today();state.selected=today();render();break;case'previous':case'next':{const n=ds.action==='next'?1:-1;state.anchor=state.view==='month'?shiftMonth(state.anchor,n):addDays(state.anchor,n*7);state.selected=state.anchor;render();break}}});
document.addEventListener('keydown',e=>{if(e.target.matches('input,textarea,select'))return;if(e.target.matches('[data-select]')&&(e.key==='Enter'||e.key===' ')){e.preventDefault();e.target.click()}if(e.key.toLowerCase()==='n'&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!document.querySelector('dialog[open]')){e.preventDefault();openEditor()}});
document.addEventListener('visibilitychange',()=>{if(!document.hidden){render();sync()}});
window.addEventListener('online',sync);window.addEventListener('storage',e=>{if(e.key===storageKey||e.key===queueKey){tasks=read(storageKey,[]);pending=read(queueKey,[]);render()}});
// Only restore a snapshot when the primary store is missing or malformed.
const initial = read(storageKey,null);
if(!Array.isArray(initial)){
  try{const snapshot=await loadSnapshot();if(Array.isArray(snapshot?.tasks)&&snapshot.tasks.every(validateTask)){tasks=snapshot.tasks;write(storageKey,tasks);snapshotAvailable=true}}catch{}
}
render();
if(tasks.length)persistSnapshot();
if(serverMode){sync();setInterval(sync,6000)}
await initializeCloud();
let offlineReady=false;
if('serviceWorker'in navigator&&location.protocol!=='file:'){
  navigator.serviceWorker.register('./sw.js').then(()=>navigator.serviceWorker.ready).then(()=>{offlineReady=true;$('#offline-status').textContent='离线页面已就绪，之后可以断网打开。'}).catch(()=>{$('#offline-status').textContent='离线页面准备失败，请联网重新打开；已有记录仍保存在设备。'});
}else $('#offline-status').textContent='当前打开方式不支持离线安装，请使用正式 HTTPS 地址。';
if(!serverMode&&!read('rixu-install-seen',false)&&!matchMedia('(display-mode: standalone)').matches&&!navigator.standalone){
  $('#install-dialog').showModal();write('rixu-install-seen',true);
}

function renderCloud(){
  if(!$('#cloud-account'))return;
  $('#cloud-account').textContent=cloud?.user?`已登录：${cloud.user.email}`:'未登录，仅保存到此设备。';
  $('#cloud-login').hidden=!!cloud?.user;$('#cloud-controls').hidden=!cloud?.user;
  if(cloud?.user)$('#cloud-message').textContent=cloud.status;
}
async function initializeCloud(){
  const cfg=window.RIXU_CONFIG;
  if(serverMode||!cfg?.supabaseUrl||!window.supabase)return;
  cloudClient=window.supabase.createClient(cfg.supabaseUrl,cfg.supabasePublishableKey,{
    auth:{storageKey:'rixu-auth-v1',persistSession:true,autoRefreshToken:true,detectSessionInUrl:false},
    global:{fetch:(url,options={})=>fetch(url,{...options,signal:options.signal||AbortSignal.timeout(12000)})}
  });
  cloud=new CloudSync({client:cloudClient,storage:localStorage,getTasks:()=>tasks,
    switchAccount(user){
      closeEditor(); accountScope=user?`user:${user.id}`:'guest';
      storageKey=user?`rixu-data-v1:${user.id}`:'rixu-data-v1';
      tasks=read(storageKey,[]);render();
    },
    setTasks(next){if(next.every(validateTask)){tasks=next;write(storageKey,tasks);persistSnapshot();render()}else throw new Error('云端计划格式不完整，已保留本机记录')},
    changed(){updateSync()}
  });
  const cached=read('rixu-auth-v1',null);
  if(cached?.user?.id){await cloud.activate(cached.user);cloud.sync()}
  cloudClient.auth.getSession().then(async({data,error})=>{if(error)return;if(data?.session){await cloud.activate(data.session.user);cloud.sync()}}).catch(()=>{});
  cloudClient.auth.onAuthStateChange((_event,session)=>{setTimeout(async()=>{await cloud.activate(session?.user||null);if(session)cloud.sync()},0)});
  setInterval(()=>{if(!document.hidden)cloud.sync()},7000);
}
$('#cloud-login').addEventListener('submit',async event=>{
  event.preventDefault();if(!cloudClient){toast('同步服务暂时不可用，请联网重新打开');return}
  const button=event.submitter||$('#cloud-login button[type=submit]');button.disabled=true;$('#cloud-message').textContent='正在登录…';
  try{
    const {data,error}=await cloudClient.auth.signInWithPassword({email:$('#cloud-email').value.trim(),password:$('#cloud-password').value});
    $('#cloud-password').value='';if(error)throw error;
    await cloud.activate(data.user);await cloud.sync();
    if(read('rixu-data-v1',[]).length&&!read(`rixu-import-prompt:${data.user.id}`,false)){
      write(`rixu-import-prompt:${data.user.id}`,true);await importGuest();
    }
  }catch(error){$('#cloud-message').textContent=error.code==='invalid_credentials'?'邮箱或密码不正确。请使用已有的周期记账号。':'登录失败或网络超时，请检查网络后重试。'}finally{button.disabled=false}
});
async function importGuest(){
  const guest=read('rixu-data-v1',[]);if(!cloud?.user)return;
  if(!guest.length){toast('没有需要合并的未登录计划');return}
  const userId=cloud.user.id;
  if(!await confirmAction('合并本机计划？',`将 ${guest.length} 条未登录计划合并到 ${cloud.user.email}。\n保留原本机副本；相同 ID 的云端计划会跳过。`))return;
  if(cloud.user?.id!==userId)return;
  await cloud.sync();
  const existing=new Set(tasks.map(t=>t.id));importBusy=true;
  for(const task of guest){if(existing.has(task.id))continue;const {id,...patch}=task;mutate(id,patch)}
  importBusy=false;saveLocal();toast('本机计划已合并，联网后同步');
}

function formatCompletion(value){const d=new Date(value);return `${d.getMonth()+1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`}
function localDatetime(value){const d=new Date(value);return `${dateKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`}
function alignDraftCompletion(){
  if(draftSubtasks.length){$('#task-completed').checked=draftSubtasks.every(item=>item.completed);$('#completed-date-field').hidden=!$('#task-completed').checked}
}
function renderSubtaskEditor(){
  const {done,total}=subtaskProgress(draftSubtasks);$('#subtask-progress').textContent=`${done}/${total}`;
  $('#subtask-list').innerHTML=draftSubtasks.map(item=>`<div class="subtask-row" data-subtask-id="${escape(item.id)}"><div class="subtask-row-main"><input class="subtask-checkbox" type="checkbox" data-subtask-check="${escape(item.id)}" ${item.completed?'checked':''} aria-label="完成子任务"><input class="subtask-title ${item.completed?'subtask-done':''}" data-subtask-title="${escape(item.id)}" value="${escape(item.title)}" maxlength="200" placeholder="例如：看完第一讲的上半节" aria-label="子任务名称"><button type="button" class="icon-button subtask-remove" data-subtask-remove="${escape(item.id)}" aria-label="移除此子任务">×</button></div>${item.completed?`<label class="subtask-time">完成时间 <input type="datetime-local" data-subtask-time="${escape(item.id)}" value="${localDatetime(item.completedAt)}" min="1900-01-01T00:00" max="2200-12-31T23:59"></label>`:''}</div>`).join('');
}
$('#subtask-list').addEventListener('input',event=>{
  const id=event.target.dataset.subtaskTitle;if(!id)return;const item=draftSubtasks.find(x=>x.id===id);if(item)item.title=event.target.value;
});
$('#subtask-list').addEventListener('change',event=>{
  const ds=event.target.dataset;
  if(ds.subtaskCheck){draftSubtasks=toggleSubtask(draftSubtasks,ds.subtaskCheck);alignDraftCompletion();renderSubtaskEditor()}
  else if(ds.subtaskTime){const item=draftSubtasks.find(x=>x.id===ds.subtaskTime);if(item&&event.target.value&&Number.isFinite(new Date(event.target.value).getTime()))item.completedAt=new Date(event.target.value).toISOString();else renderSubtaskEditor()}
});

document.addEventListener('toggle',event=>{if(event.target.matches('details.subtask-preview')&&event.target.isConnected){const id=event.target.closest('[data-task-id]').dataset.taskId;if(event.target.open)expandedSubtasks.add(id);else expandedSubtasks.delete(id)}},true);
