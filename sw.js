const CACHE='rixu-shell-v3';
const BASE=new URL('./',self.location.href);
const SHELL=['./','index.html','style.css','app.js','storage.js','cloud.js','vendor/supabase.min.js','runtime-config.js','icon.svg','icon-192.png','icon-512.png','manifest.webmanifest'];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL.map(path=>new URL(path,BASE).href))).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('rixu-shell-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==BASE.origin||!url.pathname.startsWith(BASE.pathname)||url.pathname.includes('/api/'))return;
  event.respondWith((async()=>{
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),4000);
    try{
      const response=await fetch(event.request,{signal:controller.signal,cache:'no-cache'});
      if(response.ok){const cache=await caches.open(CACHE);await cache.put(event.request,response.clone())}
      return response;
    }catch{
      return (await caches.match(event.request,{ignoreSearch:true}))||(event.request.mode==='navigate'?await caches.match(new URL('./',BASE).href):null)||Response.error();
    }finally{clearTimeout(timer)}
  })());
});
