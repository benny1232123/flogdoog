/**
 * LP.Resources — 学术板块 + 分类资料管理
 * 数据存 localStorage（key: lp_resources），支持 KV 云端同步。
 */
(function () {
    'use strict';

    const LS_KEY = 'lp_resources';
    const MAX_ITEMS = 200;

    // 预设分类
    const CATEGORIES = [
        { id: 'paper', label: '论文', icon: '📄' },
        { id: 'book', label: '书籍', icon: '📚' },
        { id: 'course', label: '课程', icon: '🎓' },
        { id: 'tool', label: '工具/网站', icon: '🔧' },
        { id: 'note', label: '笔记', icon: '📝' },
        { id: 'link', label: '链接收藏', icon: '🔗' },
        { id: 'other', label: '其他', icon: '📎' }
    ];

    function getDefaultData() {
        return {
            resources: [],  // [{ id, title, url, category, tags[], abstract, note, date, who }]
            categories: CATEGORIES
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
    }

    function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

    /** 添加资料 */
    function addResource(res) {
        var data = load();
        res.id = genId();
        res.date = new Date().toISOString();
        data.resources.push(res);
        if (data.resources.length > MAX_ITEMS) data.resources = data.resources.slice(-MAX_ITEMS);
        save(data);
        return data;
    }

    function updateResource(id, patch) {
        var data = load();
        var r = data.resources.find(function (x) { return x.id === id; });
        if (!r) return null;
        Object.keys(patch).forEach(function (k) { r[k] = patch[k]; });
        save(data);
        return data;
    }

    function delResource(id) {
        var data = load();
        data.resources = data.resources.filter(function (r) { return r.id !== id; });
        save(data);
        return data;
    }

    /** 搜索 */
    function search(query) {
        var q = (query || '').toLowerCase();
        if (!q) return load().resources;
        return load().resources.filter(function (r) {
            return (r.title || '').toLowerCase().indexOf(q) >= 0 ||
                (r.abstract || '').toLowerCase().indexOf(q) >= 0 ||
                (r.tags || []).some(function (t) { return t.toLowerCase().indexOf(q) >= 0; }) ||
                (r.category || '').toLowerCase().indexOf(q) >= 0;
        });
    }

    /** 按分类获取 */
    function getByCategory(catId) {
        if (!catId) return load().resources;
        return load().resources.filter(function (r) { return r.category === catId; });
    }

    /** 获取所有标签 */
    function getAllTags() {
        var tagSet = {};
        load().resources.forEach(function (r) {
            (r.tags || []).forEach(function (t) { tagSet[t] = true; });
        });
        return Object.keys(tagSet).sort();
    }

    function exportData() { return load(); }
    function importData(d) {
        if (d && typeof d === 'object' && Array.isArray(d.resources)) { save(d); return true; }
        return false;
    }

    window.LP = window.LP || {};
    window.LP.Resources = {
        CATEGORIES: CATEGORIES,
        MAX_ITEMS: MAX_ITEMS,
        load: load,
        save: save,
        addResource: addResource,
        updateResource: updateResource,
        delResource: delResource,
        search: search,
        getByCategory: getByCategory,
        getAllTags: getAllTags,
        exportData: exportData,
        importData: importData
    };
})();
