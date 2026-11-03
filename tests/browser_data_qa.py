"""Backup, restore and offline queue checks on the live prototype."""
import json
import time
import urllib.request
from browser_qa import target, wait, click, assert_js, ART

def all_tasks():return json.load(urllib.request.urlopen('http://127.0.0.1:8765/api/tasks'))['tasks']

c=target();wait(c,"document.querySelectorAll('.task-card').length>0")
c.call('Page.enable');c.call('Network.enable')
click(c,'[data-page="calendar"]')
initial=c.evaluate("document.querySelector('#calendar-title').textContent")
click(c,'[data-action="previous"]');click(c,'[data-action="next"]')
assert_js(c,f"document.querySelector('#calendar-title').textContent==={json.dumps(initial)}",'month navigation returns to original month')
click(c,'[data-view="week"]');click(c,'[data-action="previous"]');click(c,'[data-action="next"]')
assert_js(c,"document.querySelectorAll('.week-column').length===7",'week navigation retains seven columns')
click(c,'[data-action="settings"]')
c.call('Page.setDownloadBehavior',{'behavior':'allow','downloadPath':str(ART)})
click(c,'[data-action="export"]')
for _ in range(80):
    files=list(ART.glob('日序备份-*.json'))
    if files:break
    time.sleep(.1)
assert files,'backup was not downloaded'
backup=json.loads(files[0].read_text());assert backup['app']=='rixu' and backup['tasks']
assert any(t.get('completed') for t in backup['tasks'])
print('PASS exported JSON contains tasks and completion records',flush=True)
# Import a distinct valid historical plan through file chooser, with confirmation.
id='qa-import-'+str(time.time())
task={'id':id,'title':'QA 导入验证','date':'2025-12-31','time':'','notes':'来自备份文件','category':'生活','priority':'normal','completed':True,'completedDate':'2026-01-01','deletedAt':None}
file=ART/'qa-import.json';file.write_text(json.dumps({'app':'rixu','version':1,'tasks':[task]}))
document=c.call('DOM.getDocument')
node=c.call('DOM.querySelector',{'nodeId':document['root']['nodeId'],'selector':'#import-file'})['nodeId']
c.call('DOM.setFileInputFiles',{'nodeId':node,'files':[str(file)]})
wait(c,"document.querySelector('#confirm-dialog').open");click(c,'#confirm-ok')
wait(c,f"JSON.parse(localStorage.getItem('rixu-data-v1')).some(t=>t.id==={json.dumps(id)})")
for _ in range(70):
    if any(t['id']==id for t in all_tasks()):break
    time.sleep(.1)
assert any(t['id']==id and t['completedDate']=='2026-01-01' for t in all_tasks())
print('PASS backup import reaches durable store with historical completion date',flush=True)
click(c,'[data-action="close-settings"]')
# Exercise actual offline browser behavior and persisted queue.
c.call('Network.emulateNetworkConditions',{'offline':True,'latency':0,'downloadThroughput':0,'uploadThroughput':0})
click(c,'[data-action="new"]')
title='QA 离线新增 '+str(time.time())
c.evaluate(f"document.querySelector('#task-title').value={json.dumps(title)};document.querySelector('#task-form').requestSubmit()")
assert_js(c,f"JSON.parse(localStorage.getItem('rixu-data-v1')).some(t=>t.title==={json.dumps(title)})",'offline creation saved locally')
assert_js(c,"JSON.parse(localStorage.getItem('rixu-pending-v1')).length>0",'offline edits retained in pending queue')
c.call('Network.emulateNetworkConditions',{'offline':False,'latency':0,'downloadThroughput':-1,'uploadThroughput':-1})
c.evaluate("window.dispatchEvent(new Event('online'))")
wait(c,"JSON.parse(localStorage.getItem('rixu-pending-v1')).length===0")
assert any(t['title']==title for t in all_tasks())
print('PASS reconnect commits offline changes to SQLite',flush=True)
# Soft-delete only this script's demonstration records.
ops=[{'id':t['id'],'opId':'cleanup-'+t['id'],'patch':{'deletedAt':'2026-11-03T00:00:00Z'}} for t in all_tasks() if t['id']==id or t['title']==title]
request=urllib.request.Request('http://127.0.0.1:8765/api/tasks',method='PATCH',headers={'Content-Type':'application/json'},data=json.dumps({'operations':ops}).encode())
urllib.request.urlopen(request).read()
print('Additional browser data checks complete',flush=True)
