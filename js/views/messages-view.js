/* =========================================================
   views/messages-view.js — 模块 5 悄悄话留言板
   由 app.js 拆分：视图渲染 + 交互，经 LP.Views 注册，renderAll 统一调度
   ========================================================= */

(function (LP) {
    'use strict';

    const { $, $$, store, esc, pad, parseDate, dayDiff, fmtDate, fmtRelTime, state, toast, observeReveal, lazyImages, LS } = LP;
    const ICONS = LP.UI.ICONS;
    const icon = LP.UI.icon;
    const MOODS = LP.UI.MOODS;

    /* =========================================================
       模块 5 — 悄悄话留言板（新增，localStorage 持久化）
       ========================================================= */
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

    function setMessages(list) {
        // ⚠️ 保护：不存入空数组覆盖非空数据（避免 pushAll 把 [] 推上云清空消息）
        const existing = store.get(LS.messages, null);
        if ((!list || !list.length) && existing && Array.isArray(existing) && existing.length) {
            console.warn('[LP] setMessages 拒绝写入空数组（保留已有 ' + existing.length + ' 条消息）');
            return;
        }
        store.set(LS.messages, list);
    }

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
                // ⚠️ 不再从列表中移除消息实体！只靠 delIds 渲染时过滤。
                //    原因：若此处 filter 后存入空数组，pushAll 会把 [] 推上云覆盖原有消息。
                renderMessages();
                toast('已删除');
                syncMessages(); // 同步删除到云端
            });
        });
    }

    LP.Views = LP.Views || {};
    LP.Views.Messages = {
        renderComposer: renderComposer,
        render: renderMessages
    };
    // 兼容旧全局 API（sync.js / core.js 调用）
    LP.renderMessages = renderMessages;
    LP.getMessages = getMessages;

})(window.LP);
