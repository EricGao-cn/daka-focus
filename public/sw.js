const CACHE_NAME = 'research-clockin-cache-v2'
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/pwa-icon.svg']

function isSameOrigin(requestUrl) {
  return new URL(requestUrl).origin === self.location.origin
}

function isDocumentRequest(request, pathname) {
  return request.mode === 'navigate' || request.destination === 'document' || pathname === '/' || pathname === '/index.html'
}

function isCacheableAsset(pathname) {
  return APP_SHELL.includes(pathname) || pathname.startsWith('/assets/')
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME)
  const cached = await cache.match(request)
  if (cached) {
    return cached
  }

  const response = await fetch(request)
  if (response && response.status === 200 && (response.type === 'basic' || response.type === 'cors')) {
    await cache.put(request, response.clone())
  }
  return response
}

async function networkFirstDocument(request) {
  const cache = await caches.open(CACHE_NAME)

  try {
    const response = await fetch(request)
    if (response && response.status === 200) {
      await cache.put('/index.html', response.clone())
    }
    return response
  } catch (error) {
    const fallback = await cache.match('/index.html')
    if (fallback) {
      return fallback
    }
    throw error
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
      ),
    ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') {
    return
  }

  const url = new URL(request.url)
  if (!isSameOrigin(request.url)) {
    return
  }

  if (isDocumentRequest(request, url.pathname)) {
    event.respondWith(networkFirstDocument(request))
    return
  }

  if (isCacheableAsset(url.pathname)) {
    event.respondWith(cacheFirst(request))
  }
})
