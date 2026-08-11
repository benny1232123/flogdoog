/* =========================================================
   app.js — 业务模块层
   双人资料卡 / 纪念日倒数 / 时间轴 / 照片墙 + 灯箱 / 悄悄话留言板
   （以上模块中，除时间轴外均为本次二次开发新增）
   ========================================================= */

(function (LP) {
    'use strict';

    const { $, $$, store, esc, pad, parseDate, dayDiff, fmtDate, fmtRelTime, state, toast, observeReveal, lazyImages, LS } = LP;

    /* =========================================================
       图标库
       ========================================================= */
    const ICONS = {
        heart: '<svg viewBox="0 0 32 29" fill="currentColor"><path d="M16 28S1 18.5 1 9.8A8.8 8.8 0 0 1 16 4.4 8.8 8.8 0 0 1 31 9.8C31 18.5 16 28 16 28z"/></svg>',
        cake: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20h16v-6a3 3 0 00-3-3H7a3 3 0 00-3 3v6z"/><path d="M12 8V4"/><path d="M4 16c2 1.4 4 1.4 6 0s4-1.4 6 0 2 1.4 4 0"/></svg>',
        plane: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 13l20-8-8 20-2-8-10-4z"/></svg>',
        ring: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="15" r="6"/><path d="M9 6l3-3 3 3-3 3-3-3z"/></svg>',
        home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>',
        star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 18l-5.9 3 1.2-6.5L2.5 9.9 9.1 9 12 3z"/></svg>',
        heartLine: '<svg viewBox="0 0 32 29"><path d="M16 28S1 18.5 1 9.8A8.8 8.8 0 0 1 16 4.4 8.8 8.8 0 0 1 31 9.8C31 18.5 16 28 16 28z"/></svg>'
    };
    const icon = (name) => ICONS[name] || ICONS.star;

    /* =========================================================
       模块 1 — 双人资料卡（新增）
       ========================================================= */
    function renderCouple() {
        const c = state.config.couple;
        const [a, b] = c.partners || [];
        if (!a || !b) return;

        // Hero 双头像
        const bind = (suffix, p) => {
            const img = $('#avatar-' + suffix);
            if (img) { img.src = p.avatar; img.alt = p.name; }
            const n = $('#name-' + suffix);
            if (n) n.textContent = p.name;
            const r = $('#role-' + suffix);
            if (r) r.textContent = p.role || '';
        };
        bind('a', a);
        bind('b', b);

        const dec = $('#declaration');
        if (dec) dec.textContent = c.declaration || '';

        // 资料卡
        const box = $('#profile-cards');
        if (!box) return;

        box.innerHTML = (c.partners || []).map((p) => {
            const age = p.birthday ? calcAge(p.birthday) : null;
            const rows = [
                p.birthday ? ['生日', `${p.birthday.slice(5).replace('-', ' / ')}${age !== null ? `　${age} 岁` : ''}`] : null,
                p.city ? ['城市', p.city] : null
            ].filter(Boolean);

            return `
            <article class="card" style="--accent:${esc(p.accent || '#E8899A')}">
                <div class="card-head">
                    <img class="card-avatar" src="${esc(p.avatar)}" alt="${esc(p.name)}">
                    <span class="card-name">${esc(p.name)}</span>
                    ${p.mbti ? `<span class="card-mbti">${esc(p.mbti)}</span>` : ''}
                </div>
                <dl class="card-rows">
                    ${rows.map(([k, v]) => `<div class="card-row"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}
                </dl>
                ${(p.tags && p.tags.length) ? `<div class="card-tags">${p.tags.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>` : ''}
                ${p.motto ? `<p class="card-motto">「${esc(p.motto)}」</p>` : ''}
            </article>`;
        }).join('');
    }

    function calcAge(birthday) {
        const b = parseDate(birthday);
        const n = new Date();
        let age = n.getFullYear() - b.getFullYear();
        const m = n.getMonth() - b.getMonth();
        if (m < 0 || (m === 0 && n.getDate() < b.getDate())) age--;
        return age >= 0 ? age : null;
    }

    /* =========================================================
       模块 2 — 纪念日倒数（新增：原项目仅有单一恋爱计时器）
       ========================================================= */
    // 纪念日的周年单位：默认「周年」，生日类可在 config 中配 "unit": "岁"
    const it_unit = (item) => item.unit || '周年';

    function renderAnniversaries() {
        const box = $('#anniv-grid');
        const list = state.config.anniversaries || [];
        if (!box) return;

        const today = new Date();

        const computed = list.map((item) => {
            const base = parseDate(item.date);
            let info;

            if (item.type === 'once') {
                // 一次性：只算与当天的距离
                const diff = dayDiff(today, base);
                info = diff > 0
                    ? { kind: 'future', num: diff, word: '天后', extra: '' }
                    : diff === 0
                        ? { kind: 'today', num: '就是今天', word: '', extra: '' }
                        : { kind: 'past', num: Math.abs(diff), word: '天前', extra: '' };
                return Object.assign({}, item, { base, sortKey: diff < 0 ? 1e6 - diff : diff }, { info });
            }

            // 每年重复：找下一次。
            // 注：2/29 的纪念日在平年会被 JS 自动进位为 3/1，属可接受降级。
            let next = new Date(today.getFullYear(), base.getMonth(), base.getDate());
            const isToday = dayDiff(today, next) === 0;
            if (!isToday && next < today) next = new Date(today.getFullYear() + 1, base.getMonth(), base.getDate());

            const diff = dayDiff(today, next);
            const nth = next.getFullYear() - base.getFullYear();
            // unit = "岁" 时用「29 岁生日」，否则用「第 5 个周年」
            const isAge = it_unit(item) === '岁';
            const nthText = nth > 0 ? (isAge ? `${nth} 岁` : `第 ${nth} 个周年`) : '';

            info = isToday
                ? {
                    kind: 'today',
                    num: nth > 0 ? (isAge ? nth : `第 ${nth} 个`) : '就是今天',
                    word: nth > 0 ? (isAge ? '岁生日快乐' : '周年') : '',
                    extra: ''
                }
                : { kind: 'future', num: diff, word: '天后', extra: nthText };

            return Object.assign({}, item, { base, next, sortKey: diff, info });
        });

        // 今天的排最前，其余按临近程度
        computed.sort((x, y) => {
            const tx = x.info.kind === 'today' ? -1 : 0;
            const ty = y.info.kind === 'today' ? -1 : 0;
            if (tx !== ty) return tx - ty;
            return x.sortKey - y.sortKey;
        });

        box.innerHTML = computed.map((it) => {
            const cls = ['anniv', 'reveal'];
            if (it.info.kind === 'today') cls.push('is-today');
            if (it.info.kind === 'past') cls.push('is-past');

            const dateText = it.type === 'once'
                ? fmtDate(it.base)
                : `${pad(it.base.getMonth() + 1)} 月 ${pad(it.base.getDate())} 日 · 每年`;

            return `
            <article class="${cls.join(' ')}">
                ${it.info.kind === 'today' ? '<span class="anniv-badge">TODAY</span>' : ''}
                <div class="anniv-icon">${icon(it.icon)}</div>
                <h3 class="anniv-title">${esc(it.title)}</h3>
                <p class="anniv-date">${esc(dateText)}</p>
                <div class="anniv-count">
                    <span class="anniv-num">${esc(it.info.num)}</span>
                    ${it.info.word ? `<span class="anniv-word">${esc(it.info.word)}</span>` : ''}
                </div>
                ${it.info.extra ? `<p class="anniv-note">${esc(it.info.extra)}</p>` : ''}
                ${it.note ? `<p class="anniv-note">${esc(it.note)}</p>` : ''}
            </article>`;
        }).join('');

        observeReveal($$('.anniv', box));
    }

    /* =========================================================
       模块 3 — 时间轴（继承原项目，改为双列交错 + 点击开灯箱）
       ========================================================= */
    function renderTimeline() {
        const box = $('#timeline');
        if (!box) return;

        const list = (state.config.timeline || []).slice();
        list.sort((a, b) => parseDate(a.date) - parseDate(b.date));
        if (state.settings.reverseTimeline) list.reverse();

        // 置顶项优先
        list.sort((a, b) => (b.top ? 1 : 0) - (a.top ? 1 : 0));

        box.innerHTML = list.map((ev) => {
            const d = parseDate(ev.date);
            return `
            <article class="tl-item">
                <span class="tl-dot"></span>
                <div class="tl-card">
                    ${ev.photo ? `
                    <div class="tl-photo" data-photo="${esc(ev.photo)}" data-caption="${esc(ev.title)}" data-date="${esc(ev.date)}">
                        ${ev.top ? '<span class="tl-top-flag">里程碑</span>' : ''}
                        <img data-src="${esc(ev.photo)}" alt="${esc(ev.title)}">
                    </div>` : ''}
                    <div class="tl-body">
                        <div class="tl-meta">
                            <time class="tl-date">${esc(fmtDate(d))}</time>
                            ${ev.mood ? `<span class="tl-mood">${esc(ev.mood)}</span>` : ''}
                        </div>
                        <h3 class="tl-title">${esc(ev.title)}</h3>
                        <p class="tl-desc">${esc(ev.description || '')}</p>
                        ${(ev.tags && ev.tags.length) ? `<div class="tl-tags">${ev.tags.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>` : ''}
                    </div>
                </div>
            </article>`;
        }).join('');

        lazyImages(box);
        observeReveal($$('.tl-item', box));

        $$('.tl-photo', box).forEach((el) => {
            el.addEventListener('click', () => {
                openLightbox([{ src: el.dataset.photo, caption: el.dataset.caption, date: el.dataset.date }], 0);
            });
        });
    }

    /* =========================================================
       模块 4 — 照片墙 + 灯箱（新增）
       ========================================================= */
    let lbList = [];
    let lbIndex = 0;
    let wallItems = [];      // 当前照片墙的完整数据（静态 + 上传）

    // 把配置中的静态照片与 IndexedDB 中的上传媒体合并成统一结构
    async function buildWallItems() {
        const staticList = (state.config.gallery || []).map((p) => ({
            kind: 'image',
            src: p.src,
            caption: p.caption || '',
            date: p.date || '',
            w: p.w || null,
            h: p.h || null,
            uploaded: false
        }));

        let uploaded = [];
        if (window.LPMedia) {
            try {
                const recs = await window.LPMedia.all();
                uploaded = recs.map((r) => ({
                    id: r.id,
                    kind: r.kind,
                    src: window.LPMedia.toURL(r.blob),
                    poster: r.poster ? window.LPMedia.toURL(r.poster) : null,
                    caption: r.caption || '',
                    date: r.date || '',
                    w: r.w || null,
                    h: r.h || null,
                    size: r.size || 0,
                    duration: r.duration || null,
                    uploaded: true
                }));
            } catch (e) {
                console.warn('[LP] 读取本地媒体失败：', e);
            }
        }

        // 上传的排在前面（最新的先看到）
        return uploaded.concat(staticList);
    }

    async function renderWall() {
        const box = $('#wall-grid');
        if (!box) return;

        if (window.LPMedia) window.LPMedia.revokeAll();
        wallItems = await buildWallItems();

        box.innerHTML = wallItems.map((p, i) => {
            const ar = (p.w && p.h) ? `style="aspect-ratio:${p.w}/${p.h}"` : '';
            const thumb = p.kind === 'video' ? (p.poster || '') : p.src;
            const noPoster = p.kind === 'video' && !p.poster;

            return `
            <figure class="wall-item${p.kind === 'video' ? ' is-video' : ''}" data-index="${i}">
                ${noPoster
                    ? `<div class="wall-noposter" ${ar}>
                           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                               <rect x="2" y="5" width="14" height="14" rx="3"/><path d="M16 10l6-3v10l-6-3z"/>
                           </svg>
                       </div>`
                    : `<img ${p.uploaded ? `src="${esc(thumb)}"` : `data-src="${esc(thumb)}"`} alt="${esc(p.caption || '照片')}" ${ar}>`}
                ${p.kind === 'video' ? `
                <span class="wall-play" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5l12 7-12 7z"/></svg>
                </span>
                ${p.duration ? `<span class="wall-dur">${esc(fmtDur(p.duration))}</span>` : ''}` : ''}
                ${p.uploaded ? '<span class="wall-mine">我上传的</span>' : ''}
                <figcaption class="wall-cap">
                    <b>${esc(p.caption || '')}</b>
                    ${p.date ? `<small>${esc(String(p.date).replace(/-/g, '.'))}</small>` : ''}
                </figcaption>
            </figure>`;
        }).join('');

        lazyImages(box);
        observeReveal($$('.wall-item', box));

        $$('.wall-item', box).forEach((el) => {
            el.addEventListener('click', () => openLightbox(wallItems, Number(el.dataset.index)));
        });

        // 上传的图片是即时 ObjectURL，直接标记为已加载
        $$('.wall-item img[src]', box).forEach((img) => img.classList.add('is-loaded'));
    }

    function fmtDur(sec) {
        if (!sec || !isFinite(sec)) return '';
        const m = Math.floor(sec / 60);
        const s = Math.round(sec % 60);
        return `${m}:${pad(s)}`;
    }

    function openLightbox(list, index) {
        lbList = list;
        lbIndex = index;
        const lb = $('#lightbox');
        paintLightbox();
        lb.classList.add('is-open');
        lb.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';

        const single = list.length <= 1;
        $('#lb-prev').style.display = single ? 'none' : '';
        $('#lb-next').style.display = single ? 'none' : '';
    }

    function paintLightbox() {
        const item = lbList[lbIndex];
        if (!item) return;

        const img = $('#lb-img');
        const vid = $('#lb-video');
        const del = $('#lb-del');

        // 切换前先停掉正在播放的视频
        vid.pause();

        if (item.kind === 'video') {
            img.hidden = true;
            vid.hidden = false;
            vid.src = item.src;
            if (item.poster) vid.poster = item.poster;
            else vid.removeAttribute('poster');
            vid.load();
        } else {
            vid.hidden = true;
            vid.removeAttribute('src');
            img.hidden = false;
            img.style.opacity = 0;
            const tmp = new Image();
            const show = () => { img.src = item.src; img.style.opacity = 1; };
            tmp.onload = show;
            tmp.onerror = show;
            tmp.src = item.src;
        }

        $('#lb-caption').textContent = item.caption || '';
        const parts = [];
        if (item.date) parts.push(String(item.date).replace(/-/g, '.'));
        if (item.size && window.LPMedia) parts.push(window.LPMedia.fmtSize(item.size));
        $('#lb-date').textContent = parts.join('  ·  ');

        // 只有用户上传的内容才可删除（配置里的静态照片需改 config.json）
        del.hidden = !item.uploaded;
    }

    function closeLightbox() {
        const lb = $('#lightbox');
        const vid = $('#lb-video');
        vid.pause();
        lb.classList.remove('is-open');
        lb.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
    }

    function stepLightbox(dir) {
        if (lbList.length <= 1) return;
        lbIndex = (lbIndex + dir + lbList.length) % lbList.length;
        paintLightbox();
    }

    function initLightbox() {
        $('#lb-close').addEventListener('click', closeLightbox);
        $('#lb-prev').addEventListener('click', (e) => { e.stopPropagation(); stepLightbox(-1); });
        $('#lb-next').addEventListener('click', (e) => { e.stopPropagation(); stepLightbox(1); });
        $('#lightbox').addEventListener('click', (e) => {
            if (e.target.id === 'lightbox' || e.target.classList.contains('lb-stage')) closeLightbox();
        });

        document.addEventListener('keydown', (e) => {
            if (!$('#lightbox').classList.contains('is-open')) return;
            if (e.key === 'Escape') closeLightbox();
            // 视频聚焦时方向键交给播放器（调进度），避免误切图
            if (document.activeElement === $('#lb-video')) return;
            if (e.key === 'ArrowLeft') stepLightbox(-1);
            if (e.key === 'ArrowRight') stepLightbox(1);
        });

        // 移动端左右滑动切图（视频区域内不拦截，留给播放器操作）
        let x0 = null;
        const stage = $('#lightbox');
        stage.addEventListener('touchstart', (e) => {
            x0 = e.target.closest('#lb-video') ? null : e.touches[0].clientX;
        }, { passive: true });
        stage.addEventListener('touchend', (e) => {
            if (x0 === null) return;
            const dx = e.changedTouches[0].clientX - x0;
            if (Math.abs(dx) > 48) stepLightbox(dx > 0 ? -1 : 1);
            x0 = null;
        }, { passive: true });

        // 灯箱内删除上传的媒体
        $('#lb-del').addEventListener('click', async () => {
            const item = lbList[lbIndex];
            if (!item || !item.uploaded || !window.LPMedia) return;
            if (!confirm('确定删除这个' + (item.kind === 'video' ? '视频' : '照片') + '吗？')) return;
            await window.LPMedia.del(item.id);
            closeLightbox();
            await renderWall();
            await refreshStorageInfo();
            toast('已删除');
        });
    }

    /* =========================================================
       模块 4b — 上传（本次新增）
       点击 / 拖拽 → 压缩或抽帧 → 存 IndexedDB → 重绘照片墙
       ========================================================= */
    let uploading = false;

    function initUploader() {
        const wrap = $('#uploader');
        if (!wrap) return;

        if (!window.LPMedia || !('indexedDB' in window)) {
            wrap.innerHTML = '<div class="uploader-off">当前浏览器不支持本地媒体存储，无法上传</div>';
            return;
        }

        const input = $('#file-input');
        const drop = $('#uploader-drop');
        const bar = $('#uploader-bar');
        const fill = $('#uploader-bar-fill');
        const barText = $('#uploader-bar-text');

        const pick = () => { if (!uploading) input.click(); };
        drop.addEventListener('click', pick);
        $('#uploader-btn').addEventListener('click', (e) => { e.stopPropagation(); pick(); });

        input.addEventListener('change', () => {
            if (input.files && input.files.length) handleFiles(input.files);
            input.value = '';    // 允许重复选同一文件
        });

        // 拖拽
        ['dragenter', 'dragover'].forEach((ev) => {
            drop.addEventListener(ev, (e) => {
                e.preventDefault();
                drop.classList.add('is-over');
            });
        });
        ['dragleave', 'drop'].forEach((ev) => {
            drop.addEventListener(ev, (e) => {
                e.preventDefault();
                if (ev === 'dragleave' && drop.contains(e.relatedTarget)) return;
                drop.classList.remove('is-over');
            });
        });
        drop.addEventListener('drop', (e) => {
            const files = e.dataTransfer && e.dataTransfer.files;
            if (files && files.length) handleFiles(files);
        });

        // 页面其他位置拖入文件时不要让浏览器直接打开文件
        window.addEventListener('dragover', (e) => e.preventDefault());
        window.addEventListener('drop', (e) => {
            if (!drop.contains(e.target)) e.preventDefault();
        });

        $('#btn-clear-media').addEventListener('click', async () => {
            if (!confirm('确定清空所有你上传的照片和视频吗？此操作无法撤销。')) return;
            await window.LPMedia.clear();
            await renderWall();
            await refreshStorageInfo();
            toast('已清空上传的媒体');
        });

        async function handleFiles(files) {
            if (uploading) { toast('正在处理，稍等一下'); return; }
            uploading = true;
            bar.hidden = false;
            drop.classList.add('is-busy');

            const total = files.length;
            const setBar = (done, name) => {
                const pct = total ? Math.round((done / total) * 100) : 0;
                fill.style.width = pct + '%';
                barText.textContent = done >= total
                    ? '处理完成'
                    : `正在处理 ${done + 1}/${total}${name ? '：' + name : ''}`;
            };
            setBar(0, files[0] && files[0].name);

            let res;
            try {
                res = await window.LPMedia.addFiles(files, {
                    onProgress: (done, tot, name) => setBar(done, name)
                });
            } catch (err) {
                console.error(err);
                res = { saved: [], skipped: [{ name: '', reason: '处理出错' }], warnings: [] };
            }

            await renderWall();
            await refreshStorageInfo();

            uploading = false;
            drop.classList.remove('is-busy');
            setTimeout(() => { bar.hidden = true; fill.style.width = '0%'; }, 600);

            // 结果反馈
            if (res.saved.length) {
                const nv = res.saved.filter((r) => r.kind === 'video').length;
                const ni = res.saved.length - nv;
                const parts = [];
                if (ni) parts.push(`${ni} 张照片`);
                if (nv) parts.push(`${nv} 个视频`);
                toast(`已添加 ${parts.join('、')}`);
            }
            if (res.skipped.length) {
                const first = res.skipped[0];
                setTimeout(() => toast(`${res.skipped.length} 个文件未添加：${first.reason}`), 2200);
            } else if (res.warnings.length) {
                setTimeout(() => toast(res.warnings[0]), 2200);
            }
        }
    }

    // 显示已占用空间 + 上传数量
    async function refreshStorageInfo() {
        const el = $('#storage-info');
        const clearBtn = $('#btn-clear-media');
        if (!el || !window.LPMedia) return;

        let count = 0;
        let used = 0;
        try {
            const recs = await window.LPMedia.all();
            count = recs.length;
            used = recs.reduce((s, r) => s + (r.size || 0), 0);
        } catch (e) { /* 忽略 */ }

        if (clearBtn) clearBtn.hidden = count === 0;

        if (!count) {
            el.textContent = '照片和视频都保存在这台设备的浏览器里，不会上传到任何服务器';
            return;
        }

        const est = await window.LPMedia.estimate();
        const quotaText = est && est.quota
            ? `　可用额度约 ${window.LPMedia.fmtSize(est.quota)}`
            : '';
        el.textContent = `已存 ${count} 个文件 · 占用 ${window.LPMedia.fmtSize(used)}${quotaText}`;
    }

    /* =========================================================
       模块 5 — 悄悄话留言板（新增，localStorage 持久化）
       ========================================================= */
    const MOODS = ['想你', '开心', '有点累', '抱抱', '对不起', '谢谢你'];
    let curMood = '';
    let curSpeaker = 0;

    function getMessages() {
        const saved = store.get(LS.messages, null);
        if (saved) return saved;
        // 首次访问：以配置中的预置留言作为种子
        return (state.config.messages || []).slice();
    }

    function setMessages(list) { store.set(LS.messages, list); }

    function renderComposer() {
        const partners = state.config.couple.partners || [];
        curSpeaker = store.get(LS.speaker, 0);
        if (curSpeaker >= partners.length) curSpeaker = 0;

        const sw = $('#who-switch');
        sw.innerHTML = partners.map((p, i) => `
            <button class="who-opt${i === curSpeaker ? ' is-active' : ''}" data-i="${i}" role="tab">
                <img src="${esc(p.avatar)}" alt=""><span>${esc(p.name)}</span>
            </button>`).join('');

        $$('.who-opt', sw).forEach((btn) => {
            btn.addEventListener('click', () => {
                curSpeaker = Number(btn.dataset.i);
                store.set(LS.speaker, curSpeaker);
                $$('.who-opt', sw).forEach((b) => b.classList.toggle('is-active', b === btn));
            });
        });

        const moodBox = $('#moods');
        moodBox.innerHTML = MOODS.map((m) => `<button class="mood-btn" data-m="${esc(m)}">${esc(m)}</button>`).join('');
        $$('.mood-btn', moodBox).forEach((btn) => {
            btn.addEventListener('click', () => {
                const m = btn.dataset.m;
                curMood = (curMood === m) ? '' : m;
                $$('.mood-btn', moodBox).forEach((b) => b.classList.toggle('is-active', b.dataset.m === curMood));
            });
        });

        const input = $('#msg-input');
        const count = $('#char-count');
        const send = $('#msg-send');

        const sync = () => {
            count.textContent = `${input.value.length}/300`;
            send.disabled = input.value.trim().length === 0;
        };
        input.addEventListener('input', sync);
        sync();

        // Ctrl/Cmd + Enter 快速发送
        input.addEventListener('keydown', (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit();
        });
        send.addEventListener('click', submit);

        function submit() {
            const text = input.value.trim();
            if (!text) return;
            const list = getMessages();
            list.push({
                id: 'm' + Date.now(),
                author: partners[curSpeaker].name,
                mood: curMood,
                text,
                time: new Date().toISOString(),
                likes: 0
            });
            setMessages(list);
            input.value = '';
            curMood = '';
            $$('.mood-btn', moodBox).forEach((b) => b.classList.remove('is-active'));
            sync();
            renderMessages();
            toast('已经放进我们的小盒子了');
        }
    }

    function renderMessages() {
        const box = $('#msg-list');
        if (!box) return;

        const partners = state.config.couple.partners || [];
        const list = getMessages().slice().sort((a, b) => new Date(b.time) - new Date(a.time));
        const likes = store.get(LS.likes, {});

        if (!list.length) {
            box.innerHTML = '<div class="msg-empty">还没有悄悄话，写下第一句吧 ♡</div>';
            return;
        }

        // 第二位伴侣的留言靠右显示，形成对话感
        const rightName = partners[1] ? partners[1].name : '';

        box.innerHTML = list.map((m, i) => {
            const p = partners.find((x) => x.name === m.author);
            const isRight = m.author === rightName;
            const id = m.id || ('seed' + i);
            const liked = !!likes[id];
            const n = (m.likes || 0) + (liked ? 1 : 0);

            return `
            <div class="msg${isRight ? ' is-right' : ''}" style="animation-delay:${Math.min(i, 8) * 55}ms">
                <img class="msg-avatar" src="${esc(p ? p.avatar : '')}" alt="${esc(m.author)}">
                <div class="msg-main">
                    <div class="msg-head">
                        <span class="msg-author">${esc(m.author)}</span>
                        ${m.mood ? `<span class="msg-mood">· ${esc(m.mood)}</span>` : ''}
                    </div>
                    <div class="msg-bubble">${esc(m.text)}</div>
                    <div class="msg-foot">
                        <time>${esc(fmtRelTime(m.time))}</time>
                        <button class="like-btn${liked ? ' is-liked' : ''}" data-id="${esc(id)}">
                            ${ICONS.heartLine}<span>${n || ''}</span>
                        </button>
                        <button class="del-btn" data-del="${esc(id)}">删除</button>
                    </div>
                </div>
            </div>`;
        }).join('');

        // 比心
        $$('.like-btn', box).forEach((btn) => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.id;
                const map = store.get(LS.likes, {});
                const nowLiked = !map[id];
                if (nowLiked) map[id] = 1; else delete map[id];
                store.set(LS.likes, map);

                btn.classList.toggle('is-liked', nowLiked);
                btn.classList.add('is-pop');
                setTimeout(() => btn.classList.remove('is-pop'), 260);

                const span = btn.querySelector('span');
                const base = Number(span.textContent || 0);
                const v = nowLiked ? base + 1 : Math.max(0, base - 1);
                span.textContent = v || '';
            });
        });

        // 删除
        $$('.del-btn', box).forEach((btn) => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.del;
                const kept = getMessages().filter((m, i) => (m.id || ('seed' + i)) !== id);
                setMessages(kept);
                renderMessages();
                toast('已删除');
            });
        });
    }

    /* =========================================================
       统一渲染入口
       ========================================================= */
    function renderAll() {
        renderCouple();
        renderAnniversaries();
        renderTimeline();
        renderComposer();
        renderMessages();
        initLightbox();
        initUploader();
        // 照片墙需读 IndexedDB，异步渲染
        renderWall().then(refreshStorageInfo);
    }

    // 挂到 LP 上供 core.js 调用
    LP.renderAll = renderAll;
    LP.renderTimeline = renderTimeline;
    LP.renderMessages = renderMessages;
    LP.getMessages = getMessages;

})(window.LP);
