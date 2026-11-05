// UI-independent, account-scoped incremental synchronization.
export class CloudSync {
  constructor({client, storage, switchAccount, getTasks, setTasks, changed}) {
    Object.assign(this,{client,storage,switchAccount,getTasks,setTasks,changed});
    this.user=null;this.ops=[];this.generation=0;this.running=null;this.status='未登录';
  }
  key(){return `rixu-cloud-queue:${this.user.id}`}
  persist(){this.storage.setItem(this.key(),JSON.stringify(this.ops))}
  notify(status){this.status=status;this.changed?.(this)}
  async activate(user){
    if(this.user?.id===user?.id){this.user=user;return}
    ++this.generation;this.user=user;this.running=null;this.ops=[];
    this.switchAccount(user);
    if(user){try{this.ops=JSON.parse(this.storage.getItem(this.key())||'[]')}catch{this.ops=[]}}
    this.notify(user?'待同步':'未登录');
  }
  record(id,patch,base={}){
    if(!this.user)return;
    this.ops.push({opId:globalThis.crypto.randomUUID(),id,patch,base});
    this.persist();this.notify(`待同步 ${this.ops.length} 项`);
  }
  sync(){
    if(!this.user)return Promise.resolve();
    if(this.running)return this.running;
    const generation=this.generation;
    const job=this.exchange(generation).finally(()=>{if(this.running===job)this.running=null});
    this.running=job;return job;
  }
  async exchange(generation){
    const valid=()=>generation===this.generation;
    this.notify('正在同步…');
    try{
      while(valid()&&this.ops.length){
        const batch=this.ops.slice(0,100);
        const {error}=await this.client.rpc('rixu_apply_operations',{operations:batch});
        if(!valid())return;
        if(error)throw error;
        const sent=new Set(batch.map(op=>op.opId));
        this.ops=this.ops.filter(op=>!sent.has(op.opId));this.persist();
      }
      const rows=[];
      for(let offset=0;valid();offset+=500){
        const {data,error}=await this.client.from('rixu_tasks').select('task_id,payload').eq('owner_id',this.user.id).order('task_id').range(offset,offset+499);
        if(!valid())return;
        if(error)throw error;
        rows.push(...data);if(data.length<500)break;
      }
      if(!valid())return;
      const map=new Map(rows.map(row=>[row.task_id,{...row.payload,id:row.task_id}]));
      // Saves made during download overlay the server response and remain queued.
      for(const op of this.ops)map.set(op.id,{...map.get(op.id),id:op.id,...op.patch});
      this.setTasks([...map.values()]);
      this.notify(this.ops.length?`待同步 ${this.ops.length} 项`:'所有计划已同步');
    }catch(error){
      if(!valid())return;
      const code=String(error.code||'');
      this.notify(['PGRST205','PGRST202','42P01'].includes(code)?'云端尚未初始化':error.message==='Invalid fields'?'需要运行子任务云端升级脚本':error.status===401||code==='PGRST301'?'登录已过期，请重新登录':`离线或连接失败，待同步 ${this.ops.length} 项`);
      this.error=error;
    }
  }
}
