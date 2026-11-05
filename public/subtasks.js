export function validSubtasks(items) {
  if(items===undefined)return true;
  if(!Array.isArray(items)||items.length>100)return false;
  const ids=new Set();
  return items.every(item=>{
    if(!item||typeof item.id!=='string'||!item.id.length||item.id.length>100||ids.has(item.id))return false;
    ids.add(item.id);
    return typeof item.title==='string'&&item.title.trim().length>0&&item.title.length<=200
      &&typeof item.completed==='boolean'&&typeof item.completedAt==='string'
      &&(item.completed?Number.isFinite(Date.parse(item.completedAt)):item.completedAt==='');
  });
}
export function toggleSubtask(items,id,now=new Date().toISOString()) {
  return items.map(item=>item.id===id?{...item,completed:!item.completed,completedAt:item.completed?'':now}:{...item});
}
export function completeSubtasks(items,completed,now=new Date().toISOString()) {
  return items.map(item=>({...item,completed,completedAt:completed?(item.completedAt||now):''}));
}
export function subtaskProgress(items=[]) {
  return {total:items.length,done:items.filter(item=>item.completed).length};
}
