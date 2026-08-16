/* =========================================================
   sync.js — 云端同步客户端（Cloudflare KV + Worker）
   作用：让编辑结果在多台设备间自动一致。
      · 本机配置（云端地址 + 密钥）存 localStorage 键 lp.sync，不随覆盖层同步
      · 覆盖层（站点/资料/纪念日/时间轴/照片墙文本结构）存远端 KV
      · 图片/视频：本机存 IndexedDB；云端按文件分键存储（media:<id>，字节原始存储），
        故总量不受 KV 25MB 单值限制，仅单文件 ≤25MB（KV 硬上限）。元数据(mediaMeta)随主 JSON 同步。
   同步策略：最后写入覆盖（last-write-wins），适合两人站点。
   站点未配置云端时完全离线工作，不影响任何功能。
   ========================================================= */
(function (LP) {
    'use strict';

    const { store, toast } = LP;
    const SYNC_KEY = 'lp.sync';        // { endpoint, key } 本机保存
    const OVERLAY_KEY = 'lp.userData'; // 与编辑器共用的覆盖层键

    const TIMEOUT_MS = 20000; // 单次请求最多等 20s，避免无限「同步中」
    // 单个媒体文件上限：KV 单值硬上限 25MB，超出则跳过（仅本机可见）。
    // 总量不受限：每个文件单独存一个 KV key（media:<id>），键数量不限。
    const PER_FILE_CAP = 25 * 1024 * 1024;

    function mediaListUrl() { return (cfg.endpoint || '').replace(/\/+$/, '') + '/media'; }
    function mediaItemUrl(id) { return (cfg.endpoint || '').replace(/\/+$/, '') + '/media/' + encodeURIComponent(id); }

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
        // 生产 apex 域 flogdoog.pages.dev（无函数绑定，请求会 404/forbidden）一律迁到 main 预览域
        if (ep.indexOf('flogdoog.pages.dev') >= 0 && ep.indexOf('main.flogdoog.pages.dev') < 0) return true;
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

    // 记录最近一次成功推送时间，供实时轮询判断是否「自己刚改的」，避免自回环重渲染
    let _lastPushAt = 0;

    // 顶栏同步状态指示点：init / syncing / ok / error
    function _setStatus(state, detail) {
        if (typeof document === 'undefined' || !document.getElementById) return;
        const el = document.getElementById('sync-status');
        if (!el) return;
        const map = { init: '● 同步状态：初始化…', syncing: '⟳ 正在与云端同步…', ok: '✓ 已与云端同步', error: '⚠ 同步异常' };
        let t = map[state] || '';
        if (state === 'ok' && detail) t += '（' + detail + '）';
        else if (state === 'error' && detail) t += '：' + detail;
        el.dataset.state = state;
        el.title = t;
    }
    function _fmtTime(d) { const p = function (n) { return String(n).padStart(2, '0'); }; return p(d.getHours()) + ':' + p(d.getMinutes()); }

    async function pull(prefetched) {
        if (!isConfigured()) return { ok: false, reason: 'unconfigured' };
        _setStatus('syncing');
        let data;
        if (prefetched !== undefined && prefetched !== null) {
            data = prefetched; // 轮询时已提前取回，避免重复请求
        } else {
            try {
                const res = await fetchWithTimeout(cfg.endpoint, {
                    method: 'GET',
                    headers: { 'x-sync-key': cfg.key }
                });
                if (res.status === 403) { _setStatus('error', '密钥不对'); return { ok: false, reason: 'forbidden' }; }
                if (!res.ok) { _setStatus('error', 'HTTP ' + res.status); return { ok: false, reason: 'http' + res.status }; }
                data = await res.json();
            } catch (e) {
                if (e && e.name === 'AbortError') { _setStatus('error', '超时'); return { ok: false, reason: 'timeout' }; }
                console.warn('[LP] 云端拉取失败：', e);
                _setStatus('error', '网络错误');
                return { ok: false, reason: 'network' };
            }
        }
        // 合并云端数据到本机（可能抛错，统一兜底）
        try {
            // 空对象 {} 视为「云端还没有数据」——不要覆盖本机，直接返回空
            if (data && typeof data === 'object' && Object.keys(data).length) {
                // 写入覆盖层时剔除媒体元数据（仅云端用，本机以 IndexedDB 为准），避免冗余
                const overlay = Object.assign({}, data);
                delete overlay.mediaMeta;
                store.set(OVERLAY_KEY, overlay); // 覆盖本机覆盖层，供 Editor.applyOverlay 读取
                // 虚拟房间的装扮也跟着覆盖层一起同步（独立键 lp_room）
                if (data.room && window.LP && LP.Room) {
                    try { LP.Room.importData(data.room); } catch (e) { console.warn('[LP] 房间数据同步失败：', e); }
                }
                // 悄悄话留言板：与本地按稳定键并集，双方内容都保留（不覆盖、不丢）
                if (data.messages && Array.isArray(data.messages)) {
                    try {
                        const local = store.get('lp.messages', null);
                        let merged = unionMessages(local, data.messages);
                        // 剔除已被任一端标记为删除的消息（避免云端合并不回来）
                        const del = store.get('lp.msgDelIds', {}) || {};
                        if (Object.keys(del).length) merged = merged.filter(function (m) { return !(m.id && del[m.id]); });
                        store.set('lp.messages', merged);
                        if (window.LP && LP.renderMessages) LP.renderMessages();
                    } catch (e) { console.warn('[LP] 悄悄话同步失败：', e); }
                }
                // 已删除消息 ID 集合：两边并集（任一设备删了就全局删）
                if (data.msgDelIds && typeof data.msgDelIds === 'object') {
                    try {
                        const localDel = store.get('lp.msgDelIds', {}) || {};
                        const mergedDel = Object.assign({}, localDel, data.msgDelIds);
                        store.set('lp.msgDelIds', mergedDel);
                        if (window.LP && LP.renderMessages) LP.renderMessages();
                    } catch (e) { console.warn('[LP] 已删除ID同步失败：', e); }
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
                // 云端媒体（分键存储）：按 mediaMeta 列表把本机缺失的文件从 /api/sync/media/<id> 拉回本机 IndexedDB
                try {
                    const n = await pullMedia(data.mediaMeta);
                    if (n) console.info('[LP] 已从云端同步 ' + n + ' 个媒体文件到本机');
                } catch (e) { console.warn('[LP] 云端媒体导入失败：', e); }
                _setStatus('ok', _fmtTime(new Date()));
                return { ok: true, data: data };
            }
            _setStatus('ok', '云端暂无数据');
            return { ok: true, data: null };
        } catch (e) {
            console.warn('[LP] 云端数据合并失败：', e);
            _setStatus('error', '合并失败');
            return { ok: false, reason: 'merge' };
        }
    }

    async function push(obj) {
        if (!isConfigured()) return { ok: false, reason: 'unconfigured' };
        _setStatus('syncing');
        try {
            const res = await fetchWithTimeout(cfg.endpoint, {
                method: 'PUT',
                headers: { 'content-type': 'application/json', 'x-sync-key': cfg.key },
                body: JSON.stringify(obj || {})
            });
            if (res.status === 403) { _setStatus('error', '密钥不对'); return { ok: false, reason: 'forbidden' }; }
            if (!res.ok) { _setStatus('error', 'HTTP ' + res.status); return { ok: false, reason: 'http' + res.status }; }
            _lastPushAt = Date.now();
            _setStatus('ok', _fmtTime(new Date()));
            return { ok: true };
        } catch (e) {
            if (e && e.name === 'AbortError') { _setStatus('error', '超时'); return { ok: false, reason: 'timeout' }; }
            console.warn('[LP] 云端推送失败：', e);
            _setStatus('error', '网络错误');
            return { ok: false, reason: 'network' };
        }
    }

    // 构造推送包：编辑器覆盖层 + 悄悄话 + 房间 + 媒体元数据（编辑器保存/快速同步时用）
    async function buildOverlayPayload() {
        const p = Object.assign({}, store.get(OVERLAY_KEY, {}) || {});
        p.messages = store.get('lp.messages', null);
        const room = window.LP && window.LP.Room;
        p.room = (room && room.exportData) ? room.exportData() : null;
        p.mediaMeta = await buildMediaMeta(); // 带上媒体元数据，避免快速推送把云端 mediaMeta 覆盖掉
        return p;
    }

    // 媒体元数据（文本，存入主 JSON 覆盖层，不含 base64 字节）：id → {kind,name,mime,caption,date,w,h,size,duration,hasPoster}
    // 实际字节按 id 单独存 KV 键 media:<id>，故总量不受 25MB 限制（仅单文件 ≤25MB）
    let _mediaSkipped = 0;

    async function buildMediaMeta() {
        const map = {};
        if (!(window.LPMedia && window.LPMedia.all)) return map;
        let recs;
        try { recs = await window.LPMedia.all(); } catch (e) { return map; }
        recs.forEach(function (r) {
            if (!r || !r.id) return;
            map[r.id] = {
                kind: r.kind, name: r.name, mime: r.mime, caption: r.caption,
                date: r.date, w: r.w, h: r.h, size: r.size, duration: r.duration,
                hasPoster: !!(r.poster && r.poster.size)
            };
        });
        return map;
    }

    // 拉取云端媒体：按 mediaMeta 列表，把本机缺失的文件从 /api/sync/media/<id> 取回并写入本机 IndexedDB
    async function pullMedia(meta) {
        if (!meta || !window.LPMedia || !window.LPMedia.putRemote) return 0;
        const ids = Object.keys(meta);
        if (!ids.length) return 0;
        let imported = 0;
        try {
            const listRes = await fetchWithTimeout(mediaListUrl(), { headers: { 'x-sync-key': cfg.key } });
            const cloudIds = listRes.ok ? (await listRes.json()) : [];
            const cloudSet = new Set(cloudIds);
            for (let i = 0; i < ids.length; i++) {
                const id = ids[i];
                if (!cloudSet.has(id)) continue;          // 云端没有这个文件
                const exist = await window.LPMedia.get(id);
                if (exist && exist.blob) continue;         // 本机已有
                try {
                    const bres = await fetchWithTimeout(mediaItemUrl(id), { headers: { 'x-sync-key': cfg.key } });
                    if (!bres.ok) continue;
                    const blob = new Blob([await bres.arrayBuffer()], { type: meta[id].mime || 'application/octet-stream' });
                    let poster = null;
                    if (meta[id].hasPoster) {
                        try {
                            const pres = await fetchWithTimeout(mediaItemUrl(id + '@poster'), { headers: { 'x-sync-key': cfg.key } });
                            if (pres.ok) poster = new Blob([await pres.arrayBuffer()], { type: 'image/jpeg' });
                        } catch (e) { /* 封面失败不影响主文件 */ }
                    }
                    await window.LPMedia.putRemote(id, blob, meta[id], poster);
                    imported++;
                } catch (e) { console.warn('[LP] 拉取媒体失败: ' + id, e); }
            }
        } catch (e) { console.warn('[LP] 拉取媒体列表失败：', e); }
        return imported;
    }

    // 推送云端媒体：仅上传本机有、且云端缺失的文件（按 id 跳过已存在），单文件超 25MB 跳过
    async function pushMedia() {
        if (!window.LPMedia || !window.LPMedia.all) return;
        let recs;
        try { recs = await window.LPMedia.all(); } catch (e) { return; }
        const cloudIds = new Set();
        try {
            const r = await fetchWithTimeout(mediaListUrl(), { headers: { 'x-sync-key': cfg.key } });
            if (r.ok) (await r.json()).forEach(function (id) { cloudIds.add(id); });
        } catch (e) { /* 列表失败则全部尝试上传 */ }
        _mediaSkipped = 0;
        for (let i = 0; i < recs.length; i++) {
            const r = recs[i];
            if (!r || !r.blob) continue;
            if (r.blob.size > PER_FILE_CAP) { _mediaSkipped++; continue; }
            if (cloudIds.has(r.id)) continue;
            try {
                await fetchWithTimeout(mediaItemUrl(r.id), {
                    method: 'PUT',
                    headers: { 'content-type': r.mime || 'application/octet-stream', 'x-sync-key': cfg.key },
                    body: r.blob
                });
                if (r.poster && r.poster.size) {
                    await fetchWithTimeout(mediaItemUrl(r.id + '@poster'), {
                        method: 'PUT',
                        headers: { 'content-type': 'image/jpeg', 'x-sync-key': cfg.key },
                        body: r.poster
                    });
                }
            } catch (e) { console.warn('[LP] 上传媒体失败: ' + (r.name || r.id), e); }
        }
    }

    // 构造全量推送包：覆盖层 + 悄悄话 + 房间 + 所有独立模块 + 媒体元数据（字节走分键，不在此 JSON 内）
    async function buildFullPayload() {
        const p = await buildOverlayPayload();
        ['Mood', 'Schedule', 'Rating', 'Resources', 'Footprint', 'Period'].forEach(function (ns) {
            const api = window.LP && window.LP[ns];
            if (api && api.exportData) p[ns.toLowerCase()] = api.exportData();
        });
        // 已删除消息 ID 集合（跨设备同步删除）
        if (window.LP && LP.store) {
            const delIds = LP.store.get('lp.msgDelIds', null);
            if (delIds) p.msgDelIds = delIds;
        }
        return p;
    }

    // 先拉取合并再上传全量（含媒体分键上传），确保不会用本机旧内容覆盖对方改动
    async function pushAll() {
        if (!isConfigured()) return { ok: false, reason: 'unconfigured' };
        try { await pull(); } catch (e) { console.warn('[LP] pushAll 预拉取失败（继续上传）', e); }
        const r = await push(await buildFullPayload());
        if (r.ok) await pushMedia();
        if (r.ok && _mediaSkipped) {
            if (LP.toast) LP.toast('有 ' + _mediaSkipped + ' 个媒体文件超过 25MB 未同步（仅本机可见）');
            console.warn('[LP] ' + _mediaSkipped + ' 个媒体单文件超过 KV 25MB 上限未同步');
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

    /* ---------------- 实时同步（轮询拉取） ----------------
       让「这一边改完，另一边立刻看到」：本机每隔 POLL_MS 拉一次云端，
       若云端内容与上次不同（指纹变化），则合并到本机并局部重渲染当前视图。
       自己刚推送过的内容在 3s 内不重拉，避免自回环闪烁。 */
    const POLL_MS = 4000;
    let _pollTimer = null;
    let _liveOn = false;
    let _lastHash = null;

    // 计算云端内容指纹：只取会被同步的关键字段，变化才触发重渲染
    function _hashPayload(data) {
        if (!data || typeof data !== 'object') return null;
        try {
            return JSON.stringify({
                o: data.site,
                m: data.messages,
                mdel: data.msgDelIds,
                r: data.room,
                sc: data.schedule,
                md: data.mood,
                rt: data.rating,
                rs: data.resources,
                fp: data.footprint,
                pd: data.period,
                mm: data.mediaMeta ? Object.keys(data.mediaMeta).sort().join('|') : ''
            });
        } catch (e) { return null; }
    }

    async function _pollTick() {
        if (!isConfigured() || document.hidden) return;
        if (Date.now() - _lastPushAt < 3000) return; // 刚推送过本机内容，跳过自回环
        try {
            const res = await fetchWithTimeout(cfg.endpoint, {
                method: 'GET',
                headers: { 'x-sync-key': cfg.key }
            });
            if (res.status === 403) return;
            if (!res.ok) return;
            const data = await res.json();
            if (!data || typeof data !== 'object' || !Object.keys(data).length) return;
            const hash = _hashPayload(data);
            if (hash == null || hash === _lastHash) return; // 没变化
            _lastHash = hash;
            await pull(data); // 传入已取回的数据，避免重复请求
            if (window.LP && LP.renderAll) LP.renderAll();
            if (window.LP && LP.renderMessages) LP.renderMessages();
        } catch (e) {
            console.warn('[LP] 实时同步轮询失败：', e);
        }
    }

    function _onVisible() {
        if (_liveOn && !document.hidden) _pollTick(); // 切回前台立即同步一次
    }

    function startLiveSync() {
        if (_liveOn || !isConfigured()) return;
        _liveOn = true;
        // 先取一次云端指纹作为基准，避免启动后立刻多余重渲染
        try {
            fetchWithTimeout(cfg.endpoint, { method: 'GET', headers: { 'x-sync-key': cfg.key } })
                .then(function (res) { return res.ok ? res.json() : null; })
                .then(function (d) { _lastHash = _hashPayload(d); _setStatus('ok', '实时同步已开启'); })
                .catch(function () { _setStatus('error', '拉取基准失败'); });
        } catch (e) {}
        _pollTimer = setInterval(_pollTick, POLL_MS);
        document.addEventListener('visibilitychange', _onVisible);
    }

    function stopLiveSync() {
        _liveOn = false;
        if (_pollTimer) clearInterval(_pollTimer);
        _pollTimer = null;
        document.removeEventListener('visibilitychange', _onVisible);
    }

    LP.Sync = {
        isConfigured, configure, status, pull, push, TIMEOUT_MS, DEFAULT_SYNC,
        isFactoryDefault, resetToFactory,
        buildOverlayPayload, buildFullPayload, pushAll, pushMedia, schedulePushAll,
        startLiveSync, stopLiveSync
    };

})(window.LP);
