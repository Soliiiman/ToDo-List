// Service worker: offline support (network-first, so updates show up immediately)
// and handling clicks on reminder notifications.
var CACHE = "taskmanager-v1";
var ASSETS = [
    "./",
    "index.html",
    "css/styles.css",
    "js/i18n.js",
    "js/store.js",
    "js/reminders.js",
    "js/app.js",
    "icon.svg",
    "manifest.webmanifest"
];

self.addEventListener("install", function (event) {
    event.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }));
    self.skipWaiting();
});

self.addEventListener("activate", function (event) {
    event.waitUntil(caches.keys().then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (event) {
    if (event.request.method !== "GET" || new URL(event.request.url).origin !== location.origin) return;
    event.respondWith(
        fetch(event.request).then(function (res) {
            var copy = res.clone();
            caches.open(CACHE).then(function (c) { c.put(event.request, copy); });
            return res;
        }).catch(function () {
            return caches.match(event.request, { ignoreSearch: true });
        })
    );
});

self.addEventListener("notificationclick", function (event) {
    event.notification.close();
    var id = event.notification.data && event.notification.data.id;
    event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
        if (list.length) {
            list[0].postMessage({ open: id });
            return list[0].focus();
        }
        return self.clients.openWindow("./?task=" + encodeURIComponent(id || ""));
    }));
});
