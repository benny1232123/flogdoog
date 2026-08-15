/**
 * LP.Schedule — 日程/日历/待办/购物清单模块
 * 数据存 localStorage（key: lp_schedule），支持 KV 云端同步。
 */
(function () {
    'use strict';

    const LS_KEY = 'lp_schedule';
    const MAX_ITEMS = 200;

    // 模块级日期工具（供内部函数直接调用，避免 _parseISO 未定义）
    function _parseISO(s) {
        if (!s) return null;
        var d = new Date(s + 'T00:00:00');
        return isNaN(d.getTime()) ? null : d;
    }
    function _fmtISO(d) {
        if (!(d instanceof Date) || isNaN(d.getTime())) return '';
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    // 事件类型
    const TYPES = {
        todo: { label: '待办', icon: '☐', color: '#6B8E23' },
        shopping: { label: '购物', icon: '🛒', color: '#E07020' },
        date: { label: '约会', icon: '💕', color: '#D6455A' },
        reminder: { label: '提醒', icon: '🔔', color: '#7B8CDE' },
        note: { label: '笔记', icon: '📝', color: '#888' }
    };

    function getDefaultData() {
        return {
            events: [],       // [{ id, type, title, date, time, done, who('a'|'b'|'both'), note }]
            mode: 'dual'      // 'single' | 'dual'
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

    /**
     * 添加事件/待办/购物项
     * @param {{ type, title, date?, time?, who?, note? }} item
     */
    function addItem(item) {
        var data = load();
        item.id = genId();
        item.done = !!item.done;
        if (!item.type) item.type = 'todo';
        item.createdAt = new Date().toISOString();
        data.events.push(item);
        if (data.events.length > MAX_ITEMS) data.events = data.events.slice(-MAX_ITEMS);
        save(data);
        return data;
    }

    function updateItem(id, patch) {
        var data = load();
        var ev = data.events.find(function (e) { return e.id === id; });
        if (!ev) return null;
        Object.keys(patch).forEach(function (k) { ev[k] = patch[k]; });
        save(data);
        return data;
    }

    function delItem(id) {
        var data = load();
        data.events = data.events.filter(function (e) { return e.id !== id; });
        save(data);
        return data;
    }

    function toggleDone(id) {
        var data = load();
        var ev = data.events.find(function (e) { return e.id === id; });
        if (ev) { ev.done = !ev.done; save(data); }
        return data;
    }

    /** 获取指定日期的所有事件 */
    function getByDate(dateISO) {
        return load().events.filter(function (e) { return e.date === dateISO; });
    }

    /** 获取未完成的待办/购物 */
    function getPending(type) {
        return load().events.filter(function (e) {
            if (type && e.type !== type) return false;
            return !e.done;
        });
    }

    /** 获取所有事件按日期分组（用于日历渲染） */
    function getEventsByDateMap() {
        var map = {};
        load().events.forEach(function (e) {
            if (!e.date) return;
            if (!map[e.date]) map[e.date] = [];
            map[e.date].push(e);
        });
        return map;
    }

    /** 计算事件在 [from,to] 区间内的发生日期（含每年重复） */
    function occurrenceDates(e, from, to) {
        var res = [];
        if (!e.date) return res;
        if (e.repeat === 'yearly') {
            var md = (e.date + '').slice(5, 10); // MM-DD
            if (!md || md.length < 5) return res;
            for (var y = from.getFullYear(); y <= to.getFullYear(); y++) {
                var iso = y + '-' + md;
                var d = _parseISO(iso);
                if (d && d >= from && d <= to) res.push(iso);
            }
        } else {
            var d2 = _parseISO(e.date);
            if (d2 && d2 >= from && d2 <= to) res.push(e.date);
        }
        return res;
    }

    /** 获取即将到来的带日期事件（含每年重复），按时间排序 */
    function getUpcoming(daysAhead) {
        var data = load();
        var today = new Date(); today.setHours(0, 0, 0, 0);
        var horizon = new Date(today); horizon.setDate(horizon.getDate() + (daysAhead || 60));
        var out = [];
        data.events.forEach(function (e) {
            if (!e.date) return;
            occurrenceDates(e, today, horizon).forEach(function (iso) {
                var d = _parseISO(iso);
                var left = Math.round((d - today) / 86400000);
                out.push({ item: e, dateISO: iso, daysLeft: left, isYearly: e.repeat === 'yearly' });
            });
        });
        out.sort(function (a, b) { return a.daysLeft - b.daysLeft; });
        return out;
    }

    function exportData() { return load(); }
    function importData(d) {
        if (d && typeof d === 'object' && Array.isArray(d.events)) { save(d); return true; }
        return false;
    }

    window.LP = window.LP || {};
    window.LP.Schedule = {
        TYPES: TYPES,
        MAX_ITEMS: MAX_ITEMS,
        load: load,
        save: save,
        addItem: addItem,
        updateItem: updateItem,
        delItem: delItem,
        toggleDone: toggleDone,
        getByDate: getByDate,
        getPending: getPending,
        getEventsByDateMap: getEventsByDateMap,
        getUpcoming: getUpcoming,
        occurrenceDates: occurrenceDates,
        exportData: exportData,
        importData: importData,
        _fmtISO: _fmtISO,
        _parseISO: _parseISO
    };
})();
