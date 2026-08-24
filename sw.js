var CACHE_NAME = "colourit-cache-v5";
var ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./scenes.js",
  "./manifest.json",
  "./icon-180.png",
  "./icon-192.png",
  "./icon-512.png",
  "./images/bike-mountain-road.png",
  "./images/bike-mountain-road-colour.png",
  "./images/car-neotokyo.png",
  "./images/car-neotokyo-colour.png",
  "./images/royal-feast.png",
  "./images/royal-feast-colour.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(ASSETS);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (key) { return key !== CACHE_NAME; })
            .map(function (key) { return caches.delete(key); })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      if (cached) return cached;
      return fetch(event.request).then(function (response) {
        var copy = response.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, copy); });
        return response;
      }).catch(function () {
        if (event.request.mode === "navigate") return caches.match("./index.html");
      });
    })
  );
});
