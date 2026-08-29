/* =========================================================
   views/period-view.js — 模块 7 经期追踪视图
   由 app.js 拆分：视图渲染 + 交互，经 LP.Views 注册，renderAll 统一调度
   ========================================================= */

(function (LP) {
    'use strict';

    const { $, $$, store, esc, pad, parseDate, dayDiff, fmtDate, fmtRelTime, state, toast, observeReveal, lazyImages, LS } = LP;
    const ICONS = LP.UI.ICONS;
    const icon = LP.UI.icon;
    const MOODS = LP.UI.MOODS;

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

    LP.Views = LP.Views || {};
    LP.Views.Period = { render: renderPeriod };

})(window.LP);
