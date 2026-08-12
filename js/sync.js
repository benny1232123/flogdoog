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

    let cfg = store.get(SYNC_KEY, null);

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

    function status() { return cfg ? { endpoint: cfg.endpoint || '', key: cfg.key || '' } : { endpoint: '', key: '' }; }

    async function pull() {
        if (!isConfigured()) return null;
        try {
            const res = await fetch(cfg.endpoint, {
                method: 'GET',
                headers: { 'x-sync-key': cfg.key }
            });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();
            if (data && typeof data === 'object') {
                store.set(OVERLAY_KEY, data); // 覆盖本机覆盖层，供 Editor.applyOverlay 读取
                return data;
            }
            return null;
        } catch (e) {
            console.warn('[LP] 云端拉取失败：', e);
            return null;
        }
    }

    async function push(obj) {
        if (!isConfigured()) return false;
        try {
            const res = await fetch(cfg.endpoint, {
                method: 'PUT',
                headers: { 'content-type': 'application/json', 'x-sync-key': cfg.key },
                body: JSON.stringify(obj || {})
            });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return true;
        } catch (e) {
            console.warn('[LP] 云端推送失败：', e);
            return false;
        }
    }

    LP.Sync = { isConfigured, configure, status, pull, push };

})(window.LP);
