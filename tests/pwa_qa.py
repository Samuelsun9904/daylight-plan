"""Run against a subdirectory-hosted static app, with no Python data backend."""
import json
import sys
import time
import urllib.request
from browser_qa import target, wait, click, assert_js, ART

url=sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:8766/daylight-plan/'
c=target(url);c.call('Page.enable');c.call('Network.enable')
wait(c,"!!document.querySelector('#list-eyebrow')?.textContent")
if c.evaluate("document.querySelector('#install-dialog').open"):click(c,'[data-action="close-install"]')
assert_js(c,"window.RIXU_CONFIG.storage==='device'",'hosted app is independent of local API')
assert_js(c,"document.querySelector('#sync-status').textContent==='已保存在此设备'",'local-only status is explicit')
wait(c,"!!navigator.serviceWorker.controller")
manifest=c.evaluate("fetch('./manifest.webmanifest').then(r=>r.json())")
assert manifest['display']=='standalone' and manifest['scope']=='./' and manifest['start_url']=='./'
print('PASS subdirectory manifest supports standalone install',flush=True)
c.evaluate("caches.open('cycle-journal-test-preserve').then(c=>c.put('./sentinel',new Response('keep')))")
click(c,'[data-action="new"]')
title='手机独立运行验证 '+str(time.time())
c.evaluate(f"document.querySelector('#task-title').value={json.dumps(title)};document.querySelector('#task-form').requestSubmit()")
assert_js(c,f"document.querySelector('#task-list').textContent.includes({json.dumps(title)})",'new plan works without a server')
wait(c,"new Promise(resolve=>{const r=indexedDB.open('rixu-device-snapshots',1);r.onsuccess=()=>{const q=r.result.transaction('snapshots').objectStore('snapshots').get('latest');q.onsuccess=()=>resolve(!!q.result?.tasks?.length)}})")
print('PASS secondary device snapshot saved',flush=True)
c.call('Network.emulateNetworkConditions',{'offline':True,'latency':0,'downloadThroughput':0,'uploadThroughput':0})
c.call('Page.reload')
wait(c,f"!!document.querySelector('#task-list')?.textContent.includes({json.dumps(title)})")
print('PASS app launches offline with all plan records',flush=True)
click(c,'[data-page="calendar"]');click(c,'[data-view="week"]')
assert_js(c,f"document.querySelector('.week-board').textContent.includes({json.dumps(title)})",'calendar runs offline')
click(c,'[data-page="list"]')
task_id=c.evaluate(f"[...document.querySelectorAll('#task-list .task-card')].find(e=>e.textContent.includes({json.dumps(title)})).dataset.taskId")
click(c,f'[data-toggle="{task_id}"]')
c.call('Page.reload')
wait(c,f"document.querySelector('[data-task-id=\"{task_id}\"]')?.classList.contains('completed')")
print('PASS offline completion survives a full relaunch',flush=True)
# Simulate primary store loss; restore only from this app's secondary snapshot.
c.evaluate("localStorage.removeItem('rixu-data-v1')")
c.call('Page.reload')
wait(c,f"!!document.querySelector('#task-list')?.textContent.includes({json.dumps(title)})")
print('PASS IndexedDB snapshot recovers missing primary storage',flush=True)
assert_js(c,"caches.has('cycle-journal-test-preserve')",'app does not delete another app cache')
c.call('Network.emulateNetworkConditions',{'offline':False,'latency':0,'downloadThroughput':-1,'uploadThroughput':-1})
c.call('Emulation.setDeviceMetricsOverride',{'width':390,'height':844,'deviceScaleFactor':1,'mobile':True})
assert_js(c,"document.documentElement.scrollWidth<=innerWidth",'phone viewport fits')
click(c,'[data-action="settings"]');click(c,'[data-action="install"]')
c.shot('phone-install.png')
click(c,'[data-action="close-install"]');click(c,'[data-action="close-settings"]')
print('PWA offline and install checks passed',flush=True)
