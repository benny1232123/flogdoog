/* =========================================================
   views/room-view.js — 模块 13 虚拟房间视图
   由 app.js 拆分：视图渲染 + 交互，经 LP.Views 注册，renderAll 统一调度
   ========================================================= */

(function (LP) {
    'use strict';

    const { $, $$, store, esc, pad, parseDate, dayDiff, fmtDate, fmtRelTime, state, toast, observeReveal, lazyImages, LS } = LP;
    const ICONS = LP.UI.ICONS;
    const icon = LP.UI.icon;
    const MOODS = LP.UI.MOODS;

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

    LP.Views = LP.Views || {};
    LP.Views.Room = { render: renderRoom };

})(window.LP);
