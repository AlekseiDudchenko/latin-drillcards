// Run before any v2 entrypoint, including direct links from an old installation.
if ('serviceWorker' in navigator) {
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.filter(registration => {
    const worker = registration.active ?? registration.waiting ?? registration.installing;
    return worker && new URL(worker.scriptURL).pathname.endsWith('/sw.js')
      && new URL(worker.scriptURL).searchParams.get('app') !== 'v2';
  }).map(registration => registration.unregister()));
}
if ('caches' in globalThis) {
  await Promise.all((await caches.keys()).filter(key => key.startsWith('drillcards-') && !key.startsWith('drillcards-v2-'))
    .map(key => caches.delete(key)));
}
// Unregistering takes effect for this document only after navigation. Do not let
// the still-controlling v1 worker serve modules or API responses to v2.
if (navigator.serviceWorker?.controller
  && new URL(navigator.serviceWorker.controller.scriptURL).pathname.endsWith('/sw.js')
  && new URL(navigator.serviceWorker.controller.scriptURL).searchParams.get('app') !== 'v2') {
  location.reload();
  await new Promise<void>(() => {});
}
export {};
