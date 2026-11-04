# Uses isolated browser profiles and a simulated auth/cloud transport.
import sys,json,threading,urllib.request
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
sys.path.insert(0,str(Path(__file__).resolve().parent))
from browser_qa import CDP,wait,click,assert_js
remote={}
class H(BaseHTTPRequestHandler):
 def log_message(self,*a):pass
 def do_OPTIONS(self):self.out({})
 def out(self,v):
  raw=json.dumps(v).encode();self.send_response(200);self.send_header('Access-Control-Allow-Origin','*');self.send_header('Access-Control-Allow-Headers','Content-Type');self.end_headers();self.wfile.write(raw)
 def do_GET(self):self.out([{'task_id':id,'payload':t} for id,t in remote.items()])
 def do_POST(self):
  for op in json.loads(self.rfile.read(int(self.headers['Content-Length']))):remote[op['id']]={**remote.get(op['id'],{}),**op['patch']}
  self.out({})
server=ThreadingHTTPServer(('127.0.0.1',8877),H);threading.Thread(target=server.serve_forever,daemon=True).start()
version=json.load(urllib.request.urlopen('http://127.0.0.1:9227/json/version'));browser=CDP(version['webSocketDebuggerUrl'])
script='''window.QA_ERRORS=[];addEventListener('error',e=>QA_ERRORS.push(e.message));addEventListener('unhandledrejection',e=>QA_ERRORS.push(String(e.reason)));(()=>{let callback;const client={auth:{async getSession(){return {data:{session:null}}},onAuthStateChange(cb){callback=cb},async signInWithPassword({email}){const user={id:'qa-account',email};localStorage.setItem('rixu-auth-v1',JSON.stringify({user}));setTimeout(()=>callback('SIGNED_IN',{user}),0);return {data:{user}}},async signOut(){callback('SIGNED_OUT',null);return {}}},async rpc(name,{operations}){try{await fetch('http://127.0.0.1:8877',{method:'POST',body:JSON.stringify(operations)});return {error:null}}catch(e){return {error:e}}},from(){return {select(){return this},eq(){return this},order(){return this},async range(start,end){try{return {data:(await (await fetch('http://127.0.0.1:8877')).json()).slice(start,end+1)}}catch(e){return {error:e}}}}}};Object.defineProperty(window,'supabase',{get:()=>({createClient:()=>client}),set:()=>{}})})()'''
def device():
 ctx=browser.call('Target.createBrowserContext')['browserContextId'];id=browser.call('Target.createTarget',{'url':'about:blank','browserContextId':ctx})['targetId'];c=CDP('ws://127.0.0.1:9227/devtools/page/'+id);c.call('Page.enable');c.call('Network.enable');c.call('Page.addScriptToEvaluateOnNewDocument',{'source':script});c.call('Page.navigate',{'url':'http://127.0.0.1:8766/daylight-plan/'});wait(c,"!!document.querySelector('#list-eyebrow')?.textContent");
 if c.evaluate("document.querySelector('#install-dialog').open"):click(c,'[data-action="close-install"]')
 click(c,'[data-action="settings"]');c.evaluate("document.querySelector('#cloud-email').value='qa@example.test';document.querySelector('#cloud-password').value='qa-password';document.querySelector('#cloud-login').requestSubmit()");wait(c,"document.querySelector('#cloud-account').textContent.includes('qa@example.test')");click(c,'[data-action="close-settings"]');return c,ctx
try:
 a,ac=device();b,bc=device();click(a,'[data-action="new"]');a.evaluate("document.querySelector('#task-title').value='双设备联动';document.querySelector('#task-form').requestSubmit()");wait(b,"document.querySelector('#task-list').textContent.includes('双设备联动')");print('PASS two isolated devices see the same account task')
 id=b.evaluate("document.querySelector('#task-list .task-card').dataset.taskId");click(b,f'[data-toggle="{id}"]');wait(a,"document.querySelector('#task-list .task-card').classList.contains('completed')");print('PASS tablet completion appears on phone')
 click(b,'[data-action="settings"]');click(b,'[data-action="cloud-logout"]');click(b,'#confirm-ok');wait(b,"!document.querySelector('#cloud-login').hidden");click(b,'[data-action="close-settings"]');assert_js(b,"!document.querySelector('#task-list').textContent.includes('双设备联动')",'logout hides account records and restores guest scope')
finally:server.shutdown()
