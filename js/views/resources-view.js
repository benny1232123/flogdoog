/* =========================================================
   views/resources-view.js — 模块 11 资料库视图
   由 app.js 拆分：视图渲染 + 交互，经 LP.Views 注册，renderAll 统一调度
   ========================================================= */

(function (LP) {
    'use strict';

    const { $, $$, store, esc, pad, parseDate, dayDiff, fmtDate, fmtRelTime, state, toast, observeReveal, lazyImages, LS } = LP;
    const ICONS = LP.UI.ICONS;
    const icon = LP.UI.icon;
    const MOODS = LP.UI.MOODS;

    /* =========================================================
       模块 11 — 学术/资料库（新增）
       ========================================================= */
    let currentResCat = ''; // '' = all
    let currentResTag = '';
    let resViewMode = 'grid'; // 'grid' (网盘) or 'list' (列表)

    function renderResources() {
        if (!LP.Resources) return;
        var R = LP.Resources;

        // 分类标签
        var catsEl = $('#res-cats');
        if (catsEl) {
            catsEl.innerHTML = '<button class="res-cat is-active" data-rcat="" type="button">全部</button>' +
                R.CATEGORIES.map(function (c) {
                    return '<button class="res-cat" data-rcat="' + c.id + '" type="button">' + c.icon + ' ' + c.label + '</button>';
                }).join('');

            $$('.res-cat', catsEl).forEach(function (btn) {
                btn.addEventListener('click', function () {
                    $$('.res-cat', catsEl).forEach(function (b) { b.classList.remove('is-active'); });
                    this.classList.add('is-active');
                    currentResCat = this.dataset.rcat;
                    currentResTag = '';           // 切换分类时清除标签筛选
                    renderResTags(R);
                    renderResList();
                });
            });
        }

        // 标签筛选条
        renderResTags(R);

        // 资料列表
        renderResList();

        // 搜索 & 新增事件 + 视图切换
        renderResToolbar();
        bindResEvents();
    }

    function renderResTags(R) {
        var el = $('#res-tags');
        if (!el) return;
        var tags = R.getAllTags();
        if (!tags.length) { el.innerHTML = ''; el.style.display = 'none'; return; }
        el.style.display = '';
        var html = '<button class="res-tag' + (!currentResTag ? ' is-active' : '') + '" data-tag="">全部标签</button>';
        html += tags.map(function (t) {
            return '<button class="res-tag' + (currentResTag === t ? ' is-active' : '') + '" data-tag="' + esc(t) + '">#' + esc(t) + '</button>';
        }).join('');
        el.innerHTML = html;
        $$('.res-tag', el).forEach(function (btn) {
            btn.addEventListener('click', function () {
                currentResTag = this.dataset.tag || '';
                renderResTags(R);
                renderResList();
            });
        });
    }

    function renderResList() {
        var list = $('#res-list');
        if (!list) return;
        var R = LP.Resources;

        // 取数据：标签优先，其次分类，否则全部（均置顶优先）
        var items;
        if (currentResTag) items = R.getByTag(currentResTag);
        else if (currentResCat) items = R.getByCategory(currentResCat);
        else items = R.load().resources.slice().sort(function (a, b) {
            if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
            return new Date(b.date) - new Date(a.date);
        });

        // 搜索过滤（保持置顶优先）
        var searchVal = ($('#res-search') || {}).value || '';
        if (searchVal.trim()) items = R.search(searchVal.trim()).slice().sort(function (a, b) {
            if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
            return new Date(b.date) - new Date(a.date);
        });

        // 设置容器样式类
        list.className = resViewMode === 'grid' ? 'res-grid' : 'res-list';

        if (items.length === 0) {
            list.innerHTML = '<p class="sched-empty">' + (currentResCat || currentResTag ? '没有匹配的资料' : '资料库还是空的，点击「+ 新增」添加第一条') + '</p>';
            return;
        }

        var catMap = {};
        R.CATEGORIES.forEach(function (c) { catMap[c.id] = c; });

        if (resViewMode === 'grid') {
            // ===== 网盘风格：大图标网格 =====
            list.innerHTML = items.map(function (r) {
                var cat = catMap[r.category] || { icon: '📎', label: '其他', color: '#999' };
                var isLink = !!r.url;
                var fileIcon = isLink ? '🔗' : (r.abstract ? '📄' : (r.note ? '📝' : '📎'));
                var pinMark = r.pinned ? '<span class="drive-pin">📌</span>' : '';
                var titleHtml = isLink
                    ? '<a href="' + esc(r.url) + '" target="_blank" rel="noopener" class="drive-title" title="' + esc(r.title) + '">' + esc(r.title.length > 20 ? r.title.slice(0, 20) + '…' : r.title) + '</a>'
                    : '<span class="drive-title" title="' + esc(r.title) + '">' + esc(r.title.length > 20 ? r.title.slice(0, 20) + '…' : r.title) + '</span>';
                var tagsHtml = (r.tags && r.tags.length)
                    ? '<div class="drive-tags">' + r.tags.slice(0, 3).map(function (t) { return '<span class="drive-tag">' + esc(t) + '</span>'; }).join('') + '</div>'
                    : '';

                return '<div class="drive-card' + (r.pinned ? ' is-pinned' : '') + '" data-id="' + r.id + '">' +
                    '<div class="drive-icon-wrap">' +
                        '<span class="drive-icon">' + cat.icon + '</span>' +
                        pinMark +
                    '</div>' +
                    '<div class="drive-body">' +
                        titleHtml +
                        '<div class="drive-meta">' +
                            '<span class="drive-cat">' + cat.label + '</span>' +
                            '<span class="drive-date">' + (r.date ? r.date.slice(5, 10) : '') + '</span>' +
                        '</div>' +
                        tagsHtml +
                    '</div>' +
                    '<div class="drive-actions">' +
                        '<button class="drive-act-btn res-pin" data-id="' + r.id + '" title="置顶">' + (r.pinned ? '📌' : '📍') + '</button>' +
                        '<button class="drive-act-btn res-del" data-id="' + r.id + '" title="删除">✕</button>' +
                    '</div>' +
                '</div>';
            }).join('');
        } else {
            // ===== 列表视图（原有卡片风格）=====
            list.innerHTML = items.map(function (r) {
                var cat = catMap[r.category] || { icon: '📎', label: '其他' };
                var tagsHtml = (r.tags && r.tags.length)
                    ? '<div class="res-tags">' + r.tags.map(function (t) {
                        return '<button class="res-tag-chip" data-tag="' + esc(t) + '">#' + esc(t) + '</button>';
                    }).join('') + '</div>'
                    : '';
                var abstractHtml = r.abstract ? '<p class="res-abstract">' + esc(r.abstract) + '</p>' : '';
                var noteHtml = r.note ? '<p class="res-note">📝 ' + esc(r.note) + '</p>' : '';
                var urlHtml = r.url ? '<a href="' + esc(r.url) + '" target="_blank" rel="noopener" class="res-link">打开链接 ↗</a>' : '';
                var pinBadge = r.pinned ? '<span class="res-pin-badge" title="已置顶">📌 置顶</span>' : '';

                return '<div class="res-card' + (r.pinned ? ' is-pinned' : '') + '" data-id="' + r.id + '">' +
                    '<div class="res-head">' +
                        '<span class="res-cat-badge">' + cat.icon + ' ' + cat.label + '</span>' +
                        pinBadge +
                        '<span class="res-date">' + (r.date ? r.date.slice(0,10) : '') + '</span>' +
                        '<button class="link-btn res-pin" data-id="' + r.id + '" title="置顶 / 取消置顶">' + (r.pinned ? '📌' : '📍') + '</button>' +
                        '<button class="link-btn sched-del res-del" data-id="' + r.id + '">✕</button>' +
                    '</div>' +
                    '<h4 class="res-title">' + (r.url ? '<a href="' + esc(r.url) + '" target="_blank" rel="noopener">' + esc(r.title) + '</a>' : esc(r.title)) + '</h4>' +
                    abstractHtml + noteHtml + tagsHtml + urlHtml +
                '</div>';
            }).join('');
        }

        // 标签点击筛选
        $$('.res-tag-chip', list).forEach(function (chip) {
            chip.addEventListener('click', function () {
                currentResTag = this.dataset.tag;
                renderResTags(R);
                renderResList();
                var sec = document.getElementById('resources');
                if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        });

        // 置顶切换
        $$('.res-pin', list).forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                LP.Resources.pinResource(this.dataset.id);
                toast('已更新置顶状态');
                renderResources();
            });
        });

        $$('.res-del', list).forEach(function (btn) {
            btn.addEventListener('click', function () {
                LP.Resources.delResource(this.dataset.id);
                toast('已删除');
                renderResources();
            });
        });
    }

    // 网盘风格工具栏：搜索 + 视图切换 + 新增
    function renderResToolbar() {
        var toolbar = $('#res-toolbar');
        if (!toolbar) return;
        // 只渲染一次框架
        if (toolbar._rendered) {
            // 更新视图按钮状态
            var gridBtn = $('#res-view-grid');
            var listBtn = $('#res-view-list');
            if (gridBtn) gridBtn.classList.toggle('is-active', resViewMode === 'grid');
            if (listBtn) listBtn.classList.toggle('is-active', resViewMode === 'list');
            return;
        }
        toolbar._rendered = true;
        toolbar.innerHTML =
            '<div class="res-toolbar-left">' +
                '<input type="text" id="res-search" class="sched-input" placeholder="🔍 搜索资料…">' +
            '</div>' +
            '<div class="res-toolbar-right">' +
                '<button class="res-view-btn is-active" id="res-view-grid" title="网盘视图" type="button">▦</button>' +
                '<button class="res-view-btn" id="res-view-list" title="列表视图" type="button">☰</button>' +
                '<button class="btn-primary btn-sm" id="res-add-btn" type="button">+ 新增</button>' +
            '</div>';

        // 视图切换
        $('#res-view-grid').addEventListener('click', function () {
            resViewMode = 'grid';
            this.classList.add('is-active');
            $('#res-view-list').classList.remove('is-active');
            $('#res-list').className = 'res-grid';
            renderResList();
        });
        $('#res-view-list').addEventListener('click', function () {
            resViewMode = 'list';
            this.classList.add('is-active');
            $('#res-view-grid').classList.remove('is-active');
            $('#res-list').className = 'res-list';
            renderResList();
        });
    }

    function bindResEvents() {
        // 搜索
        var searchInput = $('#res-search');
        if (searchInput && !searchInput._bound) {
            searchInput._bound = true;
            var searchTimer = null;
            searchInput.addEventListener('input', function () {
                clearTimeout(searchTimer);
                searchTimer = setTimeout(renderResList, 250);
            });
        }

        // 新增按钮
        var addBtn = $('#res-add-btn');
        if (addBtn && !addBtn._bound) {
            addBtn._bound = true;
            addBtn.addEventListener('click', showAddResource);
        }
    }

    function showAddResource() {
        var R = LP.Resources;
        var html = '<div class="sheet editor-sheet is-open" id="res-add-sheet">';
        html += '<div class="sheet-panel editor-panel"><div class="sheet-head">';
        html += '<h3>新增资料</h3>';
        html += '<button class="icon-btn ra-close-btn" aria-label="关闭"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button>';
        html += '</div><div class="editor-body"><div class="ed-group">';

        html += '<label class="ed-row"><span class="ed-label">标题 *</span>';
        html += '<input type="text" class="ed-input" id="res-title" placeholder="论文名/书名/笔记标题…" maxlength="100"></label>';

        html += '<label class="ed-row"><span class="ed-label">链接（可选）</span>';
        html += '<input type="url" class="ed-input" id="res-url" placeholder="https://…"></label>';

        html += '<div class="ed-row"><span class="ed-label">分类</span>';
        html += '<select class="ed-input" id="res-category">';
        R.CATEGORIES.forEach(function (c) { html += '<option value="' + c.id + '">' + c.icon + ' ' + c.label + '</option>'; });
        html += '</select></div>';

        html += '<label class="ed-row"><span class="ed-label">摘要</span>';
        html += '<textarea class="ed-input" id="res-abstract" rows="3" placeholder="简要描述…"></textarea></label>';

        html += '<label class="ed-row"><span class="ed-label">备注 / 个人想法</span>';
        html += '<textarea class="ed-input" id="res-note" rows="2" placeholder="比如：第三章值得重读、适合周末看…"></textarea></label>';

        html += '<div class="ed-row"><span class="ed-label">标签（逗号分隔）</span>';
        html += '<input type="text" class="ed-input" id="res-tags" placeholder="机器学习, 论文, 2024"></div>';

        html += '<label class="ed-check"><input type="checkbox" id="res-pinned"> 置顶这条资料</label>';

        html += '</div></div><div class="editor-foot" style="text-align:center;">';
        html += '<button class="btn-primary" id="res-save-btn">保存</button>';
        html += '</div></div></div>';

        var old = document.getElementById('res-add-sheet');
        if (old) old.remove();

        var wrap = document.createElement('div');
        wrap.innerHTML = html;
        var sheet = wrap.firstElementChild;
        document.body.appendChild(sheet);

        $('#res-save-btn').addEventListener('click', function () {
            var title = ($('#res-title').value || '').trim();
            if (!title) { toast('请填写标题'); $('#res-title').focus(); return; }
            var tagStr = ($('#res-tags').value || '').trim();
            var tags = tagStr ? tagStr.split(/[,，]/).map(function (t) { return t.trim(); }).filter(Boolean) : [];

            R.addResource({
                title: title,
                url: ($('#res-url').value || '').trim() || undefined,
                category: $('#res-category').value,
                abstract: ($('#res-abstract').value || '').trim(),
                note: ($('#res-note').value || '').trim(),
                pinned: ($('#res-pinned') || {}).checked === true,
                tags: tags
            });

            toast('已保存 ✓');
            sheet.remove();
            renderResources();
        });

        $('.ra-close-btn').addEventListener('click', function () { sheet.remove(); });
    }

    LP.Views = LP.Views || {};
    LP.Views.Resources = { render: renderResources };

})(window.LP);
