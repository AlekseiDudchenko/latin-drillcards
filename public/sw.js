/* DrillCards v2 offline worker; no v1 app shell or routing. */
const VERSION = "2.59.0";
const CACHE = `drillcards-v2-${VERSION}`;
const V2_HOME = "/v2/today";

// Minimal shell needed to boot offline; everything else (compiled modules,
// data JSON, esm.sh vendor chunks) is picked up at runtime by the
// stale-while-revalidate handler below.
// v2 only. Never precache or serve the retired SPA.
const SHELL = [V2_HOME, "/style.css", "/v2/card-ui.css", "/manifest.json", "/favicon.svg"];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE)
            .then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: "no-cache" }))))
            .then(() => self.skipWaiting()),
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys()
            // Only this worker's own caches; the v2 pages keep their catalog snapshot (dc-v2-catalog:*).
            .then((keys) => Promise.all(keys.filter((k) => k.startsWith("drillcards-") && k !== CACHE).map((k) => caches.delete(k))))
            .then(() => self.clients.claim()),
    );
});

function isCacheable(url) {
    return url.origin === self.location.origin;
}

async function staleWhileRevalidate(request) {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);
    const network = fetch(request)
        .then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
        })
        .catch(() => undefined);
    return cached ?? (await network) ?? Response.error();
}

/** Scripts and styles are version-locked to the page that loads them: a page
 * fetched from the network with a cached script from the previous release can
 * look up an element the new page no longer has. So these come from the
 * network and the cache is only the offline fallback. Revalidate the HTTP cache
 * too: network-first alone can still return four-hour-old browser-cached code. */
function isCode(request, url) {
    return request.destination === "script" || request.destination === "style" || /\.(?:js|css)$/.test(url.pathname);
}

async function networkFirst(request) {
    const cache = await caches.open(CACHE);
    try {
        const response = await fetch(request, { cache: "no-cache" });
        if (response.ok) cache.put(request, response.clone());
        return response;
    } catch {
        return (await cache.match(request)) ?? Response.error();
    }
}

/** v2 pages are separate documents, cached under their own path. The host may
 * serve /v2/today.html as /v2/today, so both spellings are one key. */
function pageKey(url) {
    return url.pathname.startsWith("/v2/") ? url.pathname.replace(/\.html$/, "") : null;
}

/** A navigation may not be answered with a response that was itself redirected. */
function servable(response) {
    return response.redirected
        ? new Response(response.body, { status: response.status, statusText: response.statusText, headers: response.headers })
        : response;
}

async function handleNavigation(request) {
    const key = pageKey(new URL(request.url));
    try {
        const response = await fetch(request, { cache: "no-cache" });
        // A redirect (e.g. / → the v2 home) is opaque and never cached.
        if (response.ok && response.type === "basic" && key) {
            const cache = await caches.open(CACHE);
            cache.put(key, response.clone());
        }
        return response;
    } catch {
        if (key) {
            const cached = await caches.match(key);
            if (cached) return servable(cached);
        }
        // Offline with the v2 entry: any other page continues on the cached v2 home.
        if (key !== V2_HOME && await caches.match(V2_HOME)) {
            return Response.redirect(new URL(V2_HOME, self.location.origin).href, 302);
        }
        return Response.error();
    }
}

self.addEventListener("fetch", (event) => {
    const request = event.request;
    if (request.method !== "GET" || request.headers.has("range")) return;

    if (request.mode === "navigate") {
        event.respondWith(handleNavigation(request));
        return;
    }

    const url = new URL(request.url);
    if (!isCacheable(url)) return; // analytics, Supabase API → network only

    event.respondWith(isCode(request, url) ? networkFirst(request) : staleWhileRevalidate(request));
});
