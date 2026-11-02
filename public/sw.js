const CACHE_PREFIX = "worth-field";
const CACHE_NAME = `${CACHE_PREFIX}-v2`;
const NAVIGATION_FALLBACK = "/index.html";
const APP_SHELL = [
  NAVIGATION_FALLBACK,
  "/asset-manifest.json",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(cacheRelease());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  event.respondWith(url.pathname.startsWith("/assets/") ? cacheFirstAsset(request) : networkFirstAsset(request));
});

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(NAVIGATION_FALLBACK, response.clone());
    }
    return response;
  } catch {
    return (await caches.match(NAVIGATION_FALLBACK)) ?? Response.error();
  }
}

async function cacheRelease() {
  const cache = await caches.open(CACHE_NAME);
  await cache.addAll(APP_SHELL);

  const manifestResponse = await fetch("/asset-manifest.json", { cache: "no-store" });
  if (!manifestResponse.ok) {
    throw new Error("Production asset manifest could not be loaded.");
  }

  const manifest = await manifestResponse.json();
  const assetPaths = new Set();
  for (const entry of Object.values(manifest)) {
    if (!entry || typeof entry !== "object") continue;
    addAssetPath(assetPaths, entry.file);
    for (const path of entry.css ?? []) addAssetPath(assetPaths, path);
    for (const path of entry.assets ?? []) addAssetPath(assetPaths, path);
  }

  await cache.addAll([...assetPaths]);
}

function addAssetPath(paths, value) {
  if (typeof value !== "string" || value.length === 0) return;
  paths.add(value.startsWith("/") ? value : `/${value}`);
}

async function cacheFirstAsset(request) {
  const cached = await caches.match(request, { ignoreVary: true });
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}

async function networkFirstAsset(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return (await caches.match(request, { ignoreVary: true })) ?? Response.error();
  }
}
