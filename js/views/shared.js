/* =========================================================
   views/shared.js — 视图层共享常量
   由 app.js 上移：图标库 / 悄悄话心情词，经 LP.UI 供各视图模块使用
   ========================================================= */

(function (LP) {
    'use strict';

    const ICONS = {
        heart: '<svg viewBox="0 0 32 29" fill="currentColor"><path d="M16 28S1 18.5 1 9.8A8.8 8.8 0 0 1 16 4.4 8.8 8.8 0 0 1 31 9.8C31 18.5 16 28 16 28z"/></svg>',
        cake: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20h16v-6a3 3 0 00-3-3H7a3 3 0 00-3 3v6z"/><path d="M12 8V4"/><path d="M4 16c2 1.4 4 1.4 6 0s4-1.4 6 0 2 1.4 4 0"/></svg>',
        plane: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 13l20-8-8 20-2-8-10-4z"/></svg>',
        ring: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="15" r="6"/><path d="M9 6l3-3 3 3-3 3-3-3z"/></svg>',
        home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>',
        star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 18l-5.9 3 1.2-6.5L2.5 9.9 9.1 9 12 3z"/></svg>',
        heartLine: '<svg viewBox="0 0 32 29"><path d="M16 28S1 18.5 1 9.8A8.8 8.8 0 0 1 16 4.4 8.8 8.8 0 0 1 31 9.8C31 18.5 16 28 16 28z"/></svg>'
        };

    const MOODS = ['想你', '开心', '有点累', '抱抱', '对不起', '谢谢你'];

    LP.UI = {
        ICONS: ICONS,
        MOODS: MOODS,
        icon: function (name) { return ICONS[name] || ICONS.star; }
    };

})(window.LP);
