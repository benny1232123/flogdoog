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
        const lb = $('#lightbox');
        if (lb.dataset.lpInit) return;   // 防止重复渲染时重复绑定
        lb.dataset.lpInit = '1';
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
        if (wrap.dataset.lpInit) return;   // 防止重复渲染时重复绑定
        wrap.dataset.lpInit = '1';

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
            // 新上传的图片/视频 → 防抖上传到云端（base64 随同步包携带），实现跨设备一致
            if (LP.Sync && LP.Sync.schedulePushAll && res.saved.length) {
                LP.Sync.schedulePushAll();
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

    // 已删除的消息 ID 集合（跨设备同步，确保一边删了另一边也消失）
    const MSG_DEL_KEY = 'lp.msgDelIds';
    function getDeletedIds() { return store.get(MSG_DEL_KEY, {}); }
    function addDeletedId(id) {
        if (!id) return;
        const d = getDeletedIds();
        d[id] = true;
        store.set(MSG_DEL_KEY, d);
    }
    function isDeleted(id) { return !!(id && getDeletedIds()[id]); }

    // 确定性稳定 id：同一内容在任意设备生成相同 id（保证删除/合并一致，不依赖易变的数组下标）
    function msgStableId(m) {
        if (m && m.id) return String(m.id);
        const base = (m && (m.time || '')) + '|' + (m && (m.author || '')) + '|' + (m && (m.text || ''));
        return 'm_' + base;
    }

    function getMessages() {
        // 优先用本机已存列表；首次访问以 config 种子作为基础，并统一分配稳定 id 持久化
        let raw = store.get(LS.messages, null);
        if (!Array.isArray(raw)) raw = (state.config.messages || []).map(function (m) { return Object.assign({}, m); });
        let changed = false;
        raw.forEach(function (m) {
            const sid = msgStableId(m);
            if (m.id !== sid) { m.id = sid; changed = true; }
        });
        if (changed && !store.get(LS.messages, null)) store.set(LS.messages, raw.slice());
        else if (changed) store.set(LS.messages, raw);
        // 过滤掉已删除的消息（跨设备同步的删除会标记在此）
        const del = getDeletedIds();
        return raw.filter(function (m) { return !del[m.id]; });
    }

    function setMessages(list) { store.set(LS.messages, list); }

    // 悄悄话即时上云：用全量推送（含所有模块），避免只推 overlay+messages 导致云端模块数据被清空
    let _msgSync = null;
    function syncMessages() {
        if (!LP.Sync || !LP.Sync.isConfigured()) return;
        if (_msgSync) return _msgSync;
        _msgSync = (async function () {
            try {
                // 用全量推送：先拉取合并，再把本机全部内容（含所有模块）上云
                if (LP.Sync.pushAll) { await LP.Sync.pushAll(); return; }
                // 降级：旧版无 pushAll 时走原逻辑
                await LP.Sync.pull();
                const up = Object.assign({}, store.get('lp.userData', {}) || {}, { messages: store.get('lp.messages', null) });
                await LP.Sync.push(up);
            } catch (e) { console.warn('[LP] 悄悄话同步失败：', e); }
            finally { _msgSync = null; }
        })();
        return _msgSync;
    }

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
            syncMessages(); // 立即同步到云端
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
            const id = m.id || msgStableId(m);
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
                if (!id) return;
                addDeletedId(id);  // 标记为已删除（跨设备同步）
                // 从本机消息列表里移除该 id（其余保留），渲染时 getMessages 也会过滤已删除 id
                const list = store.get(LS.messages, []) || [];
                setMessages(list.filter(function (m) { return (m.id || msgStableId(m)) !== id; }));
                renderMessages();
                toast('已删除');
                syncMessages(); // 同步删除到云端
            });
        });
    }

    /* =========================================================
       模块 7 — 经期追踪（新增）
       ========================================================= */
    let calYear, calMonth; // 当前日历显示的年月

    function renderPeriod() {
        if (!LP.Period) return;
        const P = LP.Period;
        const data = P.load();
        const pred = P.predict(data);

        // ---- 预测卡片 ----
        const predictEl = $('#period-predict');
        if (predictEl) {
            const phaseLabels = {
                period: { name: '🔴 经期中', class: 'phase-period' },
                follicular: { name: '🌸 卵泡期', class: 'phase-follicular' },
                ovulation: { name: '💛 排卵期', class: 'phase-ovulation' },
                luteal: { name: '🌙 黄体期', class: 'phase-luteal' },
                unknown: { name: '❓ 未知', class: 'phase-unknown' }
            };
            const ph = phaseLabels[pred.phase] || phaseLabels.unknown;
            const confLabel = pred.confidence === 'high' ? '高' : (pred.confidence === 'medium' ? '中' : '低（记录更多数据后更准）');
            const insights = P.getInsights(data);
            const regLabel = insights.regularity === 'regular' ? '规律 ✅'
                : insights.regularity === 'fair' ? '略不规律'
                : insights.regularity === 'irregular' ? '不规律' : '数据不足';
            const regRange = (insights.minGap != null) ? (insights.minGap + '–' + insights.maxGap + '天') : '';
            const ovWin = (pred.ovulationWindow && pred.ovulationWindow[0])
                ? (formatDisplayDate(pred.ovulationWindow[0]) + '~' + formatDisplayDate(pred.ovulationWindow[1]))
                : (pred.nextOvulation ? formatDisplayDate(pred.nextOvulation) : '?');
            const symText = insights.topSymptoms.length ? ' · 常见: ' + insights.topSymptoms.join('、') : '';

            let remText = '', remClass = '';
            if (pred.phase === 'period') { remText = '🌸 经期进行中，第 ' + (pred.cycleDay || 1) + ' 天 · 多休息、少碰凉、多喝温水～'; remClass = 'rem-period'; }
            else if (pred.daysUntilPeriod != null && pred.daysUntilPeriod >= 0 && pred.daysUntilPeriod <= 3) { remText = '💗 还有 ' + pred.daysUntilPeriod + ' 天来月经，提前备好卫生巾～'; remClass = 'rem-soon'; }
            else if (pred.phase === 'ovulation') { remText = '💛 排卵期：这几天易疲惫也易饿，照顾好自己～'; remClass = 'rem-ovu'; }
            else if (pred.daysUntilPeriod != null && pred.daysUntilPeriod > 3 && pred.daysUntilPeriod <= 8) { remText = '📅 预计 ' + pred.daysUntilPeriod + ' 天后月经，可以提前安排好～'; remClass = 'rem-prep'; }

            predictEl.innerHTML = `
                <div class="predict-card">
                    <div class="predict-phase ${ph.class}">${ph.name}</div>
                    <div class="predict-grid">
                        <div class="predict-item">
                            <span class="predict-label">周期第</span>
                            <span class="predict-val">${pred.cycleDay || '-'}<small>天</small></span>
                        </div>
                        <div class="predict-item">
                            <span class="predict-label">距下次经期</span>
                            <span class="predict-val">${pred.daysUntilPeriod !== null ? pred.daysUntilPeriod : '?'}<small>天后</small></span>
                        </div>
                        <div class="predict-item">
                            <span class="predict-label">预计下次</span>
                            <span class="predict-val">${pred.nextPeriod ? formatDisplayDate(pred.nextPeriod) : '?'}</span>
                        </div>
                        <div class="predict-item">
                            <span class="predict-label">排卵期</span>
                            <span class="predict-val">${ovWin}<small>易孕/注意</small></span>
                        </div>
                        <div class="predict-item">
                            <span class="predict-label">周期规律</span>
                            <span class="predict-val">${regLabel}<small>${regRange}</small></span>
                        </div>
                    </div>
                    <div class="predict-meta">平均周期 ${data.config.cycleLen}天 · 平均经期 ${data.config.duration}天 · 准确度${confLabel}${symText}</div>
                    ${remText ? '<div class="period-reminder ' + remClass + '">' + remText + '</div>' : ''}
                </div>`;
        }

        // ---- 日历 ----
        renderCalendar();

        // ---- 历史记录列表 ----
        renderPeriodList(data);

        // ---- 绑定事件 ----
        bindPeriodEvents();
    }

    function renderCalendar() {
        const P = LP.Period;
        const now = new Date();
        if (calYear == null) { calYear = now.getFullYear(); calMonth = now.getMonth(); }

        const monthEl = $('#cal-month');
        if (monthEl) monthEl.textContent = calYear + '年' + (calMonth + 1) + '月';

        const grid = $('#period-calendar');
        if (!grid) return;

        const calData = P.getCalendarMonth(calYear, calMonth);
        const dowNames = ['日', '一', '二', '三', '四', '五', '六'];

        let html = '<div class="cal-dow">' + dowNames.map(function (d) { return '<span>' + d + '</span>'; }).join('') + '</div>';
        calData.weeks.forEach(function (week) {
            html += '<div class="cal-week">';
            week.forEach(function (cell) {
                if (!cell) { html += '<span class="cal-empty"></span>'; return; }
                var cls = 'cal-day';
                if (cell.isToday) cls += ' is-today';
                if (cell.isPeriod) cls += ' is-period';
                if (cell.isPredicted && !cell.isPeriod) cls += ' is-predicted';
                if (cell.isOvulation && !cell.isPeriod) cls += ' is-ovulation';
                if (cell.isFuture) cls += ' is-future';
                if (cell.flow === '较多') cls += ' flow-heavy';
                else if (cell.flow === '少量') cls += ' flow-light';
                var symDot = (cell.symptoms && cell.symptoms.length && cell.symptoms[0] !== '无') ? '<i class="cal-dot"></i>' : '';
                html += '<button class="' + cls + '" data-iso="' + cell.iso + '" type="button">' + cell.date + symDot + '</button>';
            });
            html += '</div>';
        });
        grid.innerHTML = html;

        $$('.cal-day:not(.is-empty)', grid).forEach(function (btn) {
            btn.addEventListener('click', function () { showDateDetail(this.dataset.iso); });
        });
    }

    function renderPeriodList(data) {
        const list = $('#period-list');
        if (!list) return;
        const rs = data.records.slice().reverse();

        if (rs.length === 0) {
            list.innerHTML = '<p class="period-empty">还没有记录，点击「今天来了」开始第一条吧 🌸</p>';
            return;
        }

        list.innerHTML = rs.map(function (r) {
            var dur = '';
            var s = P._parseISO(r.startDate), e = P._parseISO(r.endDate);
            if (s && e) { var days = Math.round((e - s) / 86400000) + 1; dur = ' · ' + days + '天'; }
            var symHtml = (r.symptoms && r.symptoms.length)
                ? '<span class="rec-sym">' + r.symptoms.map(function (x) { return '[' + x + ']'; }).join(' ') + '</span>' : '';
            return '<div class="rec-card" data-id="' + r.id + '">' +
                '<div class="rec-head"><span class="rec-date">' + formatDisplayDate(r.startDate) + dur + '</span>' +
                '<span class="rec-flow flow-' + (r.flow || 'normal') + '">' + (r.flow || '正常') + '</span></div>' +
                (r.note ? '<p class="rec-note">' + esc(r.note) + '</p>' : '') + symHtml +
                '<div class="rec-actions"><button class="link-btn" data-action="period-edit" data-id="' + r.id + '">编辑</button>' +
                '<button class="link-btn btn-danger" data-action="period-del" data-id="' + r.id + '">删除</button></div></div>';
        }).join('');

        list.addEventListener('click', function (e) {
            var btn = e.target.closest('[data-action]');
            if (!btn) return;
            var id = btn.dataset.id;
            if (btn.dataset.action === 'period-del') {
                if (confirm('确定删除这条记录？')) { LP.Period.delRecord(id); toast('已删除'); renderPeriod(); }
            } else if (btn.dataset.action === 'period-edit') { showEditRecord(id); }
        });
    }

    function bindPeriodEvents() {
        var startBtn = $('#period-start-btn');
        if (startBtn && !startBtn._bound) {
            startBtn._bound = true;
            startBtn.addEventListener('click', function () {
                var data = LP.Period.load();
                var last = data.records[data.records.length - 1];
                if (last && !last.endDate) { last.endDate = LP.Period._fmtISO(new Date()); LP.Period.updateRecord(last.id, { endDate: last.endDate }); }
                LP.Period.addRecord({ startDate: LP.Period._fmtISO(new Date()), flow: '正常' });
                toast('已记录开始 ✓'); renderPeriod();
            });
        }
        var endBtn = $('#period-end-btn');
        if (endBtn && !endBtn._bound) {
            endBtn._bound = true;
            endBtn.addEventListener('click', function () {
                var data = LP.Period.load();
                var last = data.records[data.records.length - 1];
                if (!last) { toast('没有进行中的记录'); return; }
                if (last.endDate && last.endDate !== last.startDate) { toast('当前没有进行中的经期'); return; }
                LP.Period.updateRecord(last.id, { endDate: LP.Period._fmtISO(new Date()) });
                toast('已记录结束 ✓'); renderPeriod();
            });
        }
        var prevBtn = $('#cal-prev'), nextBtn = $('#cal-next'), todayBtn = $('#cal-today');
        if (prevBtn && !prevBtn._bound) {
            prevBtn._bound = true;
            prevBtn.addEventListener('click', function () { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } renderCalendar(); });
        }
        if (nextBtn && !nextBtn._bound) {
            nextBtn._bound = true;
            nextBtn.addEventListener('click', function () { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } renderCalendar(); });
        }
        if (todayBtn && !todayBtn._bound) {
            todayBtn._bound = true;
            todayBtn.addEventListener('click', function () { var n = new Date(); calYear = n.getFullYear(); calMonth = n.getMonth(); renderCalendar(); });
        }
    }

    function showDateDetail(iso) {
        var P = LP.Period;
        var data = P.load();
        var existing = data.records.find(function (r) { return iso >= r.startDate && iso <= (r.endDate || r.startDate); });
        var html = '<div class="date-detail-sheet" id="date-detail-sheet"><h4>' + formatDisplayDate(iso) + '</h4>';
        if (existing) {
            html += '<p>已有记录：经期 ' + formatDisplayDate(existing.startDate) + ' ~ ' + formatDisplayDate(existing.endDate || '') + ' (' + (existing.flow || '正常') + ')</p>';
            html += '<div class="dd-actions"><button class="btn-ghost dd-edit-btn" data-id="' + existing.id + '">编辑此条</button>';
            html += '<button class="btn-ghost btn-danger dd-del-btn" data-id="' + existing.id + '">删除</button></div>';
        } else {
            html += '<p>这天没有经期记录</p><div class="dd-actions">';
            html += '<button class="btn-primary dd-add-start" data-iso="' + iso + '">设为经期开始</button></div>';
        }
        html += '<button class="link-btn dd-close-btn">关闭</button></div>';
        var old = document.getElementById('date-detail-sheet');
        if (old) old.remove();
        var wrap = document.createElement('div');
        wrap.className = 'sheet-overlay';
        wrap.innerHTML = html;
        document.body.appendChild(wrap);
        requestAnimationFrame(function () { wrap.classList.add('is-open'); });
        wrap.addEventListener('click', function (e) {
            if (e.target.classList.contains('dd-close-btn') || e.target === wrap) { wrap.classList.remove('is-open'); setTimeout(function () { wrap.remove(); }, 200); }
            if (e.target.classList.contains('dd-add-start')) { P.addRecord({ startDate: e.target.dataset.iso, flow: '正常' }); toast('已添加 ✓'); wrap.remove(); renderPeriod(); }
            if (e.target.classList.contains('dd-edit-btn')) { wrap.remove(); showEditRecord(e.target.dataset.id); }
            if (e.target.classList.contains('dd-del-btn')) { if (confirm('确定删除？')) { P.delRecord(e.target.dataset.id); toast('已删除'); wrap.remove(); renderPeriod(); } }
        });
    }

    function showEditRecord(id) {
        var P = LP.Period;
        var rec = id ? P.load().records.find(function (r) { return r.id === id; }) : null;
        var isEdit = !!rec;
        var html = '<div class="sheet editor-sheet is-open" id="period-edit-sheet" aria-hidden="false"><div class="sheet-panel editor-panel"><div class="sheet-head">';
        html += '<h3>' + (isEdit ? '编辑经期记录' : '新增经期记录') + '</h3>';
        html += '<button class="icon-btn pe-close-btn" aria-label="关闭"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button>';
        html += '</div><div class="editor-body"><div class="ed-group">';
        html += '<label class="ed-row"><span class="ed-label">开始日期</span><input type="date" class="ed-input" id="pe-start" value="' + (rec ? rec.startDate : P._fmtISO(new Date())) + '"></label>';
        html += '<label class="ed-row"><span class="ed-label">结束日期</span><input type="date" class="ed-input" id="pe-end" value="' + (rec && rec.endDate ? rec.endDate : '') + '"><small class="ed-sub">不填表示还在经期内</small></label>';
        html += '<label class="ed-row"><span class="ed-label">流量</span><select class="ed-input" id="pe-flow">';
        P.FLOW_OPTIONS.forEach(function (f) { html += '<option value="' + f + '"' + (rec && rec.flow === f ? ' selected' : '') + '>' + f + '</option>'; });
        html += '</select></label>';
        html += '<div class="ed-row"><span class="ed-label">症状（多选）</span><div class="sym-checks">';
        P.SYMPTOM_OPTIONS.forEach(function (s) { var checked = (rec && rec.symptoms && rec.symptoms.indexOf(s) >= 0) ? ' checked' : ''; html += '<label class="sym-check"><input type="checkbox" value="' + s + '"' + checked + '> ' + s + '</label>'; });
        html += '</div></div>';
        html += '<label class="ed-row"><span class="ed-label">备注</span><textarea class="ed-input" id="pe-note" rows="2" placeholder="随便写点…">' + (rec ? esc(rec.note || '') : '') + '</textarea></label>';
        html += '</div></div><div class="editor-foot"><button class="btn-primary" id="pe-save-btn">' + (isEdit ? '保存修改' : '添加记录') + '</button></div></div></div>';
        var old = document.getElementById('period-edit-sheet');
        if (old) old.remove();
        var sheetWrap = document.createElement('div');
        sheetWrap.innerHTML = html;
        var sheet = sheetWrap.firstElementChild;
        document.body.appendChild(sheet);
        $('#pe-save-btn').addEventListener('click', function () {
            var payload = { startDate: $('#pe-start').value, endDate: $('#pe-end').value || undefined, flow: $('#pe-flow').value, symptoms: [], note: $('#pe-note').value.trim() };
            $$('.sym-checks input:checked').forEach(function (cb) { payload.symptoms.push(cb.value); });
            if (!payload.startDate) { toast('请填写开始日期'); return; }
            if (isEdit) { P.updateRecord(id, payload); toast('已更新 ✓'); } else { P.addRecord(payload); toast('已添加 ✓'); }
            sheet.remove(); renderPeriod();
        });
        $('.pe-close-btn').addEventListener('click', function () { sheet.remove(); });
    }

    function formatDisplayDate(iso) {
        if (!iso) return '-';
        var parts = iso.split('-');
        if (parts.length === 3) return parseInt(parts[1]) + '月' + parseInt(parts[2]) + '日';
        return iso;
    }

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
        var recent = (data.history || []).slice(0, 10);
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

    /* =========================================================
       模块 9 — 日程/待办/购物/日历（新增）
       ========================================================= */
    let schedCalYear, schedCalMonth;

    function renderSchedule() {
        if (!LP.Schedule) return;
        var S = LP.Schedule;

        // 📆 日历主视图（始终渲染）
        renderSchedCalendar(S);

        // 待办 & 购物面板（折叠区内）
        var todoItems = S.getPending('todo').concat(S.load().events.filter(function (e) { return e.type === 'todo' && e.done; }));
        var shopItems = S.getPending('shopping').concat(S.load().events.filter(function (e) { return e.type === 'shopping' && e.done; }));
        renderSchedPanel('todo', todoItems, S);
        renderSchedPanel('shopping', shopItems, S);

        // 更新折叠标题计数
        var todoCnt = $('#sched-todo-count');
        if (todoCnt) todoCnt.textContent = todoItems.length;
        var shopCnt = $('#sched-shop-count');
        if (shopCnt) shopCnt.textContent = shopItems.length;

        // 即将到来（提醒）
        renderSchedUpcoming(S);

        // 绑定事件
        bindSchedEvents();
    }

    function renderSchedPanel(type, items, S) {
        var panel = $('#sched-panel-' + type);
        if (!panel) return;
        var typeInfo = S.TYPES[type] || S.TYPES.todo;

        if (items.length === 0) {
            panel.innerHTML = '<p class="sched-empty">还没有' + typeInfo.label + '，在上方添加吧</p>';
            return;
        }

        panel.innerHTML = '<ul class="sched-list">' + items.map(function (item) {
            var cls = 'sched-item' + (item.done ? ' is-done' : '');
            var whoTag = item.who === 'a' ? '<span class="sched-who who-a">🐸</span>'
                : item.who === 'b' ? '<span class="sched-who who-b">🐕</span>' : '';
            var dateTag = item.date ? '<small class="sched-date">' + item.date + '</small>' : '';
            var repBadge = item.repeat === 'yearly' ? '<span class="sched-repeat" title="每年重复">🔁</span>' : '';
            return '<li class="' + cls + '" data-id="' + item.id + '">' +
                '<label class="sched-check"><input type="checkbox"' + (item.done ? ' checked' : '') + ' data-id="' + item.id + '"><span></span></label>' +
                '<span class="sched-title">' + esc(item.title) + '</span>' +
                whoTag + dateTag + repBadge +
                '<button class="link-btn sched-del" data-id="' + item.id + '">✕</button>' +
            '</li>';
        }).join('') + '</ul>';

        // 勾选完成
        $$('input[type="checkbox"]', panel).forEach(function (cb) {
            cb.addEventListener('change', function () {
                S.toggleDone(this.dataset.id);
                toast(this.checked ? '已完成 ✓' : '已恢复');
                renderSchedule();
            });
        });
        // 删除
        $$('.sched-del', panel).forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                S.delItem(this.dataset.id);
                toast('已删除');
                renderSchedule();
            });
        });
    }

    // 日历选中日期（ISO 字符串，如 '2026-08-14'）
    var schedSelectedDate = null;

    function renderSchedCalendar(S) {
        S = S || LP.Schedule;
        if (!S) return;

        var calGrid = $('#sched-calendar');
        var monthEl = $('#sc-month');
        if (!calGrid) return;

        var now = new Date();
        if (schedCalYear == null) { schedCalYear = now.getFullYear(); schedCalMonth = now.getMonth(); }
        var eventMap = S.getEventsByDateMap();

        // 把「每年重复」事件展开到当前展示月份
        var monthStart = new Date(schedCalYear, schedCalMonth, 1);
        var monthEnd = new Date(schedCalYear, schedCalMonth + 1, 0);
        S.load().events.forEach(function (e) {
            if (e.repeat !== 'yearly' || !e.date) return;
            S.occurrenceDates(e, monthStart, monthEnd).forEach(function (iso) {
                if (!eventMap[iso]) eventMap[iso] = [];
                eventMap[iso].push(Object.assign({}, e, { _yearly: true }));
            });
        });

        // 合并经期数据（背景色）
        var periodData = LP.Period ? LP.Period.load() : null;
        if (periodData) {
            periodData.records.forEach(function (r) {
                var s = LP.Period._parseISO(r.startDate), e = LP.Period._parseISO(r.endDate || r.startDate);
                if (s && e) { var c = new Date(s); while (c <= e) { var k = LP.Period._fmtISO(c); if (!eventMap[k]) eventMap[k] = [{ _period: true, flow: r.flow }]; c.setDate(c.getDate() + 1); } }
            });
        }

        // 月份标题
        if (monthEl) monthEl.textContent = schedCalYear + '年' + (schedCalMonth + 1) + '月';

        // 星期头
        var dowEl = $('#sc-dow');
        if (dowEl) {
            dowEl.innerHTML = ['日','一','二','三','四','五','六'].map(function (d) { return '<span>' + d + '</span>'; }).join('');
        }

        // 生成日历格子
        var firstDay = new Date(schedCalYear, schedCalMonth, 1);
        var lastDay = new Date(schedCalYear, schedCalMonth + 1, 0);
        var startDow = firstDay.getDay();
        var daysInMonth = lastDay.getDate();
        var today = new Date(); today.setHours(0,0,0,0);
        var todayISO = S._fmtISO(today);

        var weeks = [], week = [];
        for (var i = 0; i < startDow; i++) week.push('<span class="cal-day cal-empty"></span>');
        for (var d = 1; d <= daysInMonth; d++) {
            var iso = schedCalYear + '-' + String(schedCalMonth+1).padStart(2,'0') + '-' + String(d).padStart(2,'0');
            var evts = eventMap[iso] || [];
            var hasPeriod = evts.some(function (e) { return e._period; });
            var nonPeriodEvts = evts.filter(function (e) { return !e._period; });
            var evtCount = nonPeriodEvts.length;
            var isToday = iso === todayISO;
            var isSelected = iso === schedSelectedDate;

            var cls = 'cal-day';
            if (isToday) cls += ' is-today';
            if (isSelected) cls += ' is-selected';
            if (hasPeriod) cls += ' is-period';
            if (evtCount > 0) cls += ' has-event';

            // 事件数量标记（最多3个圆点 + 超出数字）
            var dotsHtml = '';
            if (evtCount > 0) {
                var dotN = Math.min(evtCount, 3);
                for (var di = 0; di < dotN; di++) dotsHtml += '<i class="dot-dot"></i>';
                if (evtCount > 3) dotsHtml += '<span class="dot-more">' + evtCount + '</span>';
            }

            week.push('<button class="' + cls + '" data-iso="' + iso + '" type="button">' +
                '<span class="cal-num">' + d + '</span>' +
                '<span class="cal-dots">' + dotsHtml + '</span>' +
            '</button>');
            if (week.length === 7) { weeks.push('<div class="cal-week">' + week.join('') + '</div>'); week = []; }
        }
        if (week.length > 0) { while (week.length < 7) week.push('<span class="cal-day cal-empty"></span>'); weeks.push('<div class="cal-week">' + week.join('') + '</div>'); }

        calGrid.innerHTML = weeks.join('');

        // 导航按钮绑定
        var prevBtn = $('#sc-prev'), nextBtn = $('#sc-next'), todayBtn = $('#sc-today');
        if (prevBtn) prevBtn.onclick = function () { schedCalMonth--; if (schedCalMonth<0){schedCalMonth=11;schedCalYear--;} renderSchedule(); };
        if (nextBtn) nextBtn.onclick = function () { schedCalMonth++; if (schedCalMonth>11){schedCalMonth=0;schedCalYear++;} renderSchedule(); };
        if (todayBtn) todayBtn.onclick = function () { var n=new Date(); schedCalYear=n.getFullYear(); schedCalMonth=n.getMonth(); schedSelectedDate=S._fmtISO(new Date()); renderSchedule(); };

        // 点击日期 → 选中 + 显示事件 + 填入日期输入框
        $$('.cal-day:not(.cal-empty)', calGrid).forEach(function (btn) {
            btn.addEventListener('click', function () {
                var iso = this.dataset.iso;
                schedSelectedDate = iso;

                // 高亮选中日期
                $$('.cal-day.is-selected', calGrid).forEach(function (b) { b.classList.remove('is-selected'); });
                this.classList.add('is-selected');

                // 填入日期输入框
                var dateInput = $('#sched-date-input');
                if (dateInput) dateInput.value = iso;

                // 显示当日事件
                showDayEvents(iso, eventMap);
            });
        });

        // 渲染当日事件面板
        if (schedSelectedDate) {
            showDayEvents(schedSelectedDate, eventMap);
        } else {
            var dayEvts = $('#sc-day-events');
            if (dayEvts) dayEvts.innerHTML = '<p class="sched-empty">点击日期查看 / 添加事件</p>';
        }
    }

    function renderSchedUpcoming(S) {
        var el = $('#sched-upcoming');
        if (!el) return;
        var list = S.getUpcoming(60).filter(function (u) { return !(u.item.done && !u.isYearly); });
        if (list.length === 0) { el.style.display = 'none'; el.innerHTML = ''; return; }
        el.style.display = '';
        el.innerHTML = '<div class="upc-title">🔔 即将到来</div><ul class="upc-list">' + list.slice(0, 5).map(function (u) {
            var info = S.TYPES[u.item.type] || S.TYPES.todo;
            var leftTxt = u.daysLeft === 0 ? '今天' : (u.daysLeft === 1 ? '明天' : (u.daysLeft + ' 天后'));
            var yearly = u.isYearly ? ' <span class="upc-yearly">每年</span>' : '';
            var whoTag = u.item.who === 'a' ? '🐸' : u.item.who === 'b' ? '🐕' : '';
            return '<li class="upc-item" data-iso="' + u.dateISO + '">' +
                '<span class="upc-icon">' + info.icon + '</span>' +
                '<span class="upc-name">' + esc(u.item.title) + yearly + '</span>' +
                (whoTag ? '<span class="upc-who">' + whoTag + '</span>' : '') +
                '<span class="upc-left">' + leftTxt + '</span>' +
            '</li>';
        }).join('') + '</ul>';
        $$('.upc-item', el).forEach(function (li) {
            li.addEventListener('click', function () {
                var d = S._parseISO(this.dataset.iso);
                if (!d) return;
                schedCalYear = d.getFullYear(); schedCalMonth = d.getMonth();
                schedSelectedDate = this.dataset.iso;
                renderSchedule();
                // 滚动到日历
                var calWrap = $('#sched-cal-wrap');
                if (calWrap) calWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        });
    }

    function showDayEvents(iso, eventMap) {
        var el = $('#sc-day-events');
        if (!el) return;
        var evts = (eventMap[iso] || []).filter(function (e) { return !e._period; });

        if (evts.length === 0) {
            el.innerHTML = '<p class="sched-empty">' + iso + ' 没有安排</p>' +
                '<button class="btn-ghost sc-add-day" data-iso="' + iso + '">为这天添加</button>';
            $('.sc-add-day', el).addEventListener('click', function () {
                $('#sched-input').value = '';
                $('#sched-type').value = 'todo';
                var di = $('#sched-date-input'); if (di) di.value = this.dataset.iso;
                $('#sched-input').focus();
            });
            return;
        }

        el.innerHTML = '<h4 class="sc-de-title">' + iso + '</h4>' +
            '<ul class="sched-list">' + evts.map(function (item) {
                var doneCls = item.done ? ' is-done' : '';
                var repBadge = item.repeat === 'yearly' ? '<span class="sched-repeat" title="每年重复">🔁</span>' : '';
                return '<li class="sched-item' + doneCls + '" data-id="' + item.id + '">' +
                    '<span class="sched-title">' + esc(item.title) + '</span>' +
                    (item.time ? '<small class="sched-time">' + item.time + '</small>' : '') + repBadge +
                    '<button class="link-btn sched-del" data-id="' + item.id + '">✕</button>' +
                '</li>';
            }).join('') + '</ul>';

        $$('.sched-del', el).forEach(function (btn) {
            btn.addEventListener('click', function () {
                LP.Schedule.delItem(this.dataset.id);
                renderSchedule();
            });
        });
    }

    function bindSchedEvents() {
        var input = $('#sched-input');
        var addBtn = $('#sched-add-btn');
        var typeSel = $('#sched-type');

        if (addBtn && !addBtn._bound) {
            addBtn._bound = true;
            addBtn.addEventListener('click', function () {
                var title = (input.value || '').trim();
                if (!title) { toast('写点什么吧'); input.focus(); return; }
                var dateInput = $('#sched-date-input');
                var repeatSel = $('#sched-repeat');
                var dateVal = (dateInput && dateInput.value) ? dateInput.value
                    : (input.dataset.prefillDate || LP.Schedule._fmtISO(new Date()));
                var item = {
                    type: typeSel.value,
                    title: title,
                    date: dateVal,
                    repeat: repeatSel ? repeatSel.value : ''
                };
                LP.Schedule.addItem(item);
                input.value = '';
                if (dateInput) dateInput.value = '';
                delete input.dataset.prefillDate;
                toast('已添加 ✓');
                renderSchedule();
            });

            // 回车添加
            input.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') { e.preventDefault(); addBtn.click(); }
            });
        }
    }

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
                        return '<div class="sb-rec"><span>' + from + ' → ' + toName + '</span>' +
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

    /* =========================================================
       模块 11 — 学术/资料库（新增）
       ========================================================= */
    let currentResCat = ''; // '' = all
    let currentResTag = '';

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

        // 搜索 & 新增事件
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

        if (items.length === 0) {
            list.innerHTML = '<p class="sched-empty">' + (currentResCat || currentResTag ? '没有匹配的资料' : '资料库还是空的，点击「+ 新增」添加第一条') + '</p>';
            return;
        }

        var catMap = {};
        R.CATEGORIES.forEach(function (c) { catMap[c.id] = c; });

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
                var noteHtml = p.note ? '<p class="fp-note">' + esc(p.note) + '</p>' : '';
                var provAttr = p.province ? ' data-prov="' + esc(p.province) + '"' : '';
                return '<div class="fp-card' + (p.province ? ' fp-card-link' : '') + '" data-id="' + p.id + '"' + provAttr + ' style="--fp-delay:' + (idx * 30) + 'ms">' +
                    '<div class="fp-rank">#' + (idx + 1) + '</div>' +
                    '<div class="fp-body">' +
                        '<h4 class="fp-name">📍 ' + esc(p.name) + '</h4>' +
                        '<div class="fp-meta">' +
                            '<span class="fp-date">📅 ' + (p.date || '') + '</span>' +
                            provTag + whoTag +
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
                var provSel = $('#fp-province-input');
                var whoSel = $('#fp-who-input');
                var noteInput = $('#fp-note-input');
                var name = (nameInput.value || '').trim();
                if (!name) { toast('写个地名吧'); nameInput.focus(); return; }
                FP.addPlace({
                    name: name,
                    date: dateInput.value || '',
                    province: provSel ? provSel.value : '',
                    who: whoSel ? whoSel.value : '',
                    note: noteInput ? noteInput.value.trim() : ''
                });
                nameInput.value = '';
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

    /* =========================================================
       模块 13 — 虚拟房间 + Avatar + 宠物 + 互动（新增）
       ========================================================= */
    /* 阿蛙 / 阿狗 的可爱 SVG 形象（替代纯 emoji 漂浮） */
    var FROG_SVG =
        '<svg class="char-svg" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">' +
        '<ellipse cx="32" cy="44" rx="21" ry="17" fill="#7CC576"/>' +
        '<ellipse cx="32" cy="48" rx="12" ry="10" fill="#CDEBA0"/>' +
        '<circle cx="22" cy="22" r="9" fill="#7CC576"/>' +
        '<circle cx="42" cy="22" r="9" fill="#7CC576"/>' +
        '<circle cx="22" cy="22" r="5.4" fill="#fff"/>' +
        '<circle cx="42" cy="22" r="5.4" fill="#fff"/>' +
        '<circle cx="23" cy="23" r="2.6" fill="#2c2c2c"/>' +
        '<circle cx="41" cy="23" r="2.6" fill="#2c2c2c"/>' +
        '<path d="M22 41 Q32 49 42 41" stroke="#3c6b35" stroke-width="2.4" fill="none" stroke-linecap="round"/>' +
        '<circle cx="15" cy="35" r="3" fill="#F7A8B8" opacity=".55"/>' +
        '<circle cx="49" cy="35" r="3" fill="#F7A8B8" opacity=".55"/>' +
        '</svg>';
    var DOG_SVG =
        '<svg class="char-svg" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">' +
        '<ellipse cx="19" cy="18" rx="6" ry="12" fill="#C99A6A" transform="rotate(-18 19 18)"/>' +
        '<ellipse cx="45" cy="18" rx="6" ry="12" fill="#C99A6A" transform="rotate(18 45 18)"/>' +
        '<circle cx="32" cy="36" r="18" fill="#E2B98A"/>' +
        '<ellipse cx="32" cy="44" rx="12" ry="9" fill="#F5E6CB"/>' +
        '<circle cx="25" cy="34" r="2.6" fill="#3a2a1a"/>' +
        '<circle cx="39" cy="34" r="2.6" fill="#3a2a1a"/>' +
        '<ellipse cx="32" cy="41" rx="3.2" ry="2.4" fill="#3a2a1a"/>' +
        '<path d="M32 43 v4 M32 47 q-4 1 -6 -1 M32 47 q4 1 6 -1" stroke="#3a2a1a" stroke-width="1.6" fill="none" stroke-linecap="round"/>' +
        '<circle cx="20" cy="41" r="3" fill="#F7A8B8" opacity=".5"/>' +
        '<circle cx="44" cy="41" r="3" fill="#F7A8B8" opacity=".5"/>' +
        '</svg>';
    function avatarSVG(who) { return who === 'a' ? FROG_SVG : DOG_SVG; }

    function renderRoom() {
        if (!LP.Room) return;
        var R = LP.Room;
        var data = R.load();

        // 应用墙壁颜色
        var canvas = $('#room-canvas');
        if (canvas) {
            var wallCfg = R.WALL_COLORS.find(function (w) { return w.id === data.wallColor; }) || R.WALL_COLORS[0];
            canvas.style.background = wallCfg.bg;
            // 夜间模式文字变亮
            if (data.wallColor === 'night') canvas.classList.add('is-dark');
            else canvas.classList.remove('is-dark');
        }

        // 渲染家具
        renderFurniture(data, R);

        // 渲染宠物
        renderPets(data, R);

        // 定位 Avatar
        positionAvatar('a', data.avatarA);
        positionAvatar('b', data.avatarB);

        // 装扮控制面板
        renderRoomPanel(data, R);

        // 绑定互动事件
        bindRoomEvents(data, R);
    }

    function renderFurniture(data, R) {
        var container = $('#room-furniture');
        if (!container) return;
        var positions = {
            plant: { bottom: '5%', left: '5%', fontSize: '2rem' },
            lamp: { top: '8%', right: '10%', fontSize: '1.6rem' },
            bookshelf: { bottom: '12%', right: '6%', fontSize: '1.8rem' },
            cushion: { bottom: '18%', left: '50%', transform: 'translateX(-50%)', fontSize: '1.4rem' },
            photo: { top: '15%', left: '50%', transform: 'translateX(-50%)', fontSize: '1.5rem' },
            rug: { bottom: '2%', left: '50%', transform: 'translateX(-50%)', fontSize: '2.2rem' },
            window: { top: '10%', left: '8%', fontSize: '2rem' },
            clock: { top: '12%', right: '25%', fontSize: '1.3rem' }
        };

        container.innerHTML = data.furniture.map(function (fid) {
            var furn = R.FURNITURE.find(function (f) { return f.id === fid; });
            if (!furn) return '';
            var pos = positions[fid] || { bottom: '10%', left: '10%', fontSize: '1.5rem' };
            var styleStr = Object.keys(pos).map(function (k) { return k + ':' + pos[k]; }).join(';');
            return '<span class="room-furn-item" style="' + styleStr + '" title="' + furn.label + '">' + furn.icon + '</span>';
        }).join('');
    }

    function renderPets(data, R) {
        var container = $('#room-pets');
        if (!container) return;
        var spots = [
            { x: 15, y: 72 }, { x: 75, y: 70 }, { x: 45, y: 78 }, { x: 60, y: 75 }
        ];

        container.innerHTML = data.pets.map(function (pid, idx) {
            var pet = R.PETS.find(function (p) { return p.id === pid; });
            if (!pet) return '';
            var spot = spots[idx] || spots[0];
            return '<span class="room-pet" style="left:' + spot.x + '%;top:' + spot.y + '%" title="' + pet.label + '">' +
                '<span class="pet-emoji">' + pet.emoji + '</span>' +
                '<span class="pet-name">' + pet.label + '</span>' +
            '</span>';
        }).join('');
    }

    function positionAvatar(who, avatarData) {
        var el = $('#room-avatar-' + who);
        if (!el) return;
        el.style.left = avatarData.x + '%';
        el.style.top = avatarData.y + '%';

        // 姿态
        el.className = 'room-avatar room-avatar-' + who + ' pose-' + (avatarData.pose || 'idle');

        // 注入可爱 SVG 形象
        var body = el.querySelector('.avatar-body');
        if (body) body.innerHTML = avatarSVG(who);
    }

    function renderRoomPanel(data, R) {
        // 墙壁颜色
        var wcEl = $('#wall-colors');
        if (wcEl) {
            wcEl.innerHTML = R.WALL_COLORS.map(function (w) {
                var active = w.id === data.wallColor ? ' is-active' : '';
                return '<button type="button" class="wall-opt' + active + '" data-wall="' + w.id + '" style="background:' + w.bg + '" title="' + w.label + '"></button>';
            }).join('');
            $$('.wall-opt', wcEl).forEach(function (btn) {
                btn.addEventListener('click', function () {
                    R.setWallColor(this.dataset.wall);
                    renderRoom();
                });
            });
        }

        // 家具
        var furnEl = $('#furn-list');
        if (furnEl) {
            furnEl.innerHTML = R.FURNITURE.map(function (f) {
                var has = data.furniture.indexOf(f.id) >= 0;
                return '<button type="button" class="furn-opt' + (has ? ' is-active' : '') + '" data-furn="' + f.id + '">' +
                    f.icon + ' ' + f.label + (has ? ' ✓' : '') + '</button>';
            }).join('');
            $$('.furn-opt', furnEl).forEach(function (btn) {
                btn.addEventListener('click', function () {
                    R.toggleFurniture(this.dataset.furn);
                    renderRoom();
                });
            });
        }

        // 宠物
        var petEl = $('#pet-list');
        if (petEl) {
            petEl.innerHTML = R.PETS.map(function (p) {
                var has = data.pets.indexOf(p.id) >= 0;
                return '<button type="button" class="pet-opt' + (has ? ' is-active' : '') + '" data-pet="' + p.id + '">' +
                    p.emoji + ' ' + p.label + (has ? ' ✓' : '') + '</button>';
            }).join('');
            $$('.pet-opt', petEl).forEach(function (btn) {
                btn.addEventListener('click', function () {
                    R.togglePet(this.dataset.pet);
                    renderRoom();
                });
            });
        }
    }

    function bindRoomEvents(data, R) {
        // 打球动画
        var playBallBtn = $('#ra-play-ball');
        if (playBallBtn && !playBallBtn._bound) {
            playBallBtn._bound = true;
            playBallBtn.addEventListener('click', function () { triggerInteraction('ball'); });
        }

        // 跳舞动画
        var danceBtn = $('#ra-dance');
        if (danceBtn && !danceBtn._bound) {
            danceBtn._bound = true;
            danceBtn.addEventListener('click', function () { triggerInteraction('dance'); });
        }

        // 挥手
        var waveBtn = $('#ra-wave');
        if (waveBtn && !waveBtn._bound) {
            waveBtn._bound = true;
            waveBtn.addEventListener('click', function () { triggerInteraction('wave'); });
        }

        // 抱抱
        var hugBtn = $('#ra-hug');
        if (hugBtn && !hugBtn._bound) {
            hugBtn._bound = true;
            hugBtn.addEventListener('click', function () { triggerInteraction('hug'); });
        }

        // Avatar 真实拖拽移动
        $$('.room-avatar').forEach(function (av) {
            if (av._dragBound) return;
            av._dragBound = true;
            var who = av.id.replace('room-avatar-', '');
            var canvas = $('#room-canvas');
            var dragging = false, offX = 0, offY = 0;

            av.addEventListener('pointerdown', function (e) {
                dragging = true;
                av.classList.add('dragging');
                try { av.setPointerCapture(e.pointerId); } catch (_) {}
                var rect = canvas.getBoundingClientRect();
                offX = e.clientX - rect.left - av.offsetLeft;
                offY = e.clientY - rect.top - av.offsetTop;
                e.preventDefault();
            });
            av.addEventListener('pointermove', function (e) {
                if (!dragging) return;
                var rect = canvas.getBoundingClientRect();
                var px = ((e.clientX - rect.left - offX) / rect.width) * 100;
                var py = ((e.clientY - rect.top - offY) / rect.height) * 100;
                px = Math.max(6, Math.min(88, px));
                py = Math.max(28, Math.min(82, py));
                R.moveAvatar(who, Math.round(px), Math.round(py));
                av.style.left = px + '%';
                av.style.top = py + '%';
            });
            function endDrag(e) {
                if (!dragging) return;
                dragging = false;
                av.classList.remove('dragging');
                try { av.releasePointerCapture(e.pointerId); } catch (_) {}
                positionAvatar(who, R.load()[who === 'a' ? 'avatarA' : 'avatarB']);
            }
            av.addEventListener('pointerup', endDrag);
            av.addEventListener('pointercancel', endDrag);
        });
    }

    /** 触发互动特效 */
    function triggerInteraction(type) {
        var effectsEl = $('#room-effects');
        if (!effectsEl) return;

        var avA = $('#room-avatar-a');
        var avB = $('#room-avatar-b');

        switch (type) {
            case 'ball':
                effectsEl.innerHTML = '<div class="effect-ball">🎾</div>';
                avA.classList.add('pose-jump'); avB.classList.add('pose-jump');
                setTimeout(function () { avA.classList.remove('pose-jump'); avB.classList.remove('pose-jump'); effectsEl.innerHTML = ''; }, 1500);
                toast('🎾 阿蛙和阿狗在打球！');
                break;

            case 'dance':
                effectsEl.innerHTML = '<div class="effect-music">🎵💃🕺</div>';
                avA.classList.add('pose-dance'); avB.classList.add('pose-dance');
                setTimeout(function () { avA.classList.remove('pose-dance'); avB.classList.remove('pose-dance'); effectsEl.innerHTML = ''; }, 3000);
                toast('💃 阿蛙和阿狗在跳舞！');
                break;

            case 'wave':
                avB.classList.add('pose-wave');
                setTimeout(function () { avB.classList.remove('pose-wave'); }, 1200);
                toast('👋 阿狗在挥手！');
                break;

            case 'hug':
                // 两个 Avatar 靠近
                var data = LP.Room.load();
                LP.Room.moveAvatar('a', 42, 58);
                LP.Room.moveAvatar('b', 54, 58);
                positionAvatar('a', LP.Room.load().avatarA);
                positionAvatar('b', LP.Room.load().avatarB);
                effectsEl.innerHTML = '<div class="effect-heart">❤️</div>';
                setTimeout(function () { effectsEl.innerHTML = ''; }, 2000);
                toast('🤗 抱抱！阿蛙和阿狗靠在一起了～');
                break;
        }
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
        renderWall().then(refreshStorageInfo);
        renderPeriod();
        renderMood();
        renderSchedule();
        renderRating();
        renderResources();
        renderFootprint();
        renderRoom();
    }

    // 挂到 LP 上供 core.js 调用
    LP.renderAll = renderAll;
    LP.renderTimeline = renderTimeline;
    LP.renderMessages = renderMessages;
    LP.getMessages = getMessages;

})(window.LP);
