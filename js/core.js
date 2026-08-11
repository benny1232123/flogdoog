/* =========================================================
   core.js — 内核层
   配置加载 / 锁屏 / 主题 / 设置 / 导航 / 计时器 / 特效
   基础：MoLeft/LoveDiary-Timeline (MIT)
   改动：原项目为单文件 860 行的 DOMContentLoaded 闭包；
        此处重构为 LP 命名空间 + 模块注册，便于扩展新板块。
   ========================================================= */

window.LP = (function () {
    'use strict';

    /* ---------------- 常量 ---------------- */
    const LS = {
        settings: 'lp.settings',
        unlockAt: 'lp.unlockAt',
        messages: 'lp.messages',
        likes: 'lp.likes',
        speaker: 'lp.speaker'
    };

    const DEFAULTS = {
        dark: false,
        system: false,
        reverseTimeline: false,
        petals: true,
        expiryMinutes: 120
    };

    /* ---------------- 工具 ---------------- */
    const $ = (s, r) => (r || document).querySelector(s);
    const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

    const store = {
        get(key, fallback) {
            try {
                const raw = localStorage.getItem(key);
                return raw === null ? fallback : JSON.parse(raw);
            } catch (e) { return fallback; }
        },
        set(key, val) {
            try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* 隐私模式静默 */ }
        },
        del(key) { try { localStorage.removeItem(key); } catch (e) {} }
    };

    // XSS 防护：所有用户输入均经此转义（原项目使用 innerHTML 直出，此处加固）
    const esc = (s) => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const pad = (n) => String(n).padStart(2, '0');

    // 解析 YYYY-MM-DD [HH:mm:ss] 为本地时间，避免时区偏移
    function parseDate(dateStr, timeStr) {
        const d = String(dateStr || '').split('-').map(Number);
        const t = String(timeStr || '00:00:00').split(':').map(Number);
        return new Date(d[0], (d[1] || 1) - 1, d[2] || 1, t[0] || 0, t[1] || 0, t[2] || 0);
    }

    const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const dayDiff = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / 86400000);

    const fmtDate = (d) => `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;

    function fmtRelTime(iso) {
        const d = new Date(iso);
        if (isNaN(d)) return '';
        const mins = Math.floor((Date.now() - d.getTime()) / 60000);
        if (mins < 1) return '刚刚';
        if (mins < 60) return `${mins} 分钟前`;
        if (mins < 1440) return `${Math.floor(mins / 60)} 小时前`;
        if (mins < 10080) return `${Math.floor(mins / 1440)} 天前`;
        return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
    }

    /* ---------------- 状态 ---------------- */
    const state = {
        config: null,
        settings: Object.assign({}, DEFAULTS, store.get(LS.settings, {})),
        timerId: null
    };

    /* ---------------- Toast ---------------- */
    let toastTimer = null;
    function toast(text) {
        const el = $('#toast');
        if (!el) return;
        el.textContent = text;
        el.classList.add('is-show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => el.classList.remove('is-show'), 2000);
    }

    /* ---------------- 主题 ---------------- */
    const mq = window.matchMedia('(prefers-color-scheme: dark)');

    function applyTheme() {
        const dark = state.settings.system ? mq.matches : state.settings.dark;
        document.body.setAttribute('data-theme', dark ? 'dark' : 'light');
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', dark ? '#1C1719' : '#FFF7F3');
    }

    mq.addEventListener('change', () => { if (state.settings.system) applyTheme(); });

    function saveSettings() {
        store.set(LS.settings, state.settings);
    }

    /* ---------------- 飘落花瓣 ---------------- */
    const PETAL_SVG = {
        petal: '<svg viewBox="0 0 20 20"><path d="M10 1c4 4 6 8 6 11a6 6 0 11-12 0c0-3 2-7 6-11z" fill="currentColor"/></svg>',
        heart: '<svg viewBox="0 0 32 29"><path d="M16 28S1 18.5 1 9.8A8.8 8.8 0 0 1 16 4.4 8.8 8.8 0 0 1 31 9.8C31 18.5 16 28 16 28z" fill="currentColor"/></svg>'
    };

    function buildPetals() {
        const box = $('#petals');
        if (!box) return;
        box.innerHTML = '';
        if (!state.settings.petals) { box.hidden = true; return; }
        box.hidden = false;

        const count = window.innerWidth < 720 ? 9 : 16;
        for (let i = 0; i < count; i++) {
            const el = document.createElement('span');
            el.className = 'petal';
            el.innerHTML = i % 4 === 0 ? PETAL_SVG.heart : PETAL_SVG.petal;
            const size = 8 + Math.random() * 12;
            el.style.cssText = [
                `left:${Math.random() * 100}%`,
                `width:${size}px`,
                `height:${size}px`,
                `animation-duration:${11 + Math.random() * 14}s`,
                `animation-delay:-${Math.random() * 20}s`,
                `opacity:${0.35 + Math.random() * 0.4}`
            ].join(';');
            box.appendChild(el);
        }
    }

    /* ---------------- 滚动入场（IntersectionObserver） ---------------- */
    let io = null;
    function observeReveal(nodes) {
        if (!('IntersectionObserver' in window)) {
            nodes.forEach((n) => n.classList.add('is-in'));
            return;
        }
        if (!io) {
            io = new IntersectionObserver((entries) => {
                entries.forEach((en) => {
                    if (en.isIntersecting) {
                        en.target.classList.add('is-in');
                        io.unobserve(en.target);
                    }
                });
            }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
        }
        nodes.forEach((n, i) => {
            if (n.dataset.revealBound) return;   // 去重：避免同一元素被两次注册后延迟被覆盖
            n.dataset.revealBound = '1';
            n.style.transitionDelay = `${Math.min(i, 6) * 70}ms`;
            io.observe(n);
        });
    }

    /* ---------------- 图片懒加载（沿用原项目思路，改为 data-src + 淡入） ---------------- */
    let imgIO = null;
    function lazyImages(scope) {
        const imgs = $$('img[data-src]', scope || document);
        const load = (img) => {
            img.src = img.dataset.src;
            img.removeAttribute('data-src');
            if (img.complete) img.classList.add('is-loaded');
            else img.addEventListener('load', () => img.classList.add('is-loaded'), { once: true });
            img.addEventListener('error', () => img.classList.add('is-loaded'), { once: true });
        };
        if (!('IntersectionObserver' in window)) { imgs.forEach(load); return; }
        if (!imgIO) {
            imgIO = new IntersectionObserver((entries) => {
                entries.forEach((en) => {
                    if (en.isIntersecting) { load(en.target); imgIO.unobserve(en.target); }
                });
            }, { rootMargin: '240px' });
        }
        imgs.forEach((i) => imgIO.observe(i));
    }

    /* ---------------- 恋爱计时器 ---------------- */
    function startCounter() {
        const c = state.config.couple;
        const start = parseDate(c.startDate, c.startTime);
        const daysEl = $('#counter-days');
        const fineEl = $('#counter-fine');
        const textEl = $('#counter-text');
        const sinceEl = $('#counter-since');

        if (sinceEl) sinceEl.textContent = `自 ${fmtDate(start)} 起`;

        let printed = -1;

        function tick() {
            const now = new Date();
            const future = start > now;
            if (textEl) textEl.textContent = future ? (c.counterTextBefore || '距离在一起还有') : (c.counterTextAfter || '我们已经相爱');

            const days = Math.abs(dayDiff(start, now));
            if (days !== printed) {
                if (daysEl) daysEl.textContent = days.toLocaleString('zh-CN');
                printed = days;
            }

            // 年 / 月 / 日 / 时 / 分 / 秒 分解（自然日历口径）
            let a = future ? now : start;
            let b = future ? start : now;

            let y = b.getFullYear() - a.getFullYear();
            let mo = b.getMonth() - a.getMonth();
            let d = b.getDate() - a.getDate();
            let h = b.getHours() - a.getHours();
            let mi = b.getMinutes() - a.getMinutes();
            let s = b.getSeconds() - a.getSeconds();

            if (s < 0) { s += 60; mi--; }
            if (mi < 0) { mi += 60; h--; }
            if (h < 0) { h += 24; d--; }
            if (d < 0) { mo--; d += new Date(b.getFullYear(), b.getMonth(), 0).getDate(); }
            if (mo < 0) { mo += 12; y--; }

            if (fineEl) {
                const vals = [y, mo, d, h, mi, s];
                const bs = fineEl.querySelectorAll('b');
                for (let i = 0; i < bs.length && i < 6; i++) bs[i].textContent = pad(vals[i]);
            }
        }

        tick();
        clearInterval(state.timerId);
        state.timerId = setInterval(tick, 1000);
    }

    /* ---------------- 导航高亮 + 平滑滚动 ---------------- */
    function initNav() {
        const links = $$('.nav-link, .tab');
        const sections = $$('main .section');

        links.forEach((a) => {
            a.addEventListener('click', (e) => {
                const id = a.dataset.target;
                const target = document.getElementById(id);
                if (!target) return;
                e.preventDefault();
                const top = target.getBoundingClientRect().top + window.scrollY -
                    (window.innerWidth <= 720 ? 58 : 70);
                window.scrollTo({ top, behavior: 'smooth' });
                if (history.replaceState) history.replaceState(null, '', '#' + id);
            });
        });

        const setActive = (id) => {
            links.forEach((a) => a.classList.toggle('is-active', a.dataset.target === id));
        };

        if ('IntersectionObserver' in window && sections.length) {
            const secIO = new IntersectionObserver((entries) => {
                const visible = entries
                    .filter((e) => e.isIntersecting)
                    .sort((x, y) => y.intersectionRatio - x.intersectionRatio)[0];
                if (visible) setActive(visible.target.id);
            }, { threshold: [0.18, 0.5], rootMargin: '-15% 0px -45% 0px' });
            sections.forEach((s) => secIO.observe(s));
        }

        const topbar = $('#topbar');
        let last = 0;
        window.addEventListener('scroll', () => {
            const y = window.scrollY;
            if ((y > 20) !== (last > 20)) topbar.classList.toggle('is-stuck', y > 20);
            last = y;
        }, { passive: true });
    }

    /* ---------------- 锁屏 ---------------- */
    function initLock(onUnlock) {
        const screen = $('#lock-screen');
        const dotsBox = $('#lock-dots');
        const dots = $$('.dot', dotsBox);
        const hint = $('#lock-hint');
        const site = state.config.site;
        let buf = '';

        function unlock(silent) {
            store.set(LS.unlockAt, Date.now());
            document.body.classList.remove('is-locked');
            screen.classList.add('is-open');
            setTimeout(() => { screen.style.display = 'none'; }, silent ? 0 : 620);
            onUnlock();
        }

        // 密码关闭 或 仍在有效期内 → 直接进入
        const expiry = (state.settings.expiryMinutes || DEFAULTS.expiryMinutes) * 60000;
        const unlockAt = store.get(LS.unlockAt, 0);
        if (!site.passwordEnabled || (unlockAt && Date.now() - unlockAt < expiry)) {
            unlock(true);
            return;
        }

        document.body.classList.add('is-locked');

        function paint() {
            dots.forEach((d, i) => d.classList.toggle('filled', i < buf.length));
        }

        function verify() {
            if (buf === String(site.password)) {
                hint.textContent = '欢迎回来 ♡';
                hint.classList.remove('is-error');
                setTimeout(() => unlock(false), 320);
            } else {
                dotsBox.classList.add('is-shake');
                hint.textContent = '不对哦，再想想';
                hint.classList.add('is-error');
                if (navigator.vibrate) navigator.vibrate(60);
                setTimeout(() => {
                    dotsBox.classList.remove('is-shake');
                    buf = '';
                    paint();
                    hint.textContent = '输入我们的六位数字';
                    hint.classList.remove('is-error');
                }, 620);
            }
        }

        function push(v) {
            if (v === 'delete') {
                buf = buf.slice(0, -1);
                paint();
                return;
            }
            if (buf.length >= 6) return;
            buf += v;
            paint();
            if (buf.length === 6) setTimeout(verify, 220);
        }

        $$('.key', screen).forEach((key) => {
            const v = key.dataset.value;
            if (v === undefined) return;
            key.addEventListener('click', () => {
                key.classList.add('active');
                setTimeout(() => key.classList.remove('active'), 180);
                push(v);
            });
        });

        // 物理键盘支持（原项目已有，此处保留并补充 Enter/Esc 语义）
        document.addEventListener('keydown', (e) => {
            if (screen.style.display === 'none') return;
            if (/^[0-9]$/.test(e.key)) {
                const btn = $(`.key[data-value="${e.key}"]`, screen);
                if (btn) { btn.classList.add('active'); setTimeout(() => btn.classList.remove('active'), 180); }
                push(e.key);
            } else if (e.key === 'Backspace' || e.key === 'Delete') {
                e.preventDefault();
                push('delete');
            }
        });
    }

    function lockNow() {
        store.del(LS.unlockAt);
        location.reload();
    }

    /* ---------------- 设置面板 ---------------- */
    function initSettings() {
        const sheet = $('#settings-sheet');
        const s = state.settings;

        const map = {
            '#opt-dark': 'dark',
            '#opt-system': 'system',
            '#opt-order': 'reverseTimeline',
            '#opt-petals': 'petals'
        };

        Object.keys(map).forEach((sel) => { $(sel).checked = !!s[map[sel]]; });
        $('#opt-expiry').value = s.expiryMinutes;

        const open = () => { sheet.classList.add('is-open'); sheet.setAttribute('aria-hidden', 'false'); };
        const close = () => { sheet.classList.remove('is-open'); sheet.setAttribute('aria-hidden', 'true'); };

        $('#settings-open').addEventListener('click', open);
        $('#settings-close').addEventListener('click', close);
        sheet.addEventListener('click', (e) => { if (e.target === sheet) close(); });

        $('#opt-dark').addEventListener('change', (e) => {
            s.dark = e.target.checked;
            if (s.dark && s.system) { s.system = false; $('#opt-system').checked = false; }
            applyTheme(); saveSettings();
        });

        $('#opt-system').addEventListener('change', (e) => {
            s.system = e.target.checked;
            if (s.system) { s.dark = mq.matches; $('#opt-dark').checked = s.dark; }
            applyTheme(); saveSettings();
        });

        $('#opt-order').addEventListener('change', (e) => {
            s.reverseTimeline = e.target.checked;
            saveSettings();
            LP.renderTimeline();
            toast(s.reverseTimeline ? '最近的故事在最前面' : '按时间顺序讲述');
        });

        $('#opt-petals').addEventListener('change', (e) => {
            s.petals = e.target.checked;
            saveSettings();
            buildPetals();
        });

        $('#opt-expiry').addEventListener('change', (e) => {
            let v = parseInt(e.target.value, 10);
            if (isNaN(v) || v < 1) v = 1;
            if (v > 1440) v = 1440;
            e.target.value = v;
            s.expiryMinutes = v;
            saveSettings();
            toast(`解锁有效期已设为 ${v} 分钟`);
        });

        $('#btn-lock').addEventListener('click', lockNow);

        $('#btn-clear').addEventListener('click', () => {
            if (!confirm('确定要清空所有悄悄话吗？此操作无法撤销。')) return;
            store.del(LS.messages);
            store.del(LS.likes);
            LP.renderMessages();
            toast('已清空');
        });

        $('#btn-export').addEventListener('click', () => {
            const list = LP.getMessages();
            if (!list.length) { toast('还没有留言可以导出'); return; }
            const text = list.map((m) =>
                `[${new Date(m.time).toLocaleString('zh-CN')}] ${m.author}${m.mood ? '（' + m.mood + '）' : ''}\n${m.text}\n`
            ).join('\n');
            const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `悄悄话-${new Date().toISOString().slice(0, 10)}.txt`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 2000);
            toast('已导出到下载');
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && sheet.classList.contains('is-open')) close();
        });
    }

    /* ---------------- 启动 ---------------- */
    async function boot() {
        applyTheme();
        buildPetals();

        // 移动端禁止双指缩放（沿用原项目）
        document.addEventListener('touchstart', (e) => {
            if (e.touches.length > 1) e.preventDefault();
        }, { passive: false });
        document.addEventListener('gesturestart', (e) => e.preventDefault());

        let data;
        try {
            const res = await fetch('data/config.json', { cache: 'no-cache' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            data = await res.json();
        } catch (err) {
            console.error('[LP] 配置加载失败：', err);
            document.body.innerHTML =
                '<div style="padding:80px 24px;text-align:center;font-family:sans-serif;line-height:2">' +
                '<h2 style="font-weight:500">配置文件没能读取到</h2>' +
                '<p style="color:#888;font-size:.9rem">请通过 HTTP 服务访问（例如 <code>python -m http.server</code>），' +
                '直接双击 index.html 会被浏览器的本地文件策略拦截。</p></div>';
            return;
        }

        state.config = data;
        document.title = data.site.title || '我们的故事';
        const brand = $('#brand-text');
        if (brand) brand.textContent = data.site.title || '';
        const eyebrow = $('#hero-eyebrow');
        if (eyebrow && data.site.subtitle) eyebrow.textContent = data.site.subtitle;
        const note = $('#footer-note');
        if (note) note.textContent = data.site.footerNote || '';

        initLock(() => {
            LP.renderAll();
            startCounter();
            initNav();
            initSettings();
            $('#app').classList.add('is-ready');
            observeReveal($$('.reveal'));
        });
    }

    document.addEventListener('DOMContentLoaded', boot);

    /* ---------------- 对外接口 ---------------- */
    return {
        LS, $, $$, store, esc, pad, parseDate, dayDiff, fmtDate, fmtRelTime,
        state, toast, observeReveal, lazyImages
    };
})();
