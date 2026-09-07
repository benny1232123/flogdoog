/* =========================================================
   sw.js — 我们的小星球 · Service Worker
   作用：让站点可「安装到主屏幕」(PWA) + 离线可用。
   策略：
     · 外壳(index.html / manifest / 图标) 安装时预缓存
     · 导航请求 network-first，离线时回退缓存的 index.html
     · data/config.json network-first（配置会更新，不长期缓存）
     · 其余同源静态资源 cache-first（资源带 ?v= 版本戳，升戳即换新）
     · 跨域请求（Cloudflare KV 同步）直接透传，不缓存
   ========================================================= */
const CACHE = 'flogdoog-sw-v1';

const SHELL = [
    './index.html',
    './manifest.webmanifest',
    './assets/icons/icon.svg',
    './assets/icons/icon-maskable.svg',
    './assets/icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
    self.skipWaiting(); // 新版本立即生效，无需等下次访问
    event.waitUntil(
        caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {})
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);

    // 跨域（云同步等）：直接透传，不缓存，避免污染私密同步链路
    if (url.origin !== self.location.origin) return;

    // 同步 API（/api/sync 及其媒体子路由）：绝不缓存，直接走网络。
    // 否则实时同步轮询会被 SW 返回旧缓存，导致对端改动看不到、同步形同虚设。
    if (url.pathname.indexOf('/api/') === 0) return;

    // 导航（打开页面）：network-first，离线回退缓存的 index.html
    if (req.mode === 'navigate') {
        event.respondWith(
            fetch(req)
                .then((res) => {
                    const copy = res.clone();
                    caches.open(CACHE).then((c) => c.put('./index.html', copy));
                    return res;
                })
                .catch(() => caches.match('./index.html'))
        );
        return;
    }

    // 配置：network-first，失败用缓存（保证版本升级能及时拿到新配置）
    if (url.pathname.endsWith('config.json')) {
        event.respondWith(
            fetch(req)
                .then((res) => {
                    const copy = res.clone();
                    caches.open(CACHE).then((c) => c.put(req, copy));
                    return res;
                })
                .catch(() => caches.match(req))
        );
        return;
    }

    // 其余同源静态资源：cache-first（stale-while-revalidate 思路）
    event.respondWith(
        caches.match(req).then((cached) => {
            const network = fetch(req)
                .then((res) => {
                    if (res && res.status === 200) {
                        const copy = res.clone();
                        caches.open(CACHE).then((c) => c.put(req, copy));
                    }
                    return res;
                })
                .catch(() => cached);
            return cached || network;
        })
    );
});
