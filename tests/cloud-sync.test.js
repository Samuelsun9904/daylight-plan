import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {CloudSync} from '../public/cloud.js';
globalThis.crypto ||= webcrypto;
function harness(){
  let tasks=[], current='';const disk=new Map(),remote=new Map();let offline=false,rpcHook,pullHook;
  const client={
    async rpc(_name,{operations}){if(offline)return {error:{message:'offline'}};if(rpcHook)await rpcHook();for(const op of operations)remote.set(op.id,{...remote.get(op.id),...op.patch});return {error:null}},
    from(){return {select(){return this},eq(){return this},order(){return this},async range(start,end){if(pullHook)await pullHook();return offline?{error:{message:'offline'}}:{data:[...remote].sort().map(([task_id,payload])=>({task_id,payload})).slice(start,end+1),error:null}}}}
  };
  const engine=new CloudSync({client,storage:{getItem:k=>disk.get(k),setItem:(k,v)=>disk.set(k,v)},switchAccount:user=>{current=user?.id||'';tasks=JSON.parse(disk.get('tasks:'+current)||'[]')},getTasks:()=>tasks,setTasks:t=>{tasks=t;disk.set('tasks:'+current,JSON.stringify(t))}});
  return {engine,remote,disk,client,get tasks(){return tasks},offline:v=>offline=v,onRpc:f=>rpcHook=f,onPull:f=>pullHook=f};
}
test('offline operations survive and reconnect uploads only edited records',async()=>{
  const h=harness();await h.engine.activate({id:'alice'});h.offline(true);h.engine.record('one',{title:'offline'});await h.engine.sync();assert.equal(h.engine.ops.length,1);assert.match(h.engine.status,/离线/);h.offline(false);await h.engine.sync();assert.equal(h.engine.ops.length,0);assert.equal(h.remote.get('one').title,'offline');
});
test('save while upload is pending remains queued and eventually reaches cloud',async()=>{
  const h=harness();await h.engine.activate({id:'alice'});let resume;h.onRpc(()=>new Promise(r=>resume=r));h.engine.record('one',{title:'first'});const run=h.engine.sync();await new Promise(r=>setTimeout(r,0));h.engine.record('one',{notes:'new edit'});h.onRpc(null);resume();await run;assert.equal(h.remote.get('one').notes,'new edit');
});
test('save during download overlays stale response and stays queued',async()=>{
  const h=harness();await h.engine.activate({id:'alice'});h.remote.set('one',{title:'server'});let resume;h.onPull(()=>new Promise(r=>resume=r));const run=h.engine.sync();await new Promise(r=>setTimeout(r,0));h.engine.record('one',{title:'new local'});resume();await run;assert.equal(h.tasks[0].title,'new local');assert.equal(h.engine.ops.length,1);
});
test('more than 1000 records are paginated without truncation',async()=>{
  const h=harness();await h.engine.activate({id:'alice'});for(let i=0;i<1107;i++)h.remote.set(String(i).padStart(5,'0'),{title:'task'});await h.engine.sync();assert.equal(h.tasks.length,1107);
});
test('late response after switching accounts cannot replace the new account',async()=>{
  const h=harness();await h.engine.activate({id:'alice'});h.engine.record('private',{title:'alice only'});let resume;h.onRpc(()=>new Promise(r=>resume=r));const run=h.engine.sync();await new Promise(r=>setTimeout(r,0));await h.engine.activate({id:'bob'});resume();await run;assert.deepEqual(h.tasks,[]);assert.equal(h.engine.user.id,'bob');assert.equal(h.engine.ops.length,0);assert.equal(JSON.parse(h.disk.get('rixu-cloud-queue:alice')).length,1);
});
test('cloud schema failure keeps pending operations and device data',async()=>{
  const h=harness();await h.engine.activate({id:'alice'});h.engine.record('one',{title:'kept'});h.client.rpc=async()=>({error:{code:'PGRST202'}});await h.engine.sync();assert.equal(h.engine.ops.length,1);assert.equal(h.engine.status,'云端尚未初始化');
});
