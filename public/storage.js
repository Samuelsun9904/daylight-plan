// A second on-device snapshot. This is not cloud synchronization.
let opening;
function database() {
  if (!opening) opening = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('IndexedDB unavailable'));
    const request = indexedDB.open('rixu-device-snapshots', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('snapshots');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return opening;
}
export async function loadSnapshot() {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction('snapshots').objectStore('snapshots').get('latest');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
let writes = Promise.resolve();
export function saveSnapshot(tasks) {
  const snapshot = { tasks: structuredClone(tasks), savedAt: new Date().toISOString() };
  const next = writes.catch(() => {}).then(async () => {
    const db = await database();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('snapshots', 'readwrite');
      transaction.objectStore('snapshots').put(snapshot, 'latest');
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  });
  writes = next;
  return next;
}
