/* =========================================================
   views/rating-view.js — 模块 10 评分榜+点评视图
   由 app.js 拆分：视图渲染 + 交互，经 LP.Views 注册，renderAll 统一调度
   ========================================================= */

(function (LP) {
    'use strict';

    const { $, $$, store, esc, pad, parseDate, dayDiff, fmtDate, fmtRelTime, state, toast, observeReveal, lazyImages, LS } = LP;
    const ICONS = LP.UI.ICONS;
    const icon = LP.UI.icon;
    const MOODS = LP.UI.MOODS;

    /* =========================================================
       模块 10 — 评分榜 + 点评（新增）
       ========================================================= */
    function renderRating() {
        if (!LP.Rating) return;
        var R = LP.Rating;
        var data = R.load();
        var cpl = state.config.couple;
        var nameA = (cpl && cpl.a && cpl.a.name) || '阿蛙';
        var nameB = (cpl && cpl.b && cpl.b.name) || '阿狗';

        // ---- 打分榜 ----
        var board = $('#scoreboard');
        if (board) {
            var sumA = R.getScoreSummary('a'); // b打给a的
            var sumB = R.getScoreSummary('b');
            var recent = R.getRecentScores(5);

            board.innerHTML = '<div class="sb-title">🏆 大笨狗 vs 小笨蛙</div>' +
                '<div class="sb-pair">' +
                    '<div class="sb-card sb-card-a">' +
                        '<span class="sb-name">' + esc(nameA) + '（小笨蛙）</span>' +
                        '<span class="sb-score">' + (sumA.avg || '-') + '</span>' +
                        '<span class="sb-count">' + sumA.count + ' 次被打分</span>' +
                        '<button class="btn-ghost sb-rate-btn" data-target="b_to_a" data-to="a">给 Ta 打分</button>' +
                    '</div>' +
                    '<div class="sb-vs" aria-hidden="true">VS</div>' +
                    '<div class="sb-card sb-card-b">' +
                        '<span class="sb-name">' + esc(nameB) + '（大笨狗）</span>' +
                        '<span class="sb-score">' + (sumB.avg || '-') + '</span>' +
                        '<span class="sb-count">' + sumB.count + ' 次被打分</span>' +
                        '<button class="btn-ghost sb-rate-btn" data-target="a_to_b" data-to="b">给 Ta 打分</button>' +
                    '</div>' +
                '</div>';

            // 最近打分记录
            if (recent.length > 0) {
                board.innerHTML += '<div class="sb-recent"><h4>最近打分</h4>' +
                    recent.map(function (s) {
                        var from = s.id.indexOf('a') === 0 ? nameA : nameB; // 简化判断
                        var toName = (data.scores.a_to_b || []).indexOf(s) >= 0 ? nameB : nameA;
                        return '<div class="sb-rec"><span>' + esc(from) + ' → ' + esc(toName) + '</span>' +
                            '<span class="sb-stars">' + '★'.repeat(s.score) + '☆'.repeat(5-s.score) + '</span>' +
                            (s.comment ? '<span class="sb-comment">' + esc(s.comment) + '</span>' : '') +
                        '</div>';
                    }).join('') + '</div>';
            }
        }

        // ---- 标签筛选条 ----
        renderRevTags(R);

        // ---- 点评列表 ----
        renderRevList('all');

        // 绑定事件
        bindRatingEvents();
    }

    let currentRevTab = 'all';
    let currentRevTag = '';

    function renderRevTags(R) {
        var el = $('#rev-tags');
        if (!el) return;
        var tags = R.getAllTags();
        var html = '<button class="rev-tag' + (!currentRevTag ? ' is-active' : '') + '" data-tag="">全部标签</button>';
        html += tags.map(function (t) {
            return '<button class="rev-tag' + (currentRevTag === t ? ' is-active' : '') + '" data-tag="' + esc(t) + '">#' + esc(t) + '</button>';
        }).join('');
        el.innerHTML = html;
        $$('.rev-tag', el).forEach(function (btn) {
            btn.addEventListener('click', function () {
                currentRevTag = this.dataset.tag || '';
                renderRevTags(R);
                renderRevList(currentRevTab || 'all');
            });
        });
    }

    function renderRevList(category) {
        var list = $('#rev-list');
        if (!list) return;
        var reviews = LP.Rating.getReviews(category === 'all' ? null : category);
        if (currentRevTag) {
            reviews = reviews.filter(function (r) { return (r.tags || []).indexOf(currentRevTag) >= 0; });
        }
        if (reviews.length === 0) {
            list.innerHTML = '<p class="sched-empty">还没有点评，去吃点好吃的再来评价吧 🍜</p>';
            return;
        }

        var catMap = {};
        LP.Rating.CATEGORIES.forEach(function (c) { catMap[c.id] = c; });

        list.innerHTML = reviews.map(function (r) {
            var cat = catMap[r.category] || { icon: '📍', label: '其他' };
            var stars = '★'.repeat(r.rating) + '☆'.concat(5 - r.rating);
            var whoTag = r.who === 'a' ? '<span class="sched-who who-a">🐸</span>'
                : r.who === 'b' ? '<span class="sched-who who-b">🐕</span>' : '';

            // 照片
            var photosHtml = '';
            if (r.photos && r.photos.length) {
                photosHtml = '<div class="rev-photos">' + r.photos.map(function (mid) {
                    return '<img class="rev-photo" data-mid="' + esc(mid) + '" alt="点评照片" loading="lazy">';
                }).join('') + '</div>';
            }

            // 维度评分
            var dimsHtml = '';
            if (r.dims) {
                var avg = LP.Rating.getDimsAvg(r);
                dimsHtml = '<div class="rev-dims">' + LP.Rating.DIMENSIONS.map(function (d) {
                    var v = r.dims[d.id] || 0;
                    if (!v) return '';
                    return '<div class="rev-dim"><span class="rev-dim-label">' + d.label + '</span>' +
                        '<span class="rev-dim-bar"><i style="width:' + (v * 20) + '%"></i></span>' +
                        '<span class="rev-dim-val">' + v + '</span></div>';
                }).join('') +
                (avg ? '<div class="rev-dim-avg">平均 ' + avg.toFixed(1) + '</div>' : '') +
                '</div>';
            }

            // 标签
            var tagsHtml = (r.tags && r.tags.length)
                ? '<div class="rev-tags-inline">' + r.tags.map(function (t) {
                    return '<button class="rev-tag-chip" data-tag="' + esc(t) + '">#' + esc(t) + '</button>';
                }).join('') + '</div>'
                : '';

            return '<div class="rev-card" data-id="' + r.id + '">' +
                '<div class="rev-head">' +
                    '<span class="rev-cat">' + cat.icon + ' ' + cat.label + '</span>' +
                    '<span class="rev-stars">' + stars + '</span>' +
                '</div>' +
                '<h4 class="rev-name">' + esc(r.name) + '</h4>' +
                (r.comment ? '<p class="rev-comment">' + esc(r.comment) + '</p>' : '') +
                dimsHtml + photosHtml + tagsHtml +
                '<div class="rev-meta">' + whoTag +
                    '<small>' + (r.date ? r.date.slice(0,10) : '') + '</small>' +
                    '<button class="link-btn sched-del rev-del" data-id="' + r.id + '">✕</button>' +
                '</div>' +
            '</div>';
        }).join('');

        // 异步填充照片
        if (window.LPMedia) {
            $$('.rev-photo', list).forEach(function (img) {
                var mid = img.dataset.mid;
                LPMedia.urlOf(mid).then(function (url) {
                    if (url) img.src = url; else img.style.display = 'none';
                }).catch(function () { img.style.display = 'none'; });
            });
        }

        // 标签点击筛选
        $$('.rev-tag-chip', list).forEach(function (chip) {
            chip.addEventListener('click', function () {
                currentRevTag = this.dataset.tag;
                renderRevTags(LP.Rating);
                renderRevList(currentRevTab || 'all');
                var sec = document.getElementById('rating');
                if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        });

        $$('.rev-del', list).forEach(function (btn) {
            btn.addEventListener('click', function () {
                LP.Rating.delReview(this.dataset.id);
                toast('已删除');
                renderRating();
            });
        });
    }

    function buildStarPicker(containerId, initialVal) {
        var el = document.getElementById(containerId);
        if (!el) return;
        var html = '';
        for (var i = 1; i <= 5; i++) {
            html += '<button type="button" class="star-btn' + (i <= initialVal ? ' is-active' : '') + '" data-val="' + i + '" title="' + i + '星">★</button>';
        }
        el.innerHTML = html;
        $$('.star-btn', el).forEach(function (btn) {
            btn.addEventListener('click', function () {
                var v = parseInt(this.dataset.val);
                $$('.star-btn', el).forEach(function (b, idx) {
                    b.classList.toggle('is-active', idx < v);
                });
                el.dataset.value = v;
            });
        });
        el.dataset.value = initialVal || 0;
    }

    function bindRatingEvents() {
        // 打分按钮
        $$('.sb-rate-btn').forEach(function (btn) {
            if (btn._bound) return;
            btn._bound = true;
            btn.addEventListener('click', function () {
                showScorePicker(this.dataset.target, this.dataset.to);
            });
        });

        // 点评标签切换
        $$('.rev-tab').forEach(function (tab) {
            if (tab._bound) return;
            tab._bound = true;
            tab.addEventListener('click', function () {
                $$('.rev-tab').forEach(function (t) { t.classList.remove('is-active'); });
                this.classList.add('is-active');
                currentRevTab = this.dataset.revtab;
                renderRevList(currentRevTab);
            });
        });

        // 写点评（打开 Sheet）
        var addBtn = $('#rev-add-btn');
        if (addBtn && !addBtn._bound) {
            addBtn._bound = true;
            addBtn.addEventListener('click', function () { showAddReview(); });
        }
    }

    function showAddReview() {
        var R = LP.Rating;
        var html = '<div class="sheet editor-sheet is-open" id="rev-add-sheet">';
        html += '<div class="sheet-panel editor-panel"><div class="sheet-head">';
        html += '<h3>✍️ 写点评</h3>';
        html += '<button class="icon-btn ra-close-btn" aria-label="关闭"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button>';
        html += '</div><div class="editor-body"><div class="ed-group">';

        html += '<label class="ed-row"><span class="ed-label">店名 / 场所 *</span>';
        html += '<input type="text" class="ed-input" id="rev-name" placeholder="比如：巷子里的那家面馆" maxlength="40"></label>';

        html += '<div class="ed-row"><span class="ed-label">分类</span><select class="ed-input" id="rev-category">';
        R.CATEGORIES.forEach(function (c) { html += '<option value="' + c.id + '">' + c.icon + ' ' + c.label + '</option>'; });
        html += '</select></div>';

        html += '<div class="ed-row"><span class="ed-label">总体评分</span><div class="rev-stars" id="rev-overall-stars"></div></div>';

        // 维度评分
        html += '<div class="ed-subhead">维度评分（可选）</div>';
        R.DIMENSIONS.forEach(function (d) {
            html += '<div class="ed-row rev-dim-row"><span class="ed-label">' + d.label + '</span>' +
                '<div class="rev-stars" id="rev-dim-' + d.id + '"></div></div>';
        });

        // 照片
        html += '<div class="ed-row"><span class="ed-label">照片（可选）</span>' +
            '<div class="rev-upload">' +
            '<input type="file" id="rev-photo-input" accept="image/*" multiple hidden>' +
            '<button type="button" class="btn-ghost rev-photo-btn" id="rev-photo-btn">📷 添加照片</button>' +
            '<div class="rev-photo-preview" id="rev-photo-preview"></div>' +
            '</div></div>';

        html += '<label class="ed-row"><span class="ed-label">标签（逗号分隔）</span>';
        html += '<input type="text" class="ed-input" id="rev-tags-input" placeholder="约会圣地, 性价比高"></label>';

        html += '<label class="ed-row"><span class="ed-label">是谁去吃的</span><select class="ed-input" id="rev-who">';
        html += '<option value="both">一起 💞</option><option value="a">🐸 阿蛙</option><option value="b">🐕 阿狗</option></select></div>';

        html += '<label class="ed-row"><span class="ed-label">点评</span>';
        html += '<textarea class="ed-input" id="rev-comment" rows="3" placeholder="环境怎么样？必点菜是什么？"></textarea></label>';

        html += '</div></div><div class="editor-foot" style="text-align:center;">';
        html += '<button class="btn-primary" id="rev-save-btn">保存点评</button>';
        html += '</div></div></div>';

        var old = document.getElementById('rev-add-sheet');
        if (old) old.remove();

        var wrap = document.createElement('div');
        wrap.innerHTML = html;
        var sheet = wrap.firstElementChild;
        document.body.appendChild(sheet);

        // 星星选择器
        buildStarPicker('rev-overall-stars', 5);
        R.DIMENSIONS.forEach(function (d) { buildStarPicker('rev-dim-' + d.id, 0); });

        // 照片选择（暂存，提交时写入 IndexedDB）
        var pending = []; // { file, url }
        var photoInput = $('#rev-photo-input');
        var photoBtn = $('#rev-photo-btn');
        var preview = $('#rev-photo-preview');
        function renderPreview() {
            preview.innerHTML = pending.map(function (p, i) {
                return '<div class="rev-thumb"><img src="' + p.url + '" alt=""><button type="button" class="rev-thumb-x" data-i="' + i + '">✕</button></div>';
            }).join('');
            $$('.rev-thumb-x', preview).forEach(function (x) {
                x.addEventListener('click', function () {
                    var i = parseInt(this.dataset.i);
                    if (pending[i] && pending[i].url) URL.revokeObjectURL(pending[i].url);
                    pending.splice(i, 1);
                    renderPreview();
                });
            });
        }
        photoBtn.addEventListener('click', function () { photoInput.click(); });
        photoInput.addEventListener('change', function () {
            Array.prototype.forEach.call(this.files, function (f) {
                if (!f.type.startsWith('image/')) return;
                pending.push({ file: f, url: URL.createObjectURL(f) });
            });
            this.value = '';
            renderPreview();
        });

        // 保存
        $('#rev-save-btn').addEventListener('click', async function () {
            var name = ($('#rev-name').value || '').trim();
            if (!name) { toast('写个店名吧'); $('#rev-name').focus(); return; }
            var rating = parseInt($('#rev-overall-stars').dataset.value) || 5;

            var dims = {};
            R.DIMENSIONS.forEach(function (d) {
                var v = parseInt($('#rev-dim-' + d.id).dataset.value) || 0;
                if (v > 0) dims[d.id] = v;
            });

            var tagStr = ($('#rev-tags-input').value || '').trim();
            var tags = tagStr ? tagStr.split(/[,，]/).map(function (t) { return t.trim(); }).filter(Boolean) : [];

            // 写入照片到 IndexedDB（本地存储，不跨设备同步）
            var photoIds = [];
            if (pending.length && window.LPMedia) {
                for (var i = 0; i < pending.length; i++) {
                    var mid = 'rev_' + Date.now().toString(36) + '_' + i + '_' + Math.random().toString(36).slice(2, 6);
                    try { await LPMedia.putImage(mid, pending[i].file); photoIds.push(mid); }
                    catch (e) { console.warn('[Rating] 照片存储失败', e); }
                }
            }

            R.addReview({
                name: name,
                category: $('#rev-category').value,
                rating: rating,
                dims: dims,
                tags: tags,
                photos: photoIds,
                comment: ($('#rev-comment').value || '').trim(),
                who: $('#rev-who').value
            });

            toast('点评已保存 ✓');
            sheet.remove();
            renderRating();
        });

        $('.ra-close-btn', sheet).addEventListener('click', function () {
            pending.forEach(function (p) { if (p.url) URL.revokeObjectURL(p.url); });
            sheet.remove();
        });
    }

    function showScorePicker(scoreKey, toWho) {
        var cpl = state.config.couple;
        var toName = toWho === 'a' ? ((cpl && cpl.a && cpl.a.name) || '阿蛙') : ((cpl && cpl.b && cpl.b.name) || '阿狗');

        var html = '<div class="sheet editor-sheet is-open" id="score-picker-sheet">';
        html += '<div class="sheet-panel editor-panel"><div class="sheet-head">';
        html += '<h3>给 ' + esc(toName) + ' 打分</h3>';
        html += '<button class="icon-btn sp-close-btn" aria-label="关闭"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button>';
        html += '</div><div class="editor-body"><div class="ed-group" style="text-align:center;">';

        html += '<div class="big-star-picker" id="big-star-picker"></div>';

        html += '<label class="ed-row" style="margin-top:14px;"><span class="ed-label">想说的话</span>';
        html += '<textarea class="ed-input" id="score-comment" rows="2" placeholder="夸夸 Ta 或者吐槽一下…"></textarea></label>';

        html += '</div></div><div class="editor-foot" style="text-align:center;">';
        html += '<button class="btn-primary" id="score-submit-btn">提交打分</button>';
        html += '</div></div></div>';

        var old = document.getElementById('score-picker-sheet');
        if (old) old.remove();

        var wrap = document.createElement('div');
        wrap.innerHTML = html;
        var sheet = wrap.firstElementChild;
        document.body.appendChild(sheet);

        buildStarPicker('big-star-picker', 5);

        var fromWho = scoreKey.split('_')[0]; // a or b

        $('#score-submit-btn').addEventListener('click', function () {
            var starEl = $('#big-star-picker');
            var score = parseInt(starEl.dataset.value) || 5;
            var comment = $('#score-comment').value.trim();

            LP.Rating.addScore(fromWho, toWho, score, comment);
            toast('打分成功 ✓');
            sheet.remove();
            renderRating();
        });

        $('.sp-close-btn').addEventListener('click', function () { sheet.remove(); });
    }

    LP.Views = LP.Views || {};
    LP.Views.Rating = { render: renderRating };

})(window.LP);
