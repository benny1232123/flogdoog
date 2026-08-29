/* =========================================================
   views/schedule-view.js — 模块 9 日程/待办/日历视图
   由 app.js 拆分：视图渲染 + 交互，经 LP.Views 注册，renderAll 统一调度
   ========================================================= */

(function (LP) {
    'use strict';

    const { $, $$, store, esc, pad, parseDate, dayDiff, fmtDate, fmtRelTime, state, toast, observeReveal, lazyImages, LS } = LP;
    const ICONS = LP.UI.ICONS;
    const icon = LP.UI.icon;
    const MOODS = LP.UI.MOODS;

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

    LP.Views = LP.Views || {};
    LP.Views.Schedule = { render: renderSchedule };

})(window.LP);
