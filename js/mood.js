/**
 * LP.Mood — 实时心情/状态模块
 * 数据存 localStorage（key: lp_mood），支持 KV 云端同步。
 */
(function () {
    'use strict';

    const LS_KEY = 'lp_mood';
    const MAX_HISTORY = 60; // 保留最近60条

    // 心情选项
    const MOODS = [
        { emoji: '😊', label: '开心', color: '#FFD93D' },
        { emoji: '😢', label: '难过', color: '#A8D8EA' },
        { emoji: '😤', label: '生气', color: '#FF6B6B' },
        { emoji: '😴', label: '疲惫', color: '#C9B1BD' },
        { emoji: '🥰', label: '甜蜜', color: '#FFB7B2' },
        { emoji: '😰', label: '焦虑', color: '#B5EAD7' },
        { emoji: '🤔', label: '思考', color: '#E2F0CB' },
        { emoji: '😎', label: '酷', color: '#C7CEEA' },
        { emoji: '🥺', label: '撒娇', color: '#FFDAC1' },
        { emoji: '🤗', label: '想抱抱', color: '#FF9AA2' },
        { emoji: '😷', label: '不舒服', color: '#D4A5A5' },
        { emoji: '🔥', label: '兴奋', color: '#FF8B94' }
    ];

    function getDefaultData() {
        return {
            currentA: null,  // { emoji, label, text, time }
            currentB: null,
            history: []      // [{ who, emoji, label, text, time }]
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

    /**
     * 设置某人心情
     * @param {'a'|'b} who
     * @param {string} emoji
     * @param {string} label
     * @param {string} text 可选文字
     */
    function setMood(who, emoji, label, text) {
        var data = load();
        var entry = {
            who: who,
            emoji: emoji,
            label: label,
            text: (text || '').trim(),
            time: new Date().toISOString()
        };

        if (who === 'a') data.currentA = entry;
        else data.currentB = entry;

        data.history.unshift(entry);
        if (data.history.length > MAX_HISTORY) data.history = data.history.slice(0, MAX_HISTORY);
        save(data);
        return data;
    }

    function clearMood(who) {
        var data = load();
        if (who === 'a') data.currentA = null;
        else data.currentB = null;
        save(data);
        return data;
    }

    function exportData() { return load(); }
    function importData(d) {
        if (d && typeof d === 'object' && Array.isArray(d.history)) { save(d); return true; }
        return false;
    }

    function fmtISO(d) {
        if (!(d instanceof Date) || isNaN(d.getTime())) return '';
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    /** 心情聚合：按天分布 + 情绪分布，用于趋势热力图 */
    function getAggregates(data) {
        data = data || load();
        var byDay = {};
        (data.history || []).forEach(function (e) {
            var d = e.time ? new Date(e.time) : null;
            if (!d || isNaN(d.getTime())) return;
            var key = fmtISO(d);
            if (!byDay[key]) byDay[key] = { count: 0, emojis: {}, who: {} };
            byDay[key].count++;
            byDay[key].emojis[e.emoji] = (byDay[key].emojis[e.emoji] || 0) + 1;
            byDay[key].who[e.who] = (byDay[key].who[e.who] || 0) + 1;
        });
        var dist = {};
        (data.history || []).forEach(function (e) { dist[e.emoji] = (dist[e.emoji] || 0) + 1; });
        return { byDay: byDay, dist: dist, total: (data.history || []).length };
    }

    window.LP = window.LP || {};
    window.LP.Mood = {
        MOODS: MOODS,
        MAX_HISTORY: MAX_HISTORY,
        load: load,
        save: save,
        setMood: setMood,
        clearMood: clearMood,
        getAggregates: getAggregates,
        exportData: exportData,
        importData: importData
    };
})();
