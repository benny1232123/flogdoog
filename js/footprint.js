/**
 * LP.Footprint — 地图足迹打卡模块
 * 数据存 localStorage（key: lp_footprint），支持 KV 云端同步。
 * 纯前端实现：手动输入地名打卡，列表展示足迹。
 */
(function () {
    'use strict';

    const LS_KEY = 'lp_footprint';
    const MAX_PLACES = 100;

    function getDefaultData() {
        return {
            // 每条打卡：{ id, name, city?, province?, date, who?, note?, lat?, lng?, createdAt }
            places: []
        };
    }

    function load() {
        try {
            var raw = localStorage.getItem(LS_KEY);
            if (raw) { var d = JSON.parse(raw); if (d && typeof d === 'object') return d; }
        } catch (e) {}
        return getDefaultData();
    }

    function save(data) {
        try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch (e) {}
        if (window.LP && LP.Sync && LP.Sync.schedulePushAll) LP.Sync.schedulePushAll();
    }

    function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

    /** 打卡 */
    function addPlace(place) {
        var data = load();
        place.id = genId();
        place.createdAt = new Date().toISOString();
        data.places.push(place);
        if (data.places.length > MAX_PLACES) data.places = data.places.slice(-MAX_PLACES);
        save(data);
        return data;
    }

    function updatePlace(id, patch) {
        var data = load();
        var p = data.places.find(function (x) { return x.id === id; });
        if (!p) return null;
        Object.keys(patch).forEach(function (k) { p[k] = patch[k]; });
        save(data);
        return data;
    }

    function delPlace(id) {
        var data = load();
        data.places = data.places.filter(function (p) { return p.id !== id; });
        save(data);
        return data;
    }

    /** 获取所有足迹，按日期倒序 */
    function getAll() {
        return load().places.slice().sort(function (a, b) {
            return new Date(b.date || b.createdAt) - new Date(a.date || a.createdAt);
        });
    }

    /** 搜索 */
    function search(query) {
        var q = (query || '').toLowerCase();
        if (!q) return getAll();
        return getAll().filter(function (p) {
            return (p.name || '').toLowerCase().indexOf(q) >= 0 ||
                (p.note || '').toLowerCase().indexOf(q) >= 0;
        });
    }

    /** 统计 */
    function getStats() {
        var places = load().places;
        var uniqueNames = {};
        var provinces = {};
        var cities = {};
        places.forEach(function (p) {
            uniqueNames[p.name] = true;
            if (p.province) provinces[p.province] = true;
            if (p.city) cities[p.city] = true;
        });
        return {
            total: places.length,
            unique: Object.keys(uniqueNames).length,
            provinces: Object.keys(provinces).length,
            cities: Object.keys(cities).length
        };
    }

    function exportData() { return load(); }
    function importData(d) {
        if (d && typeof d === 'object' && Array.isArray(d.places)) { save(d); return true; }
        return false;
    }

    window.LP = window.LP || {};
    window.LP.Footprint = {
        MAX_PLACES: MAX_PLACES,
        load: load,
        save: save,
        addPlace: addPlace,
        updatePlace: updatePlace,
        delPlace: delPlace,
        getAll: getAll,
        search: search,
        getStats: getStats,
        exportData: exportData,
        importData: importData
    };
})();
