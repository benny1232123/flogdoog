/* =========================================================
   sync.js — 云端同步客户端（Cloudflare KV + Worker）
   作用：让编辑结果在多台设备间自动一致。
      · 本机配置（云端地址 + 密钥）存 localStorage 键 lp.sync，不随覆盖层同步
      · 覆盖层（站点/资料/纪念日/时间轴/照片墙文本结构）存远端 KV
      · 图片/视频仍存各设备本机 IndexedDB，不跨设备（KV 单值上限 25MB）
   同步策略：最后写入覆盖（last-write-wins），适合两人站点。
   站点未配置云端时完全离线工作，不影响任何功能。
   ========================================================= */
(function (LP) {
    'use strict';

    const { store, toast } = LP;
    const SYNC_KEY = 'lp.sync';        // { endpoint, key } 本机保存
    const OVERLAY_KEY = 'lp.userData'; // 与编辑器共用的覆盖层键

    const TIMEOUT_MS = 20000; // 单次请求最多等 20s，避免无限「同步中」

    // 默认后端：站点同域 Pages Function（main.flogdoog.pages.dev/api/sync）。
    // 说明：flogdoog.pages.dev 生产域由 git 构建提供、目前未挂函数；主别名 main.* 直接部署带函数，
    // 且函数已开 CORS(*)，跨域可用、手机网络可达（不再依赖被手机网络拦截的 workers.dev）。
    // 注：若日后在 Cloudflare 后台把 KV 绑定配到 Pages 项目，可改回同源 '/api/sync'。
    const DEFAULT_SYNC = {
        endpoint: 'https://main.flogdoog.pages.dev/api/sync',
        key: 'Xzy060112'
    };

    let cfg = store.get(SYNC_KEY, null) || DEFAULT_SYNC;

    // 自动迁移：任何旧/错误后端（workers.dev 域、旧的 /api/sync 相对路径、空值）都换成站同域可达地址
    function isLegacyEndpoint(ep) {
        if (!ep) return true;
        if (ep === DEFAULT_SYNC.endpoint) return false;          // 已是正确的默认地址
        if (ep.indexOf('workers.dev') >= 0) return true;          // 旧 Worker 域（手机网络常连不上）
        if (ep === '/api/sync') return true;                      // 旧相对路径（生产域无函数时不工作）
        return false;
    }
    if (isLegacyEndpoint(cfg.endpoint)) {
        cfg.endpoint = DEFAULT_SYNC.endpoint;
        store.set(SYNC_KEY, cfg);
    }

    function isConfigured() {
        return !!(cfg && typeof cfg.endpoint === 'string' && cfg.endpoint && typeof cfg.key === 'string' && cfg.key);
    }

    function configure(endpoint, key) {
        cfg = {
            endpoint: (endpoint || '').replace(/\/+$/, ''),
            key: key || ''
        };
        store.set(SYNC_KEY, cfg);
        return isConfigured();
    }

    function status() { return { endpoint: (cfg && cfg.endpoint) || '', key: (cfg && cfg.key) || '' }; }

    // 带超时的 fetch：超时 / 网络错误都会 reject，让调用方能给出明确提示
    async function fetchWithTimeout(url, opts) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
        try {
            return await fetch(url, Object.assign({ signal: ctrl.signal }, opts));
        } finally {
            clearTimeout(timer);
        }
    }

    async function pull() {
        if (!isConfigured()) return { ok: false, reason: 'unconfigured' };
        try {
            const res = await fetchWithTimeout(cfg.endpoint, {
                method: 'GET',
                headers: { 'x-sync-key': cfg.key }
            });
            if (res.status === 403) return { ok: false, reason: 'forbidden' };
            if (!res.ok) return { ok: false, reason: 'http' + res.status };
            const data = await res.json();
            // 空对象 {} 视为「云端还没有数据」——不要覆盖本机，直接返回空
            if (data && typeof data === 'object' && Object.keys(data).length) {
                store.set(OVERLAY_KEY, data); // 覆盖本机覆盖层，供 Editor.applyOverlay 读取
                // 虚拟房间的装扮也跟着覆盖层一起同步（独立键 lp_room）
                if (data.room && window.LP && LP.Room) {
                    try { LP.Room.importData(data.room); } catch (e) { console.warn('[LP] 房间数据同步失败：', e); }
                }
                return { ok: true, data: data };
            }
            return { ok: true, data: null };
        } catch (e) {
            if (e && e.name === 'AbortError') return { ok: false, reason: 'timeout' };
            console.warn('[LP] 云端拉取失败：', e);
            return { ok: false, reason: 'network' };
        }
    }

    async function push(obj) {
        if (!isConfigured()) return { ok: false, reason: 'unconfigured' };
        try {
            const res = await fetchWithTimeout(cfg.endpoint, {
                method: 'PUT',
                headers: { 'content-type': 'application/json', 'x-sync-key': cfg.key },
                body: JSON.stringify(obj || {})
            });
            if (res.status === 403) return { ok: false, reason: 'forbidden' };
            if (!res.ok) return { ok: false, reason: 'http' + res.status };
            return { ok: true };
        } catch (e) {
            if (e && e.name === 'AbortError') return { ok: false, reason: 'timeout' };
            console.warn('[LP] 云端推送失败：', e);
            return { ok: false, reason: 'network' };
        }
    }

    LP.Sync = { isConfigured, configure, status, pull, push, TIMEOUT_MS, DEFAULT_SYNC };

})(window.LP);
