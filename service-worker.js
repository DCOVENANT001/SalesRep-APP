// SalesRep Service Worker v2.0
// Covenant Technologies
// Handles background sync for offline sales queue

const CACHE_NAME = 'salesrep-v2';
const SYNC_TAG = 'salesrep-sync';

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(clients.claim());
});

// Background Sync
self.addEventListener('sync', event => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(flushAllQueues());
  }
});

// Flush all client offline queues
async function flushAllQueues() {
  try {
    const dbs = await indexedDB.databases();
    for (const dbInfo of dbs) {
      if (!dbInfo.name || !dbInfo.name.startsWith('salesrep-')) continue;
      await flushQueue(dbInfo.name);
    }
  } catch (e) {
    console.error('SW flush error:', e);
  }
}

async function flushQueue(dbName) {
  try {
    const db = await openDB(dbName);
    const queue = await getAllFromDB(db, 'queue');
    if (!queue.length) return;

    for (const item of queue) {
      try {
        const response = await fetch(item.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item.payload)
        });
        if (response.ok) {
          await deleteFromDB(db, 'queue', item.id);
          const allClients = await clients.matchAll();
          allClients.forEach(client => {
            client.postMessage({ type: 'SYNCED', id: item.payload._id });
          });
        }
      } catch (e) {
        break;
      }
    }
  } catch (e) {
    // DB may not exist yet — fine
  }
}

function openDB(name) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 2);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('counters')) db.createObjectStore('counters', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('session')) db.createObjectStore('session', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('inventory')) db.createObjectStore('inventory', { keyPath: 'name' });
      if (!db.objectStoreNames.contains('debts')) db.createObjectStore('debts', { keyPath: 'id', autoIncrement: true });
    };
  });
}

function getAllFromDB(db, store) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = e => resolve(e.target.result || []);
    req.onerror = e => reject(e.target.error);
  });
}

function deleteFromDB(db, store, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = e => reject(e.target.error);
  });
}

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
