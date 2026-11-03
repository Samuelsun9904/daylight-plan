"""Dependency-free CDP browser QA. Chrome must listen on port 9227."""
import base64
import json
import os
from pathlib import Path
import socket
import struct
import time
import urllib.request
from urllib.parse import urlsplit

ROOT=Path(__file__).resolve().parents[1]
ART=ROOT/'artifacts';ART.mkdir(exist_ok=True)

class CDP:
    def __init__(self,url):
        u=urlsplit(url);self.s=socket.create_connection((u.hostname,u.port),timeout=15);self.n=0
        key=base64.b64encode(os.urandom(16)).decode()
        self.s.sendall(f'GET {u.path} HTTP/1.1\r\nHost: {u.netloc}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n'.encode())
        response=b''
        while not response.endswith(b'\r\n\r\n'):response+=self.s.recv(1)
        assert b'101' in response,response
    def receive(self,n):
        data=b''
        while len(data)<n:
            part=self.s.recv(n-len(data))
            if not part:raise EOFError()
            data+=part
        return data
    def frame(self,payload,opcode=1):
        payload=payload.encode() if isinstance(payload,str) else payload
        n=len(payload);mask=os.urandom(4)
        header=bytes([0x80|opcode,0x80|(n if n<126 else 126 if n<65536 else 127)])
        if n>=126:header+=struct.pack('!H' if n<65536 else '!Q',n)
        self.s.sendall(header+mask+bytes(x^mask[i%4] for i,x in enumerate(payload)))
    def recv(self):
        a,b=self.receive(2);n=b&127
        if n==126:n=struct.unpack('!H',self.receive(2))[0]
        if n==127:n=struct.unpack('!Q',self.receive(8))[0]
        mask=self.receive(4) if b&128 else None
        body=self.receive(n)
        if mask:body=bytes(x^mask[i%4] for i,x in enumerate(body))
        if a&15==9:self.frame(body,10);return self.recv()
        return json.loads(body)
    def call(self,method,params=None):
        self.n+=1;id=self.n;self.frame(json.dumps({'id':id,'method':method,'params':params or {}}))
        while True:
            r=self.recv()
            if r.get('id')==id:
                if 'error'in r:raise RuntimeError(r['error'])
                return r.get('result',{})
    def evaluate(self,expression):
        r=self.call('Runtime.evaluate',{'expression':expression,'returnByValue':True,'awaitPromise':True})
        if 'exceptionDetails'in r:raise RuntimeError(r['exceptionDetails'])
        return r.get('result',{}).get('value')
    def shot(self,name):
        data=self.call('Page.captureScreenshot',{'format':'png','captureBeyondViewport':False})['data']
        (ART/name).write_bytes(base64.b64decode(data))

def target(url='http://127.0.0.1:8765'):
    req=urllib.request.Request('http://127.0.0.1:9227/json/new?'+url,method='PUT')
    return CDP(json.load(urllib.request.urlopen(req))['webSocketDebuggerUrl'])
def wait(c,expression):
    for _ in range(100):
        if c.evaluate(expression):return
        time.sleep(.1)
    raise AssertionError('Timeout: '+expression)
def click(c,selector):c.evaluate(f'document.querySelector({json.dumps(selector)}).click()')
def assert_js(c,expression,label):
    assert c.evaluate(expression),label
    print('PASS',label,flush=True)

if __name__=='__main__':
    c=target();c.call('Runtime.enable');c.call('Page.enable')
    wait(c,"document.querySelectorAll('.task-card').length > 0")
    c.call('Emulation.setDeviceMetricsOverride',{'width':1440,'height':1040,'deviceScaleFactor':1,'mobile':False})
    c.shot('desktop-list.png')
    # Exercise a real historical plan, not only static rendering.
    click(c,'[data-action="new"]')
    c.evaluate("document.querySelector('#task-title').value='QA 历史计划 <script>test</script>';document.querySelector('#task-date').value='2026-02-28';document.querySelector('#task-completed').click();document.querySelector('#task-completed-date').value='2026-03-01';document.querySelector('#task-form').requestSubmit()")
    wait(c,"!document.querySelector('#task-dialog').open")
    click(c,'[data-filter="done"]')
    assert_js(c,"document.querySelector('#task-list').textContent.includes('QA 历史计划 <script>test</script>')",'historical backfill and XSS escaping')
    task_id=c.evaluate("[...document.querySelectorAll('#task-list .task-card')].find(e=>e.textContent.includes('QA 历史计划')).dataset.taskId")
    selector=f'[data-edit="{task_id}"]';click(c,selector)
    assert_js(c,"document.querySelector('#task-completed-date').value==='2026-03-01'",'actual completion date survives editing')
    click(c,'[data-action="delete-task"]');click(c,'#confirm-ok')
    wait(c,"!document.querySelector('#task-dialog').open")
    click(c,'[data-filter="trash"]')
    assert_js(c,"document.querySelector('#task-list').textContent.includes('QA 历史计划')",'soft delete preserves record')
    click(c,f'[data-restore="{task_id}"]')
    assert_js(c,"!document.querySelector('#task-list').textContent.includes('QA 历史计划')",'restore leaves recycle bin')
    # Change the date and observe the same record in both views.
    click(c,'[data-filter="done"]');click(c,selector)
    c.evaluate("document.querySelector('#task-date').value=new Date().getFullYear()+'-'+String(new Date().getMonth()+1).padStart(2,'0')+'-'+String(new Date().getDate()).padStart(2,'0');document.querySelector('#task-completed').click();document.querySelector('#task-form').requestSubmit()")
    click(c,'[data-page="calendar"]')
    assert_js(c,"document.querySelector('#calendar-body').textContent.includes('QA 历史计划')",'rescheduled task appears in month calendar')
    c.shot('tablet-month.png')
    click(c,'[data-view="week"]')
    assert_js(c,"document.querySelectorAll('.week-column').length===7 && document.querySelector('.week-board').textContent.includes('QA 历史计划')",'seven day week view shares tasks')
    c.call('Emulation.setDeviceMetricsOverride',{'width':1024,'height':1366,'deviceScaleFactor':1,'mobile':False})
    c.shot('tablet-week.png')
    c.call('Emulation.setDeviceMetricsOverride',{'width':390,'height':844,'deviceScaleFactor':1,'mobile':True})
    assert_js(c,"document.documentElement.scrollWidth<=innerWidth",'mobile week has no page overflow')
    c.shot('phone-week.png')
    click(c,'[data-view="month"]');c.shot('phone-month.png')
    click(c,'[data-page="list"]');click(c,'[data-filter="today"]');c.shot('phone-list.png')
    assert_js(c,"document.documentElement.scrollWidth<=innerWidth",'mobile list fits viewport')
    # Make a change from another API client; browser refresh must display it.
    op={'id':task_id,'opId':'qa-'+str(time.time()),'patch':{'notes':'来自另一台设备的修改'}}
    req=urllib.request.Request('http://127.0.0.1:8765/api/tasks',method='PATCH',headers={'Content-Type':'application/json'},data=json.dumps({'operations':[op]}).encode())
    urllib.request.urlopen(req).read()
    wait(c,"document.querySelector('#task-list').textContent.includes('来自另一台设备的修改')")
    print('PASS other-device update is polled into UI',flush=True)
    c.call('Page.reload');wait(c,"document.querySelector('#task-list').textContent.includes('来自另一台设备的修改')")
    print('PASS persistence after reload',flush=True)
    # Remove QA plan from active UI but retain it in trash to verify recovery.
    click(c,selector);click(c,'[data-action="delete-task"]');click(c,'#confirm-ok')
    wait(c,"!document.querySelector('#task-dialog').open")
    c.call('Emulation.setDeviceMetricsOverride',{'width':390,'height':844,'deviceScaleFactor':1,'mobile':True});c.shot('phone-list.png')
    c.call('Emulation.setDeviceMetricsOverride',{'width':1440,'height':1040,'deviceScaleFactor':1,'mobile':False});c.shot('desktop-list.png')
    click(c,'[data-page="calendar"]');c.shot('desktop-month.png')
    print('Screenshots:',ART,flush=True)
