/* =========================================================
   views/footprint-view.js — 模块 12 地图足迹视图
   由 app.js 拆分：视图渲染 + 交互，经 LP.Views 注册，renderAll 统一调度
   ========================================================= */

(function (LP) {
    'use strict';

    const { $, $$, store, esc, pad, parseDate, dayDiff, fmtDate, fmtRelTime, state, toast, observeReveal, lazyImages, LS } = LP;
    const ICONS = LP.UI.ICONS;
    const icon = LP.UI.icon;
    const MOODS = LP.UI.MOODS;

    /* =========================================================
       模块 12 — 地图足迹打卡（新增）
       ========================================================= */
    /* 模块 12 — 地图足迹打卡 */
    // 模块级：当前按省份筛选（null 表示全部）
    var fpProvFilter = null;

    // 计算访问过的省份 -> { 省名: 打卡次数 }
    function fpVisited(FP) {
        var visited = {};
        FP.getAll().forEach(function (p) {
            if (p.province) visited[p.province] = (visited[p.province] || 0) + 1;
        });
        return visited;
    }

    function renderFootprint() {
        if (!LP.Footprint) return;
        var FP = LP.Footprint;

        // 统计
        var statsEl = $('#fp-stats');
        if (statsEl) {
            var stats = FP.getStats();
            statsEl.innerHTML = '<div class="fp-stat-cards">' +
                '<div class="fp-stat"><span class="fp-stat-num">' + stats.total + '</span><span class="fp-stat-label">次打卡</span></div>' +
                '<div class="fp-stat"><span class="fp-stat-num">' + stats.unique + '</span><span class="fp-stat-label">个地方</span></div>' +
                '<div class="fp-stat"><span class="fp-stat-num">' + stats.cities + '</span><span class="fp-stat-label">个城市</span></div>' +
                '<div class="fp-stat"><span class="fp-stat-num">' + stats.provinces + '</span><span class="fp-stat-label">省份 / 地区</span></div>' +
            '</div>';
        }

        // 省份下拉（只初始化一次，保留选择）
        var provSel = $('#fp-province-input');
        if (provSel && !provSel._filled && LP.chinaMap && LP.chinaMap.provinces) {
            provSel._filled = true;
            var opts = '<option value="">省份 / 地区…</option>';
            LP.chinaMap.provinces.forEach(function (p) {
                if (!p.name) return;
                opts += '<option value="' + esc(p.name) + '">' + esc(p.name) + '</option>';
            });
            provSel.innerHTML = opts;
        }

        // 省级行政区总数
        var pt = $('#fp-prov-total');
        if (pt && LP.chinaMap) pt.textContent = LP.chinaMap.provinces.filter(function (p) { return p.name; }).length;

        // 默认日期为今天
        var dateInput = $('#fp-date-input');
        if (dateInput && !dateInput.value) dateInput.value = new Date().toISOString().slice(0, 10);

        // 城市自动补全（只填充一次）
        var cityList = $('#fp-city-list');
        if (cityList && !cityList._filled) {
            cityList._filled = true;
            var commonCities = [
                '北京','上海','广州','深圳','杭州','成都','重庆','武汉','西安','南京',
                '天津','苏州','长沙','郑州','青岛','大连','宁波','厦门','昆明','三亚',
                '桂林','丽江','拉萨','乌鲁木齐','哈尔滨','沈阳','长春','合肥','福州','南昌',
                '贵阳','南宁','海口','呼和浩特','太原','石家庄','兰州','西宁','银川','台北',
                '香港','澳门','珠海','佛山','东莞','无锡','南通','温州','烟台','威海'
            ];
            cityList.innerHTML = commonCities.map(function (c) { return '<option value="' + c + '">'; }).join('');
        }

        // 地图 + 列表
        renderFpMap(FP);
        renderFpList(FP);

        // 事件
        bindFpEvents(FP);
    }

    // 渲染中国地图（点亮已访问省份 + 放置打卡图钉）
    function renderFpMap(FP) {
        var wrap = $('#fp-map');
        if (!wrap) return;
        if (!LP.chinaMap || !LP.chinaMap.provinces) {
            wrap.innerHTML = '<p class="sched-empty">地图数据加载中…</p>';
            return;
        }
        var map = LP.chinaMap;
        var visited = fpVisited(FP);

        var paths = map.provinces.map(function (p) {
            var isVis = p.name && !!visited[p.name];
            var cls = 'china-prov' + (isVis ? ' is-visited' : '') + (fpProvFilter === p.name ? ' is-active' : '');
            var dataAttr = p.name ? ' data-name="' + esc(p.name) + '"' : '';
            return '<path d="' + p.path + '" class="' + cls + '"' + dataAttr + '></path>';
        }).join('');

        var pins = map.provinces.map(function (p) {
            if (!p.name || !visited[p.name] || p.cx == null || p.cy == null) return '';
            var active = fpProvFilter === p.name ? ' is-active' : '';
            var num = visited[p.name] > 1 ? '<text class="pin-num" y="2.4">' + visited[p.name] + '</text>' : '';
            return '<g class="china-pin' + active + '" data-name="' + esc(p.name) + '" transform="translate(' + p.cx + ',' + p.cy + ')">' +
                '<circle class="pin-dot" r="6"></circle>' + num +
            '</g>';
        }).join('');

        wrap.innerHTML =
            '<svg class="china-svg" viewBox="0 0 ' + map.w + ' ' + map.h + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="中国地图足迹">' +
                paths + pins +
            '</svg>';

        $$('.china-prov[data-name], .china-pin', wrap).forEach(function (el) {
            el.addEventListener('click', function () {
                var name = this.getAttribute('data-name');
                if (!name) return;
                if (!visited[name]) { toast(name + ' 还没去过～'); return; }
                fpProvFilter = (fpProvFilter === name) ? null : name;
                renderFpMap(FP);
                renderFpList(FP);
            });
        });
    }

    function renderFpList(FP) {
        var list = $('#fp-list');
        if (!list) return;

        var items = FP.getAll();
        var searchVal = (($('#fp-search') || {}).value || '').trim();
        if (searchVal) items = FP.search(searchVal);
        if (fpProvFilter) items = items.filter(function (p) { return p.province === fpProvFilter; });

        // 筛选条
        var filterBar = $('#fp-filter-bar');
        if (filterBar) {
            filterBar.innerHTML = fpProvFilter
                ? '<span class="fp-chip">📍 ' + esc(fpProvFilter) + ' <button class="fp-chip-x" id="fp-clear-filter" type="button" aria-label="清除筛选">✕</button></span>'
                : '';
        }

        if (items.length === 0) {
            list.innerHTML = '<p class="sched-empty">' +
                (fpProvFilter ? '「' + esc(fpProvFilter) + '」还没有足迹记录' : '还没有足迹记录，去个好玩的地方打卡吧 📍') +
                '</p>';
        } else {
            list.innerHTML = items.map(function (p, idx) {
                var whoTag = p.who === 'a' ? '<span class="sched-who who-a">🐸</span>'
                    : p.who === 'b' ? '<span class="sched-who who-b">🐕</span>' : '';
                var provTag = p.province ? '<span class="fp-prov-tag">' + esc(p.province) + '</span>' : '';
                var cityTag = p.city ? '<span class="fp-city-tag">🏙️ ' + esc(p.city) + '</span>' : '';
                var noteHtml = p.note ? '<p class="fp-note">' + esc(p.note) + '</p>' : '';
                var provAttr = p.province ? ' data-prov="' + esc(p.province) + '"' : '';
                return '<div class="fp-card' + (p.province ? ' fp-card-link' : '') + '" data-id="' + p.id + '"' + provAttr + ' style="--fp-delay:' + (idx * 30) + 'ms">' +
                    '<div class="fp-rank">#' + (idx + 1) + '</div>' +
                    '<div class="fp-body">' +
                        '<h4 class="fp-name">📍 ' + esc(p.name) + '</h4>' +
                        '<div class="fp-meta">' +
                            '<span class="fp-date">📅 ' + (p.date || '') + '</span>' +
                            cityTag + provTag + whoTag +
                            '<button class="link-btn sched-del fp-del" data-id="' + p.id + '">✕</button>' +
                        '</div>' +
                        noteHtml +
                    '</div>' +
                '</div>';
            }).join('');
        }

        // 删除
        $$('.fp-del', list).forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                FP.delPlace(this.dataset.id);
                toast('已删除');
                renderFootprint();
            });
        });
        // 点击卡片 → 在地图上高亮 / 取消该省份
        $$('.fp-card-link', list).forEach(function (card) {
            card.addEventListener('click', function (e) {
                if (e.target.closest('.fp-del')) return;
                var prov = this.getAttribute('data-prov');
                fpProvFilter = (fpProvFilter === prov) ? null : prov;
                renderFpMap(FP);
                renderFpList(FP);
            });
        });
        // 清除筛选
        var clearBtn = $('#fp-clear-filter');
        if (clearBtn) clearBtn.addEventListener('click', function () {
            fpProvFilter = null; renderFpMap(FP); renderFpList(FP);
        });
    }

    function bindFpEvents(FP) {
        // 打卡按钮
        var checkinBtn = $('#fp-checkin-btn');
        if (checkinBtn && !checkinBtn._bound) {
            checkinBtn._bound = true;
            checkinBtn.addEventListener('click', function () {
                var nameInput = $('#fp-name-input');
                var dateInput = $('#fp-date-input');
                var cityInput = $('#fp-city-input');
                var provSel = $('#fp-province-input');
                var whoSel = $('#fp-who-input');
                var noteInput = $('#fp-note-input');
                var name = (nameInput.value || '').trim();
                if (!name) { toast('写个地名吧'); nameInput.focus(); return; }
                FP.addPlace({
                    name: name,
                    city: (cityInput.value || '').trim(),
                    date: dateInput.value || '',
                    province: provSel ? provSel.value : '',
                    who: whoSel ? whoSel.value : '',
                    note: noteInput ? noteInput.value.trim() : ''
                });
                nameInput.value = '';
                if (cityInput) cityInput.value = '';
                if (noteInput) noteInput.value = '';
                // 保留省份选择，方便连续在同一地打卡
                toast('打卡成功 ✓');
                renderFootprint();
            });
            // 回车打卡
            $('#fp-name-input').addEventListener('keydown', function (e) {
                if (e.key === 'Enter') { e.preventDefault(); checkinBtn.click(); }
            });
        }

        // 搜索
        var searchInput = $('#fp-search');
        if (searchInput && !searchInput._bound) {
            searchInput._bound = true;
            var fpTimer = null;
            searchInput.addEventListener('input', function () {
                clearTimeout(fpTimer);
                fpTimer = setTimeout(function () { renderFpList(FP); }, 250);
            });
        }
    }

    LP.Views = LP.Views || {};
    LP.Views.Footprint = { render: renderFootprint };

})(window.LP);
