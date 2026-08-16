/* =========================================================
   sync.js — 云端同步客户端（Cloudflare KV + Worker）
   作用：让编辑结果在多台设备间自动一致。
      · 本机配置（云端地址 + 密钥）存 localStorage 键 lp.sync，不随覆盖层同步
      · 覆盖层（站点/资料/纪念日/时间轴/照片墙文本结构）存远端 KV
      · 图片/视频：本机存 IndexedDB，云端同步时转 base64 一并带上（KV 单值上限 25MB，已做容量保护）
   同步策略：最后写入覆盖（last-write-wins），适合两人站点。
   站点未配置云端时完全离线工作，不影响任何功能。
   ========================================================= */
(function (LP) {
    'use strict';

    const { store, toast } = LP;
    const SYNC_KEY = 'lp.sync';        // { endpoint, key } 本机保存
    const OVERLAY_KEY = 'lp.userData'; // 与编辑器共用的覆盖层键

    const TIMEOUT_MS = 20000; // 单次请求最多等 20s，避免无限「同步中」
    const MEDIA_CAP = 20 * 1024 * 1024; // 云端媒体 base64 上限（KV 单值上限 25MB，留余量防撑爆）

    // Blob → base64（去掉 data: 前缀），用于把本机媒体随同步上传
    function blobToB64(blob) {
        return new Promise(function (res, rej) {
            const fr = new FileReader();
            fr.onload = function () {
                const s = String(fr.result);
                const i = s.indexOf(',');
                res(i >= 0 ? s.slice(i + 1) : s);
            };
            fr.onerror = function () { rej(fr.error || new Error('读取失败')); };
            fr.readAsDataURL(blob);
        });
    }

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

    // 是否处于「出厂默认」绑定：端点与密钥都等同于 DEFAULT_SYNC（即「你的」云端）。
    // 用于界面提示「出厂已绑定云端（你的数据）」。
    function isFactoryDefault() {
        return !!(cfg && cfg.endpoint === DEFAULT_SYNC.endpoint && cfg.key === DEFAULT_SYNC.key);
    }

    // 恢复出厂绑定：清掉本机自定义的云端配置，重新使用 DEFAULT_SYNC（你的地址+密钥）。
    function resetToFactory() {
        store.remove(SYNC_KEY);
        cfg = { endpoint: DEFAULT_SYNC.endpoint, key: DEFAULT_SYNC.key };
        return status();
    }

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

    // 悄悄话并集：按 id（无 id 用 time|author|text）去重，双方内容都保留
    function unionMessages(local, remote) {
        local = Array.isArray(local) ? local.slice() : [];
        remote = Array.isArray(remote) ? remote.slice() : [];
        const seen = new Set(); const out = [];
        const key = function (m) {
            if (m && m.id) return 'id:' + m.id;
            return 'k:' + (m ? (m.time || '') + '|' + (m.author || '') + '|' + (m.text || '') : '');
        };
        local.forEach(function (m) { const k = key(m); if (!seen.has(k)) { seen.add(k); out.push(m); } });
        remote.forEach(function (m) { const k = key(m); if (!seen.has(k)) { seen.add(k); out.push(m); } });
        return out;
    }

    // 通用数组按 id 并集（无 id 用 JSON 兜底）
    function unionById(local, remote, idOf) {
        local = Array.isArray(local) ? local.slice() : [];
        remote = Array.isArray(remote) ? remote.slice() : [];
        const seen = new Set(); const out = [];
        const f = idOf || function (x) { return JSON.stringify(x); };
        local.forEach(function (it) { const k = f(it); if (!seen.has(k)) { seen.add(k); out.push(it); } });
        remote.forEach(function (it) { const k = f(it); if (!seen.has(k)) { seen.add(k); out.push(it); } });
        return out;
    }

    // 通用深合并：数组字段按 id 并集，对象字段递归合并，其余标量云端优先；用于各独立模块的云端合并
    function deepMergeModules(local, remote) {
        const idKey = function (x) { return x && x.id != null ? String(x.id) : JSON.stringify(x); };
        if (Array.isArray(remote)) {
            return unionById(local || [], remote, idKey);
        }
        if (remote && typeof remote === 'object') {
            const base = (local && typeof local === 'object') ? local : {};
            const out = Object.assign({}, base, remote);
            Object.keys(remote).forEach(function (k) {
                const rv = remote[k], bv = base[k];
                if (Array.isArray(rv) && Array.isArray(bv)) {
                    out[k] = unionById(bv, rv, idKey);
                } else if (rv && typeof rv === 'object' && !Array.isArray(rv) && bv && typeof bv === 'object' && !Array.isArray(bv)) {
                    out[k] = deepMergeModules(bv, rv); // 递归合并嵌套对象（如 rating.scores）
                }
            });
            return out;
        }
        return remote;
    }

    // 需要并入云端同步的独立模块（各自已有 exportData/importData）
    // arr=true 表示数组，按 id 并集；arr=false 表示对象，云端最后写入优先
    const MODULE_SYNC = [
        { ns: 'Mood', key: 'mood', arr: true },
        { ns: 'Schedule', key: 'schedule', arr: true },
        { ns: 'Rating', key: 'rating', arr: true },
        { ns: 'Resources', key: 'resources', arr: true },
        { ns: 'Footprint', key: 'footprint', arr: true },
        { ns: 'Period', key: 'period', arr: false }
    ];

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
                // 写入覆盖层时剔除巨大的 media 字段（base64），避免撑爆 localStorage 配额
                const overlay = Object.assign({}, data);
                delete overlay.media;
                store.set(OVERLAY_KEY, overlay); // 覆盖本机覆盖层，供 Editor.applyOverlay 读取
                // 虚拟房间的装扮也跟着覆盖层一起同步（独立键 lp_room）
                if (data.room && window.LP && LP.Room) {
                    try { LP.Room.importData(data.room); } catch (e) { console.warn('[LP] 房间数据同步失败：', e); }
                }
                // 悄悄话留言板：与本地按稳定键并集，双方内容都保留（不覆盖、不丢）
                if (data.messages && Array.isArray(data.messages)) {
                    try {
                        const local = store.get('lp.messages', null);
                        const merged = unionMessages(local, data.messages);
                        store.set('lp.messages', merged);
                        if (window.LP && LP.renderMessages) LP.renderMessages();
                    } catch (e) { console.warn('[LP] 悄悄话同步失败：', e); }
                }
                // 其余独立模块：拉取后深合并（数组按 id 并集、标量云端优先），双方都保留
                MODULE_SYNC.forEach(function (m) {
                    const rd = data[m.key];
                    if (rd == null) return;
                    const api = window.LP && window.LP[m.ns];
                    if (!api || !api.importData) return;
                    try {
                        const local = api.exportData ? api.exportData() : null;
                        api.importData(deepMergeModules(local, rd));
                    } catch (e) { console.warn('[LP] 模块同步失败: ' + m.key, e); }
                });
                // 云端媒体（base64）→ 写回本机 IndexedDB，作为本地缓存，供 resolveMediaRefs / 照片墙使用
                if (data.media && typeof data.media === 'object' && window.LPMedia && window.LPMedia.importCloud) {
                    try {
                        const n = await window.LPMedia.importCloud(data.media);
                        if (n) console.info('[LP] 已从云端同步 ' + n + ' 个媒体文件到本机');
                    } catch (e) { console.warn('[LP] 云端媒体导入失败：', e); }
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

    // 构造推送包：仅编辑器覆盖层 + 悄悄话 + 房间（编辑器保存时用，不影响其他模块）
    function buildOverlayPayload() {
        const p = Object.assign({}, store.get(OVERLAY_KEY, {}) || {});
        p.messages = store.get('lp.messages', null);
        const room = window.LP && window.LP.Room;
        p.room = (room && room.exportData) ? room.exportData() : null;
        return p;
    }

    // 把本机 IndexedDB 的全部媒体转 base64 构建成 { id: {...} }；超出 MEDIA_CAP 的部分跳过并计入 skipped
    let _mediaSkipped = 0;
    async function buildMediaMap() {
        const out = { map: {}, skipped: [], total: 0 };
        if (!(window.LPMedia && window.LPMedia.all)) return out;
        let recs;
        try { recs = await window.LPMedia.all(); } catch (e) { return out; }
        for (let i = 0; i < recs.length; i++) {
            const r = recs[i];
            if (!r || !r.blob) continue;
            let b64;
            try { b64 = await blobToB64(r.blob); } catch (e) { out.skipped.push(r.name || r.id); continue; }
            const posterSize = (r.poster && r.poster.size) ? r.poster.size : 0;
            const itemSize = b64.length + posterSize;
            // 单个文件过大 → 跳过（避免一次上传把整个 KV 撑爆）
            if (itemSize > MEDIA_CAP) { out.skipped.push(r.name || r.id); continue; }
            // 累计超过上限 → 剩下的跳过（保证 PUT 不超 25MB）
            if (out.total + itemSize > MEDIA_CAP && Object.keys(out.map).length) { out.skipped.push(r.name || r.id); continue; }
            const item = {
                kind: r.kind, name: r.name, mime: r.mime, caption: r.caption,
                date: r.date, w: r.w, h: r.h, size: r.size, duration: r.duration, blob: b64
            };
            if (r.poster && r.poster.size) {
                try { item.poster = await blobToB64(r.poster); } catch (e) { /* 封面失败不影响主文件 */ }
            }
            out.map[r.id] = item;
            out.total += itemSize;
        }
        return out;
    }

    // 构造全量推送包：覆盖层 + 悄悄话 + 房间 + 所有独立模块 + 全部媒体（立即同步/开机上传时用）
    async function buildFullPayload() {
        const p = buildOverlayPayload();
        ['Mood', 'Schedule', 'Rating', 'Resources', 'Footprint', 'Period'].forEach(function (ns) {
            const api = window.LP && window.LP[ns];
            if (api && api.exportData) p[ns.toLowerCase()] = api.exportData();
        });
        const media = await buildMediaMap();
        p.media = media.map;
        _mediaSkipped = media.skipped.length;
        return p;
    }

    // 先拉取合并再上传全量，确保不会用本机旧内容覆盖对方改动（收敛所有模块）
    async function pushAll() {
        if (!isConfigured()) return { ok: false, reason: 'unconfigured' };
        try { await pull(); } catch (e) { console.warn('[LP] pushAll 预拉取失败（继续上传）', e); }
        const r = await push(await buildFullPayload());
        if (r.ok && _mediaSkipped) {
            if (LP.toast) LP.toast('有 ' + _mediaSkipped + ' 个媒体文件过大未同步（仅本机可见）');
            console.warn('[LP] ' + _mediaSkipped + ' 个媒体因超过云端容量上限未同步');
        }
        return r;
    }

    // 防抖自动同步：各模块保存时调用，避免频繁请求
    let _pushTimer = null;
    function schedulePushAll() {
        if (!isConfigured()) return;
        if (_pushTimer) clearTimeout(_pushTimer);
        _pushTimer = setTimeout(function () {
            _pushTimer = null;
            pushAll().catch(function (e) { console.warn('[LP] 自动同步失败：', e); });
        }, 1200);
    }

    LP.Sync = {
        isConfigured, configure, status, pull, push, TIMEOUT_MS, DEFAULT_SYNC,
        isFactoryDefault, resetToFactory,
        buildOverlayPayload, buildFullPayload, pushAll, schedulePushAll
    };

})(window.LP);
