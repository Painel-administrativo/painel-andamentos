// Service Worker do Painel de Andamentos
// Estratégia:
//  - Assets estáticos (JS/CSS/imagens/fontes): cache-first (rápido, funciona offline)
//  - Navegações (HTML): network-first com fallback pro cache (sempre pega versão nova quando online)
//  - API (/api/, /port/5000/): sempre rede (dados sempre frescos, nunca em cache)

const CACHE_VERSION = "v6";
const CACHE_NAME = `painel-andamentos-${CACHE_VERSION}`;

// Precache mínimo — o resto é cacheado sob demanda
const PRECACHE_URLS = [
  "/",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Nunca cacheia chamadas da API — sempre rede
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/port/") ||
    url.hostname.includes("datajud")
  ) {
    return; // deixa o navegador tratar
  }

  // Navegação (HTML): network-first
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((resp) => {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, clone));
          return resp;
        })
        .catch(() => caches.match(req).then((cached) => cached || caches.match("/")))
    );
    return;
  }

  // Assets estáticos: cache-first
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((resp) => {
        // Só cacheia respostas ok e do mesmo origin (evita opaque de CDN)
        if (resp && resp.status === 200 && resp.type === "basic") {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, clone));
        }
        return resp;
      });
    })
  );
});
