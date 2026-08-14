/**
 * LP.Rating — 评分榜 + 餐饮/场所点评模块
 * 数据存 localStorage（key: lp_rating），支持 KV 云端同步。
 */
(function () {
    'use strict';

    const LS_KEY = 'lp_rating';
    const MAX_REVIEWS = 100;

    // 场所分类
    const CATEGORIES = [
        { id: 'restaurant', label: '餐馆', icon: '🍽️' },
        { id: 'bubble_tea', label: '奶茶', icon: '🧋' },
        { id: 'cafe', label: '猫狗咖', icon: '🐱' },
        { id: 'dessert', label: '甜品', icon: '🍰' },
        { id: 'other', label: '其他', icon: '📍' }
    ];

    // 维度评分（适用于各类场所点评）
    const DIMENSIONS = [
        { id: 'taste', label: '口味' },
        { id: 'env', label: '环境' },
        { id: 'service', label: '服务' },
        { id: 'value', label: '性价比' }
    ];

    function getDefaultData() {
        return {
            // 互相打分记录
            scores: {
                a_to_b: [],  // [{ id, score(1-5), comment, date }]
                b_to_a: []
            },
            // 场所点评
            // [{ id, name, category, rating(1-5), dims:{taste,env,service,value}, tags:[], photos:[mediaId], comment, who, date }]
            reviews: []
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

    /* ---- 打分 ---- */

    function addScore(fromWho, toWho, score, comment) {
        var data = load();
        var key = fromWho + '_to_' + toWho;
        if (!data.scores[key]) data.scores[key] = [];
        data.scores[key].push({
            id: genId(),
            score: Math.max(1, Math.min(5, score)),
            comment: (comment || '').trim(),
            date: new Date().toISOString()
        });
        save(data);
        return data;
    }

    /** 获取某人的总分和平均分 */
    function getScoreSummary(who) {
        var data = load();
        var key = who === 'a' ? 'b_to_a' : 'a_to_b';
        var list = data.scores[key] || [];
        if (list.length === 0) return { total: 0, avg: 0, count: 0 };
        var sum = list.reduce(function (s, r) { return s + r.score; }, 0);
        return { total: sum, avg: (sum / list.length).toFixed(1), count: list.length };
    }

    /** 获取最近的打分记录 */
    function getRecentScores(limit) {
        var data = load();
        var all = (data.scores.a_to_b || []).concat(data.scores.b_to_a || []);
        all.sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
        return all.slice(0, limit || 10);
    }

    /* ---- 点评 ---- */

    function addReview(review) {
        var data = load();
        review.id = genId();
        review.rating = Math.max(1, Math.min(5, review.rating || 5));
        review.dims = (review.dims && typeof review.dims === 'object') ? review.dims : null;
        review.tags = Array.isArray(review.tags) ? review.tags : [];
        review.photos = Array.isArray(review.photos) ? review.photos : [];
        review.who = review.who || 'both';
        review.date = new Date().toISOString();
        data.reviews.push(review);
        if (data.reviews.length > MAX_REVIEWS) data.reviews = data.reviews.slice(-MAX_REVIEWS);
        save(data);
        return data;
    }

    function updateReview(id, patch) {
        var data = load();
        var r = data.reviews.find(function (x) { return x.id === id; });
        if (!r) return null;
        Object.keys(patch).forEach(function (k) { r[k] = patch[k]; });
        save(data);
        return data;
    }

    function delReview(id) {
        var data = load();
        data.reviews = data.reviews.filter(function (r) { return r.id !== id; });
        save(data);
        return data;
    }

    function getReviews(category) {
        var list = load().reviews.slice().sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
        if (category) return list.filter(function (r) { return r.category === category; });
        return list;
    }

    /** 按标签筛选点评 */
    function getByTag(tag) {
        var list = load().reviews.slice().sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
        if (!tag) return list;
        return list.filter(function (r) { return (r.tags || []).indexOf(tag) >= 0; });
    }

    /** 获取所有点评标签 */
    function getAllTags() {
        var tagSet = {};
        load().reviews.forEach(function (r) {
            (r.tags || []).forEach(function (t) { tagSet[t] = true; });
        });
        return Object.keys(tagSet).sort();
    }

    /** 计算一条点评的维度平均分（仅统计已填维度） */
    function getDimsAvg(review) {
        if (!review || !review.dims) return null;
        var vals = DIMENSIONS.map(function (d) { return review.dims[d.id]; })
            .filter(function (v) { return v > 0; });
        if (!vals.length) return null;
        var sum = vals.reduce(function (a, b) { return a + b; }, 0);
        return sum / vals.length;
    }

    function exportData() { return load(); }
    function importData(d) {
        if (d && typeof d === 'object') { save(d); return true; }
        return false;
    }

    window.LP = window.LP || {};
    window.LP.Rating = {
        CATEGORIES: CATEGORIES,
        DIMENSIONS: DIMENSIONS,
        MAX_REVIEWS: MAX_REVIEWS,
        load: load,
        save: save,
        addScore: addScore,
        getScoreSummary: getScoreSummary,
        getRecentScores: getRecentScores,
        addReview: addReview,
        updateReview: updateReview,
        delReview: delReview,
        getReviews: getReviews,
        getByTag: getByTag,
        getAllTags: getAllTags,
        getDimsAvg: getDimsAvg,
        exportData: exportData,
        importData: importData
    };
})();
