/* =========================================================
   views/mood-view.js — 模块 8 实时心情视图
   由 app.js 拆分：视图渲染 + 交互，经 LP.Views 注册，renderAll 统一调度
   ========================================================= */

(function (LP) {
    'use strict';

    const { $, $$, store, esc, pad, parseDate, dayDiff, fmtDate, fmtRelTime, state, toast, observeReveal, lazyImages, LS } = LP;
    const ICONS = LP.UI.ICONS;
    const icon = LP.UI.icon;
    const MOODS = LP.UI.MOODS;

    /* =========================================================
       模块 8 — 实时心情/状态（新增）
       ========================================================= */
    function renderMood() {
        if (!LP.Mood) return;
        var M = LP.Mood;
        var data = M.load();
        var bar = $('#mood-bar');
        if (!bar) return;

        var cpl = state.config.couple;
        var nameA = (cpl && cpl.a && cpl.a.name) || '阿蛙';
        var nameB = (cpl && cpl.b && cpl.b.name) || '阿狗';

        // 当前心情展示
        var curA = data.currentA, curB = data.currentB;
        var timeA = curA ? fmtRelTime(new Date(curA.time)) : '';
        var timeB = curB ? fmtRelTime(new Date(curB.time)) : '';

        bar.innerHTML = '<div class="mood-title">💭 此刻心情</div>' +
            '<div class="mood-pair">' +
                '<div class="mood-person" data-who="a">' +
                    '<span class="mood-name">' + esc(nameA) + '</span>' +
                    (curA
                        ? '<button class="mood-current" data-who="a" title="点击更换"><span class="mood-emoji">' + esc(curA.emoji) + '</span><span class="mood-label">' + esc(curA.label) + '</span></button>'
                            + (curA.text ? '<p class="mood-text">' + esc(curA.text) + '</p>' : '')
                            + '<small class="mood-time">' + timeA + '</small>'
                        : '<button class="mood-set" data-who="a">设置心情</button>') +
                '</div>' +
                '<div class="mood-divider" aria-hidden="true">♥</div>' +
                '<div class="mood-person" data-who="b">' +
                    '<span class="mood-name">' + esc(nameB) + '</span>' +
                    (curB
                        ? '<button class="mood-current" data-who="b" title="点击更换"><span class="mood-emoji">' + esc(curB.emoji) + '</span><span class="mood-label">' + esc(curB.label) + '</span></button>'
                            + (curB.text ? '<p class="mood-text">' + esc(curB.text) + '</p>' : '')
                            + '<small class="mood-time">' + timeB + '</small>'
                        : '<button class="mood-set" data-who="b">设置心情</button>') +
                '</div>' +
            '</div>' +
            '<div class="mood-trend" id="mood-trend"></div>' +
            '<div class="mood-recent-hint" id="mood-recent-toggle">最近心情 <small>▼</small></div>' +
            '<div class="mood-history" id="mood-history"></div>';

        // 趋势热力图（情绪分布 + 近 12 周活跃度）
        renderMoodTrend(M, data);

        // 最近心情（默认折叠，最多10条）
        renderMoodHistory(data);

        // 绑定事件
        bindMoodEvents(bar);
    }

    function renderMoodTrend(M, data) {
        var el = $('#mood-trend');
        if (!el) return;
        var agg = M.getAggregates(data);
        var colorOf = {};
        M.MOODS.forEach(function (m) { colorOf[m.emoji] = m.color; });

        // 情绪分布 TOP
        var distEntries = Object.keys(agg.dist).map(function (k) { return { emoji: k, n: agg.dist[k] }; })
            .sort(function (a, b) { return b.n - a.n; });
        var chips = distEntries.slice(0, 6).map(function (e) {
            return '<span class="mood-chip" style="--mc:' + (colorOf[e.emoji] || '#e8899a') + '">' + e.emoji + ' ' + e.n + '</span>';
        }).join('');

        // 近 13 周热力图（周日起算）
        function moodKey(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
        var today = new Date(); today.setHours(0, 0, 0, 0);
        var start = new Date(today); start.setDate(start.getDate() - start.getDay() - 12 * 7); // 13 周前那个周日
        var weeks = [];
        for (var w = 0; w < 13; w++) {
            var days = [];
            for (var d = 0; d < 7; d++) {
                var dt = new Date(start); dt.setDate(start.getDate() + w * 7 + d);
                var key = moodKey(dt);
                var info = agg.byDay[key];
                var lvl = info ? Math.min(3, info.count) : 0;
                var color = '#ece6ea';
                if (info) {
                    var dom = Object.keys(info.emojis).sort(function (a, b) { return info.emojis[b] - info.emojis[a]; })[0];
                    color = colorOf[dom] || '#e8899a';
                }
                var future = dt > today;
                var title = key + (info ? (' · ' + info.count + ' 条心情') : (future ? ' · 未到' : ''));
                days.push('<i class="hm-cell lvl-' + lvl + (future ? ' is-future' : '') + '" style="background:' + color + '" title="' + title + '"></i>');
            }
            weeks.push('<div class="hm-week">' + days.join('') + '</div>');
        }

        el.innerHTML =
            '<div class="mood-trend-head">' +
                '<span class="mood-trend-title">💗 心情趋势</span>' +
                '<span class="mood-trend-sub">近 13 周 · 共 ' + agg.total + ' 条记录</span>' +
            '</div>' +
            (chips ? '<div class="mood-chips">' + chips + '</div>' : '') +
            '<div class="heatmap" role="img" aria-label="心情活跃度热力图">' + weeks.join('') + '</div>' +
            '<div class="heatmap-legend"><span>少</span><i class="hm-cell" style="background:#ece6ea"></i><i class="hm-cell" style="background:#e8899a"></i><i class="hm-cell lvl-3" style="background:#e8899a"></i><span>多</span></div>';
    }

    function renderMoodHistory(data) {
        var histEl = $('#mood-history');
        if (!histEl) return;
        // 按时间降序排列（最新的在最上面），再取前 10 条
        var sorted = (data.history || []).slice().sort(function (a, b) {
            var ta = a.time ? new Date(a.time).getTime() : 0;
            var tb = b.time ? new Date(b.time).getTime() : 0;
            return tb - ta; // 降序：新→旧
        });
        var recent = sorted.slice(0, 10);
        if (recent.length === 0) { histEl.innerHTML = '<p class="mood-empty">还没有心情记录</p>'; return; }
        var cpl = state.config.couple;
        var nameA = (cpl && cpl.a && cpl.a.name) || '阿蛙';
        var nameB = (cpl && cpl.b && cpl.b.name) || '阿狗';

        histEl.innerHTML = recent.map(function (entry) {
            var whoName = entry.who === 'a' ? nameA : nameB;
            return '<div class="mh-item">' +
                '<span class="mh-who">' + esc(whoName) + '</span>' +
                '<span class="mh-emoji">' + entry.emoji + '</span>' +
                '<span class="mh-label">' + entry.label + '</span>' +
                (entry.text ? '<span class="mh-text">' + esc(entry.text) + '</span>' : '') +
                '<small class="mh-time">' + fmtRelTime(new Date(entry.time)) + '</small>' +
            '</div>';
        }).join('');
    }

    function bindMoodEvents(bar) {
        // 点击当前心情 → 打开选择器
        $$('.mood-current', bar).forEach(function (btn) {
            btn.addEventListener('click', function () { showMoodPicker(this.dataset.who); });
        });
        // 设置心情按钮
        $$('.mood-set', bar).forEach(function (btn) {
            btn.addEventListener('click', function () { showMoodPicker(this.dataset.who); });
        });

        // 展开/收起最近记录
        var toggle = $('#mood-recent-toggle');
        if (toggle && !toggle._bound) {
            toggle._bound = true;
            toggle.addEventListener('click', function () {
                var h = $('#mood-history');
                if (h) { h.classList.toggle('is-open'); this.querySelector('small').textContent = h.classList.contains('is-open') ? '▲' : '▼'; }
            });
        }
    }

    function showMoodPicker(who) {
        var M = LP.Mood;
        var data = M.load();
        var current = who === 'a' ? data.currentA : data.currentB;

        var html = '<div class="sheet editor-sheet is-open" id="mood-picker-sheet" aria-hidden="false">';
        html += '<div class="sheet-panel editor-panel"><div class="sheet-head">';
        html += '<h3>设置心情</h3>';
        html += '<button class="icon-btn mp-close-btn" aria-label="关闭"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button>';
        html += '</div><div class="editor-body"><div class="ed-group">';

        // emoji 网格
        html += '<div class="mood-grid">';
        M.MOODS.forEach(function (m) {
            var active = current && current.emoji === m.emoji ? ' is-active' : '';
            html += '<button type="button" class="mood-opt' + active + '" data-emoji="' + m.emoji + '" data-label="' + m.label + '" style="--mc:' + m.color + '">' +
                '<span class="mo-emoji">' + m.emoji + '</span><span class="mo-label">' + m.label + '</span></button>';
        });
        html += '</div>';

        // 文字输入
        html += '<label class="ed-row"><span class="ed-label">想说的话</span>';
        html += '<textarea class="ed-input" id="mood-text-input" rows="2" placeholder="此刻在想什么…（可选）">' + (current ? esc(current.text || '') : '') + '</textarea></label>';

        html += '</div></div><div class="editor-foot" style="display:flex;gap:8px;justify-content:center;">';
        html += '<button class="btn-primary" id="mood-save-btn">保存</button>';
        if (current) { html += '<button class="btn-ghost btn-danger" id="mood-clear-btn">清除</button>'; }
        html += '</div></div></div>';

        var old = document.getElementById('mood-picker-sheet');
        if (old) old.remove();

        var wrap = document.createElement('div');
        wrap.innerHTML = html;
        var sheet = wrap.firstElementChild;
        document.body.appendChild(sheet);

        var selectedEmoji = current ? current.emoji : '';
        var selectedLabel = current ? current.label : '';

        // emoji 选择
        $$('.mood-opt', sheet).forEach(function (opt) {
            opt.addEventListener('click', function () {
                $$('.mood-opt', sheet).forEach(function (o) { o.classList.remove('is-active'); });
                this.classList.add('is-active');
                selectedEmoji = this.dataset.emoji;
                selectedLabel = this.dataset.label;
            });
        });

        // 保存
        $('#mood-save-btn').addEventListener('click', function () {
            if (!selectedEmoji) { toast('请选一个心情'); return; }
            M.setMood(who, selectedEmoji, selectedLabel, $('#mood-text-input').value);
            toast('心情已更新 ✓');
            sheet.remove();
            renderMood();
        });

        // 清除
        var clearBtn = $('#mood-clear-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', function () {
                M.clearMood(who);
                toast('已清除 ✓');
                sheet.remove();
                renderMood();
            });
        }

        // 关闭
        $('.mp-close-btn').addEventListener('click', function () { sheet.remove(); });
    }

    LP.Views = LP.Views || {};
    LP.Views.Mood = { render: renderMood };

})(window.LP);
