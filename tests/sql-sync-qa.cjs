const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs');const assert=require('node:assert/strict');
(async()=>{
const db=new PGlite();
await db.exec(`create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create role anon;create role authenticated;grant usage on schema auth to authenticated;`);
await db.exec(fs.readFileSync(require('node:path').join(__dirname,'../migrations/001_private_sync.sql'),'utf8'));
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
await db.query('insert into auth.users values($1),($2)',[a,b]);
const task={title:'原计划',date:'2026-11-04',time:'',notes:'',category:'生活',priority:'normal',completed:false,completedDate:'',deletedAt:null};
async function apply(ops){await db.query('select public.rixu_apply_operations($1::jsonb)',[JSON.stringify(ops)])}
await db.exec(`set role authenticated;set request.jwt.claim.sub='${a}'`);
await apply([{id:'task',opId:'1',patch:task}]);
await apply([{id:'task',opId:'2',patch:{title:'手机改名'},base:{title:'原计划'}}]);
await apply([{id:'task',opId:'3',patch:{notes:'平板改备注'},base:{notes:''}}]);
let rows=(await db.query('select * from public.rixu_tasks')).rows;assert.equal(rows.length,1);assert.equal(rows[0].payload.title,'手机改名');assert.equal(rows[0].payload.notes,'平板改备注');console.log('PASS SQL field merge');
await apply([{id:'task',opId:'4',patch:{title:'离线旧版本'},base:{title:'原计划'}}]);
rows=(await db.query('select * from public.rixu_tasks')).rows;assert.equal(rows.length,2);assert(rows.some(r=>r.payload.title.includes('冲突保留副本')));console.log('PASS SQL conflict preserves version');
await apply([{id:'task',opId:'1',patch:task}]);assert.equal((await db.query("select payload->>'title' title from public.rixu_tasks where task_id='task'")).rows[0].title,'离线旧版本');console.log('PASS SQL retry is idempotent');
await db.exec(`set request.jwt.claim.sub='${b}'`);assert.equal((await db.query('select * from public.rixu_tasks')).rows.length,0);console.log('PASS SQL second account cannot read first account');
try{await db.exec("insert into public.rixu_tasks(owner_id,task_id,payload) values('11111111-1111-4111-8111-111111111111','illegal','{}')");assert.fail('write allowed')}catch(e){assert.match(e.message,/permission denied/)}console.log('PASS direct table writes denied');
await db.exec('reset role;set role anon');try{await apply([]);assert.fail('anon rpc allowed')}catch(e){assert.match(e.message,/permission denied/)}console.log('PASS anonymous RPC denied');
await db.close();
})().catch(e=>{console.error(e);process.exit(1)});
