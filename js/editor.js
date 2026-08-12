/* =========================================================
   editor.js — 内容编辑后台（解锁后可用）
   设计：纯静态站点无后端，编辑结果存本机：
     · 文本/结构覆盖 → localStorage（lp.userData），以 idb://<id> 引用媒体
     · 图片/视频 Blob → IndexedDB（LPMedia），用固定 id 便于反复替换
   支持「导出备份 / 导入」把数据在两台设备间搬运。
   ========================================================= */
(function (LP) {
    'use strict';

    const { $, $$, store, esc, toast, state } = LP;
    const KEY = 'lp.userData';

    let working = null;       // 可序列化编辑副本（含 idb:// 引用）
    let activeTab = 'site';
    let inited = false;

    /* ---------------- 工具 ---------------- */
    const clone = (o) => JSON.parse(JSON.stringify(o == null ? '' : o));
    const isRef = (v) => typeof v === 'string' && v.indexOf('idb://') === 0;
    const refId = (v) => v.slice(6);
    const todayStr = () => new Date().toISOString().slice(0, 10);

    function pickFile(accept, multiple, cb) {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = accept;
        inp.multiple = !!multiple;
        inp.style.display = 'none';
        document.body.appendChild(inp);
        inp.addEventListener('change', () => {
            const fs = inp.files;
            inp.remove();
            if (fs && fs.length) cb(fs);
        });
        inp.click();
    }

    /* ---------------- 覆盖层读写 ---------------- */
    function loadOverlay() { return store.get(KEY, null); }

    function saveOverlay() {
        store.set(KEY, {
            site: working.site,
            couple: working.couple,
            anniversaries: working.anniversaries,
            timeline: working.timeline,
            gallery: working.gallery
        });
    }

    function getWorkingBase() {
        const o = loadOverlay();
        if (o) return clone(o);
        return {
            site: clone(state.config.site),
            couple: clone(state.config.couple),
            anniversaries: clone(state.config.anniversaries || []),
            timeline: clone(state.config.timeline || []),
            gallery: clone(state.config.gallery || [])
        };
    }

    /* ---------------- 供 core.js 启动调用 ---------------- */
    function applyOverlay(cfg) {
        const o = loadOverlay();
        if (!o) return;
        if (o.site) Object.assign(cfg.site, o.site);
        if (o.couple) cfg.couple = o.couple;
        if (o.anniversaries) cfg.anniversaries = o.anniversaries;
        if (o.timeline) cfg.timeline = o.timeline;
        if (o.gallery) cfg.gallery = o.gallery;
    }

    async function resolveMediaRefs(cfg) {
        if (!window.LPMedia) return;
        const ids = {};
        const collect = (v) => { if (isRef(v)) ids[refId(v)] = null; };
        (cfg.couple && cfg.couple.partners || []).forEach((p) => collect(p.avatar));
        (cfg.timeline || []).forEach((t) => collect(t.photo));
        (cfg.gallery || []).forEach((g) => collect(g.src));

        const list = Object.keys(ids);
        await Promise.all(list.map(async (id) => { ids[id] = await LPMedia.urlOf(id); }));

        const rep = (v) => isRef(v) ? (ids[refId(v)] || v) : v;
        (cfg.couple.partners || []).forEach((p) => { p.avatar = rep(p.avatar); });
        (cfg.timeline || []).forEach((t) => { t.photo = rep(t.photo); });
        (cfg.gallery || []).forEach((g) => { g.src = rep(g.src); });
    }

    /* ---------------- 持久化并刷新前台 ---------------- */
    function commit() {
        saveOverlay();
        state.config.site = clone(working.site);
        state.config.couple = clone(working.couple);
        state.config.anniversaries = clone(working.anniversaries);
        state.config.timeline = clone(working.timeline);
        state.config.gallery = clone(working.gallery);
        resolveMediaRefs(state.config).then(() => {
            applySiteChrome();
            if (LP.renderAll) LP.renderAll();
            if (LP.startCounter) LP.startCounter();
            if (LP.renderMessages) LP.renderMessages();
        });
    }

    function applySiteChrome() {
        const s = working.site || {};
        document.title = s.title || '我们的故事';
        const brand = $('#brand-text'); if (brand) brand.textContent = s.title || '';
        const eyebrow = $('#hero-eyebrow'); if (eyebrow && s.subtitle) eyebrow.textContent = s.subtitle;
        const note = $('#footer-note'); if (note) note.textContent = s.footerNote || '';
    }

    /* ---------------- 表单小部件 ---------------- */
    function textRow(label, coll, i, f, val, opts) {
        opts = opts || {};
        const id = `f-${coll}-${i == null ? 'x' : i}-${f}`;
        const type = opts.type || 'text';
        const extra = opts.extra || '';
        const attrs = type === 'checkbox'
            ? `type="checkbox" ${val ? 'checked' : ''}`
            : `type="${type}" value="${esc(val == null ? '' : val)}"`;
        return `<label class="ed-row"><span class="ed-label">${esc(label)}</span>` +
            `<input class="ed-input" id="${id}" data-coll="${coll}" ${i != null ? `data-i="${i}"` : ''} data-f="${esc(f)}" ${attrs} ${extra}></label>`;
    }

    function areaRow(label, coll, i, f, val) {
        return `<label class="ed-row ed-row-area"><span class="ed-label">${esc(label)}</span>` +
            `<textarea class="ed-input" data-coll="${coll}" ${i != null ? `data-i="${i}"` : ''} data-f="${esc(f)}" rows="3">${esc(val || '')}</textarea></label>`;
    }

    function selectRow(label, coll, i, f, val, options) {
        const opts = options.map((o) =>
            `<option value="${esc(o.v)}" ${o.v === val ? 'selected' : ''}>${esc(o.t)}</option>`).join('');
        return `<label class="ed-row"><span class="ed-label">${esc(label)}</span>` +
            `<select class="ed-input" data-coll="${coll}" ${i != null ? `data-i="${i}"` : ''} data-f="${esc(f)}">${opts}</select></label>`;
    }

    /* ---------------- 各板块渲染 ---------------- */
    function renderSite() {
        const s = working.site;
        return `<div class="ed-sec">
            ${textRow('站点标题', 'site', null, 'title', s.title)}
            ${textRow('副标题 / 英文', 'site', null, 'subtitle', s.subtitle)}
            ${areaRow('页脚寄语', 'site', null, 'footerNote', s.footerNote)}
            ${areaRow('主页宣言', 'site', null, 'declaration', s.declaration)}
            <div class="ed-2col">
              ${textRow('在一起日期', 'site', null, 'startDate', s.startDate, { type: 'date' })}
              ${textRow('在一起时间', 'site', null, 'startTime', s.startTime, { type: 'time' })}
            </div>
            ${textRow('倒计时·前文案', 'site', null, 'counterTextBefore', s.counterTextBefore)}
            ${textRow('倒计时·后文案', 'site', null, 'counterTextAfter', s.counterTextAfter)}
            <div class="ed-2col">
              ${textRow('访问密码', 'site', null, 'password', s.password, { type: 'password' })}
              ${textRow('密码有效期(分)', 'site', null, 'passwordExpiryMinutes', s.passwordExpiryMinutes, { type: 'number' })}
            </div>
            ${textRow('开启密码锁', 'site', null, 'passwordEnabled', s.passwordEnabled, { type: 'checkbox' })}
            <p class="ed-tip">提示：改了访问密码，下次锁定后就用新密码进入。</p>
        </div>`;
    }

    function renderCouple() {
        const parts = (working.couple.partners || []);
        const suffix = ['a', 'b'];
        return `<div class="ed-sec">` + parts.map((p, i) => {
            const av = p.avatar || '';
            const preview = isRef(av) ? '' : av;
            return `<div class="ed-card">
                <div class="ed-card-head">
                    <img class="ed-av" ${preview ? `src="${esc(preview)}"` : ''} data-ref="${esc(av)}" alt="">
                    <button class="btn-mini" data-action="partner-avatar" data-i="${i}" type="button">换头像</button>
                </div>
                ${textRow('昵称', 'partner', i, 'name', p.name)}
                ${textRow('称呼（他/她）', 'partner', i, 'role', p.role)}
                ${textRow('生日', 'partner', i, 'birthday', p.birthday, { type: 'date' })}
                ${textRow('城市', 'partner', i, 'city', p.city)}
                ${textRow('MBTI', 'partner', i, 'mbti', p.mbti)}
                ${textRow('口头禅', 'partner', i, 'motto', p.motto)}
                ${textRow('标签（顿号分隔）', 'partner', i, 'tags', (p.tags || []).join('、'))}
                ${textRow('主题色', 'partner', i, 'accent', p.accent, { type: 'color' })}
            </div>`;
        }).join('') + `</div>`;
    }

    function renderAnniv() {
        const list = working.anniversaries || [];
        const items = list.map((it, i) => `
            <div class="ed-item">
                <div class="ed-item-bar">
                    <span class="ed-item-idx">${i + 1}</span>
                    <button class="ed-del" data-action="anniv-del" data-i="${i}" type="button" aria-label="删除">✕</button>
                </div>
                <div class="ed-2col">
                    ${textRow('名称', 'anniv', i, 'title', it.title)}
                    ${textRow('日期', 'anniv', i, 'date', it.date, { type: 'date' })}
                </div>
                <div class="ed-2col">
                    ${selectRow('类型', 'anniv', i, 'type', it.type, [
                        { v: 'annual', t: '每年' }, { v: 'once', t: '一次性' }])}
                    ${selectRow('图标', 'anniv', i, 'icon', it.icon, [
                        { v: 'heart', t: '爱心' }, { v: 'cake', t: '蛋糕' }, { v: 'plane', t: '旅行' },
                        { v: 'ring', t: '戒指' }, { v: 'home', t: '家' }, { v: 'star', t: '星' }])}
                </div>
                ${textRow('单位（如：岁）', 'anniv', i, 'unit', it.unit)}
                ${areaRow('备注', 'anniv', i, 'note', it.note)}
            </div>`).join('');
        return `<div class="ed-sec">
            <button class="btn-add" data-action="anniv-add" type="button">+ 添加纪念日</button>
            ${items || '<p class="ed-empty">还没有，点上面加一个</p>'}
        </div>`;
    }

    function renderTimeline() {
        const list = (working.timeline || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
        // 用原始下标回写，保持 working.timeline 顺序稳定
        const idxOf = (ev) => working.timeline.indexOf(ev);
        const items = list.map((ev) => {
            const i = idxOf(ev);
            const ph = ev.photo || '';
            const preview = isRef(ph) ? '' : ph;
            return `<div class="ed-item">
                <div class="ed-item-bar">
                    <span class="ed-item-idx">${esc(ev.date || '')}</span>
                    <button class="ed-del" data-action="tl-del" data-i="${i}" type="button" aria-label="删除">✕</button>
                </div>
                <div class="ed-2col">
                    ${textRow('日期', 'timeline', i, 'date', ev.date, { type: 'date' })}
                    ${textRow('心情', 'timeline', i, 'mood', ev.mood)}
                </div>
                ${textRow('标题', 'timeline', i, 'title', ev.title)}
                ${areaRow('描述', 'timeline', i, 'description', ev.description)}
                ${textRow('标签（顿号分隔）', 'timeline', i, 'tags', (ev.tags || []).join('、'))}
                <div class="ed-2col">
                    ${textRow('置顶里程碑', 'timeline', i, 'top', !!ev.top, { type: 'checkbox' })}
                    <div class="ed-photo-wrap">
                        ${ph ? `<img class="ed-photo" ${preview ? `src="${esc(preview)}"` : ''} data-ref="${esc(ph)}" alt="">` : '<span class="ed-photo-ph">无配图</span>'}
                        ${ph
                            ? `<button class="btn-mini" data-action="tl-photo-del" data-i="${i}" type="button">移除图片</button>`
                            : `<button class="btn-mini" data-action="tl-photo-add" data-i="${i}" type="button">加图片</button>`}
                    </div>
                </div>
            </div>`;
        }).join('');
        return `<div class="ed-sec">
            <button class="btn-add" data-action="tl-add" type="button">+ 添加时间轴节点</button>
            ${items || '<p class="ed-empty">还没有，点上面加一个</p>'}
        </div>`;
    }

    async function renderWall() {
        let html = `<div class="ed-sec">
            <button class="btn-add" data-action="wall-add" type="button">+ 添加照片 / 视频</button>`;

        // 已上传的媒体（IndexedDB）
        let media = [];
        if (window.LPMedia) {
            try { media = await LPMedia.all(); } catch (e) { /* ignore */ }
        }
        if (media.length) {
            html += '<p class="ed-sub">已上传的媒体（本机）</p>';
            html += media.map((r) => `
                <div class="ed-item">
                    <div class="ed-item-bar">
                        <span class="ed-item-idx">${esc(r.kind === 'video' ? '视频' : '照片')}</span>
                        <button class="ed-del" data-action="wall-del" data-id="${esc(r.id)}" type="button" aria-label="删除">✕</button>
                    </div>
                    <div class="ed-2col">
                        <img class="ed-photo" data-ref="${esc('idb://' + r.id)}" alt="">
                        <div>
                            ${textRow('说明', 'wall', null, 'caption', r.caption, { extra: `data-id="${esc(r.id)}"` })}
                            ${textRow('日期', 'wall', null, 'date', r.date, { type: 'date', extra: `data-id="${esc(r.id)}"` })}
                        </div>
                    </div>
                </div>`).join('');
        }

        // 配置里的静态照片（可改说明 / 删除）
        const gallery = working.gallery || [];
        const staticItems = gallery.filter((g) => !isRef(g.src));
        if (staticItems.length) {
            html += '<p class="ed-sub">页面自带照片</p>';
            html += staticItems.map((g) => {
                const i = gallery.indexOf(g);
                return `<div class="ed-item">
                    <div class="ed-item-bar">
                        <span class="ed-item-idx">自带</span>
                        <button class="ed-del" data-action="gallery-del" data-i="${i}" type="button" aria-label="删除">✕</button>
                    </div>
                    <div class="ed-2col">
                        <img class="ed-photo" src="${esc(g.src)}" alt="">
                        <div>
                            ${textRow('说明', 'gallery', i, 'caption', g.caption)}
                            ${textRow('日期', 'gallery', i, 'date', g.date, { type: 'date' })}
                        </div>
                    </div>
                </div>`;
            }).join('');
        }
        html += `<p class="ed-tip">照片/视频只存在这部手机浏览器里。换设备时在「导出备份」里把整个站点设置带走，再到另一台导入即可。</p></div>`;
        return html;
    }

    /* ---------------- 渲染总控 ---------------- */
    async function renderTab() {
        const body = $('#editor-body');
        if (!body) return;
        let html;
        if (activeTab === 'site') html = renderSite();
        else if (activeTab === 'couple') html = renderCouple();
        else if (activeTab === 'anniv') html = renderAnniv();
        else if (activeTab === 'timeline') html = renderTimeline();
        else if (activeTab === 'wall') html = await renderWall();
        else html = '';
        body.innerHTML = html;
        bindTabInputs(body);
        resolvePreviews(body);
    }

    function resolvePreviews(root) {
        if (!window.LPMedia) return;
        $$('img[data-ref]', root).forEach(async (img) => {
            const v = img.dataset.ref;
            if (isRef(v)) {
                const u = await LPMedia.urlOf(refId(v));
                if (u) img.src = u;
            } else if (v) {
                img.src = v;
            }
        });
    }

    /* ---------------- 输入绑定 ---------------- */
    function bindTabInputs(body) {
        // 文本/选择/勾选：失焦或切换时写入 working 并提交（不重渲本标签，保留焦点）
        body.addEventListener('change', (e) => {
            const t = e.target;
            const coll = t.dataset.coll;
            if (!coll) return;
            writeField(coll, t);
        });
    }

    function writeField(coll, t) {
        const f = t.dataset.f;
        let val;
        if (t.type === 'checkbox') val = t.checked;
        else if (t.type === 'number') val = t.value === '' ? null : Number(t.value);
        else val = t.value;

        // 照片墙里的媒体说明/日期 → 直接写进 IndexedDB 记录
        if (coll === 'wall') {
            const id = t.dataset.id;
            if (!id || !window.LPMedia) return;
            LPMedia.get(id).then((rec) => {
                if (!rec) return;
                rec[f] = val;
                return LPMedia.put(rec);
            }).then(() => { if (LP.renderAll) LP.renderAll(); });
            return;
        }

        if (coll === 'site') {
            working.site[f] = val;
            commit();
            return;
        }
        if (coll === 'partner' && f === 'tags') {
            working.couple.partners[+t.dataset.i].tags = String(val || '')
                .split(/[、,，]/).map((s) => s.trim()).filter(Boolean);
            commit();
            return;
        }

        const i = +t.dataset.i;
        if (coll === 'partner') working.couple.partners[i][f] = val;
        else if (coll === 'anniv') working.anniversaries[i][f] = val;
        else if (coll === 'timeline') working.timeline[i][f] = val;
        else if (coll === 'gallery') working.gallery[i][f] = val;
        commit();
    }

    /* ---------------- 按钮动作 ---------------- */
    async function onAction(act, el) {
        if (act === 'anniv-add') {
            working.anniversaries.push({ title: '', date: todayStr(), type: 'annual', icon: 'heart', note: '', unit: '' });
            commit(); renderTab();
        } else if (act === 'anniv-del') {
            working.anniversaries.splice(+el.dataset.i, 1); commit(); renderTab();
        } else if (act === 'tl-add') {
            working.timeline.push({ date: todayStr(), title: '', description: '', tags: [], mood: '', top: false, photo: '' });
            commit(); renderTab();
        } else if (act === 'tl-del') {
            working.timeline.splice(+el.dataset.i, 1); commit(); renderTab();
        } else if (act === 'gallery-del') {
            working.gallery.splice(+el.dataset.i, 1); commit(); renderTab();
        } else if (act === 'tl-photo-del') {
            working.timeline[+el.dataset.i].photo = ''; commit(); renderTab();
        } else if (act === 'tl-photo-add') {
            const i = +el.dataset.i;
            pickFile('image/*', false, (files) => {
                const file = files[0];
                const id = 'tl-' + Date.now().toString(36);
                LPMedia.putImage(id, file).then(() => {
                    working.timeline[i].photo = 'idb://' + id;
                    commit(); renderTab();
                }).catch(() => toast('图片存失败了'));
            });
        } else if (act === 'partner-avatar') {
            const i = +el.dataset.i;
            const id = 'avatar-' + (i === 0 ? 'a' : 'b');
            pickFile('image/*', false, (files) => {
                LPMedia.putImage(id, files[0]).then(() => {
                    working.couple.partners[i].avatar = 'idb://' + id;
                    commit(); renderTab();
                }).catch(() => toast('头像存失败了'));
            });
        } else if (act === 'wall-add') {
            pickFile('image/*,video/*', true, (files) => {
                LPMedia.addFiles(files).then((res) => {
                    if (res.saved.length) toast(`已添加 ${res.saved.length} 个`);
                    else if (res.skipped.length) toast(res.skipped[0].reason);
                    commit(); renderTab();
                }).catch(() => toast('添加失败'));
            });
        } else if (act === 'wall-del') {
            const id = el.dataset.id;
            LPMedia.del(id).then(() => { commit(); renderTab(); });
        }
    }

    /* ---------------- 导出 / 导入 ---------------- */
    function exportBackup() {
        const data = {
            site: working.site,
            couple: working.couple,
            anniversaries: working.anniversaries,
            timeline: working.timeline,
            gallery: working.gallery
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `我们的小星球-备份-${todayStr()}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        toast('已导出备份');
    }

    function importBackup() {
        pickFile('application/json,.json', false, (files) => {
            const file = files[0];
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const o = JSON.parse(reader.result);
                    if (!o || typeof o !== 'object') throw new Error('格式不对');
                    working = {
                        site: o.site || clone(state.config.site),
                        couple: o.couple || clone(state.config.couple),
                        anniversaries: o.anniversaries || [],
                        timeline: o.timeline || [],
                        gallery: o.gallery || []
                    };
                    commit();
                    renderTab();
                    toast('已导入');
                } catch (e) {
                    toast('导入失败：不是有效的备份文件');
                }
            };
            reader.readAsText(file);
        });
    }

    /* ---------------- 打开 / 关闭 ---------------- */
    function openEditor() {
        working = getWorkingBase();
        const sheet = $('#editor-sheet');
        sheet.classList.add('is-open');
        sheet.setAttribute('aria-hidden', 'false');
        renderTab();
    }

    function closeEditor() {
        const sheet = $('#editor-sheet');
        sheet.classList.remove('is-open');
        sheet.setAttribute('aria-hidden', 'true');
    }

    /* ---------------- 一次性初始化静态监听 ---------------- */
    function init() {
        if (inited) return;
        inited = true;

        $('#editor-close').addEventListener('click', closeEditor);
        $('#editor-done').addEventListener('click', () => { commit(); closeEditor(); });
        $('#editor-export').addEventListener('click', exportBackup);
        $('#editor-import').addEventListener('click', importBackup);

        $('#editor-sheet').addEventListener('click', (e) => {
            if (e.target.id === 'editor-sheet') closeEditor();
        });

        $$('.editor-tab').forEach((tab) => {
            tab.addEventListener('click', () => {
                $$('.editor-tab').forEach((t) => t.classList.toggle('is-active', t === tab));
                activeTab = tab.dataset.tab;
                renderTab();
            });
        });

        // 列表内的按钮动作（事件委托）
        $('#editor-body').addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;
            e.preventDefault();
            onAction(btn.dataset.action, btn);
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && $('#editor-sheet').classList.contains('is-open')) closeEditor();
        });
    }

    init();

    // 对外接口
    LP.Editor = { open: openEditor, applyOverlay, resolveMediaRefs };

})(window.LP);
