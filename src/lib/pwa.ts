const SW_CACHE_PREFIX = 'research-clockin-cache-'

async function unregisterServiceWorkersAndCaches(): Promise<void> {
  const registrations = await navigator.serviceWorker.getRegistrations()
  await Promise.all(registrations.map((registration) => registration.unregister()))

  if (!('caches' in window)) {
    return
  }

  const keys = await caches.keys()
  await Promise.all(
    keys
      .filter((key) => key.startsWith(SW_CACHE_PREFIX))
      .map((key) => caches.delete(key)),
  )
}

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) {
    return
  }

  window.addEventListener('load', () => {
    if (import.meta.env.DEV) {
      void unregisterServiceWorkersAndCaches()
      return
    }

    void navigator.serviceWorker.register('/sw.js').then((registration) => {
      void registration.update()
    })
  })
}
