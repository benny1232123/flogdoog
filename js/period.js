/**
 * LP.Period — 经期记录与预测模块
 * 数据存 localStorage（key: lp_period），支持 KV 云端同步。
 * 预测算法：基于最近 N 次周期的平均值，±标准差给出范围。
 */
(function () {
    'use strict';

    const LS_KEY = 'lp_period';
    const DEFAULT_CYCLE = 28;      // 默认周期天数
    const DEFAULT_DURATION = 5;     // 默认经期长度
    const FLOW_OPTIONS = ['少量', '正常', '较多'];
    const SYMPTOM_OPTIONS = ['腹痛', '腰酸', '乳房胀', '情绪波动', '疲劳', '头痛', '痘痘', '无'];

    // ---- 数据结构 ----
    // records: [{ id, startDate, endDate, flow, symptoms[], note }]
    // config: { cycleLen(平均周期), duration(平均经期), lastPredictDate }

    function getDefaultData() {
        return {
            records: [],
            config: {
                cycleLen: DEFAULT_CYCLE,
                duration: DEFAULT_DURATION,
                lastPredictDate: null
            }
        };
    }

    function load() {
        try {
            const raw = localStorage.getItem(LS_KEY);
            if (raw) { const d = JSON.parse(raw); if (d && typeof d === 'object') return d; }
        } catch (e) { /* ignore */ }
        return getDefaultData();
    }

    function save(data) {
        try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch (e) { /* quota */ }
    }

    // ---- 记录管理 ----

    function addRecord(rec) {
        var data = load();
        rec.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        rec.startDate = rec.startDate || fmtISO(new Date());
        if (!rec.endDate) rec.endDate = rec.startDate;
        if (!rec.flow) rec.flow = '正常';
        if (!rec.symptoms) rec.symptoms = [];
        data.records.push(rec);
        data.records.sort(function (a, b) { return a.startDate.localeCompare(b.startDate); });
        recalcConfig(data);
        save(data);
        return data;
    }

    function updateRecord(id, patch) {
        var data = load();
        var r = data.records.find(function (x) { return x.id === id; });
        if (!r) return null;
        Object.keys(patch).forEach(function (k) { r[k] = patch[k]; });
        data.records.sort(function (a, b) { return a.startDate.localeCompare(b.startDate); });
        recalcConfig(data);
        save(data);
        return data;
    }

    function delRecord(id) {
        var data = load();
        data.records = data.records.filter(function (x) { return x.id !== id; });
        recalcConfig(data);
        save(data);
        return data;
    }

    // ---- 周期计算与预测 ----

    function recalcConfig(data) {
        var rs = data.records;
        if (rs.length < 2) {
            data.config.cycleLen = DEFAULT_CYCLE;
            data.config.duration = DEFAULT_DURATION;
            return;
        }
        // 计算相邻记录起始日期间隔（周期）
        var gaps = [];
        for (var i = 1; i < rs.length; i++) {
            var d1 = parseISO(rs[i - 1].startDate);
            var d2 = parseISO(rs[i].startDate);
            if (d1 && d2) {
                var gap = Math.round((d2 - d1) / 86400000);
                if (gap >= 18 && gap <= 45) gaps.push(gap); // 合理范围过滤
            }
        }
        // 计算平均经期长度
        var durations = rs.map(function (r) {
            var s = parseISO(r.startDate), e = parseISO(r.endDate);
            return s && e ? Math.max(1, Math.round((e - s) / 86400000) + 1) : DEFAULT_DURATION;
        }).filter(function (d) { return d >= 1 && d <= 10; });

        data.config.cycleLen = gaps.length > 0 ? Math.round(gaps.reduce(function (a, b) { return a + b; }, 0) / gaps.length) : DEFAULT_CYCLE;
        data.config.duration = durations.length > 0 ? Math.round(durations.reduce(function (a, b) { return a + b; }, 0) / durations.length) : DEFAULT_DURATION;
    }

    /**
     * 获取预测信息
     * 返回: { nextPeriod, nextOvulation, phase, daysUntilPeriod, cycleDay, isPeriodDay }
     */
    function predict(data) {
        data = data || load();
        var rs = data.records;
        var cfg = data.config;
        var today = new Date();
        today.setHours(0, 0, 0, 0);

        var result = {
            phase: 'unknown',       // period | follicular | ovulation | luteal | unknown
            cycleDay: 0,
            daysUntilPeriod: null,
            nextPeriod: null,       // ISO date string
            nextPeriodEnd: null,
            nextOvulation: null,    // ISO date string
            ovulationWindow: [],    // [start, end]
            isPeriodDay: false,
            confidence: 'low'       // low | medium | high
        };

        if (rs.length === 0) {
            result.confidence = 'low';
            result.nextPeriod = addDays(today, cfg.cycleLen);
            result.nextPeriodEnd = addDays(result.nextPeriod, cfg.duration - 1);
            result.daysUntilPeriod = diffDays(today, result.nextPeriod);
            result.nextOvulation = addDays(result.nextPeriod, -14);
            result.ovulationWindow = [addDays(result.nextOvulation, -2), addDays(result.nextOvulation, 2)];
            result.phase = 'follicular';
            return result;
        }

        // 找最近一次经期
        var lastRec = rs[rs.length - 1];
        var lastStart = parseISO(lastRec.startDate);
        var lastEnd = parseISO(lastRec.endDate);

        // 判断今天是否在经期内
        if (lastStart && lastEnd && today >= lastStart && today <= lastEnd) {
            result.phase = 'period';
            result.isPeriodDay = true;
            result.cycleDay = diffDays(lastStart, today) + 1;
            // 下次经期预测
            result.nextPeriod = addDays(lastStart, cfg.cycleLen);
            result.nextPeriodEnd = addDays(result.nextPeriod, cfg.duration - 1);
            result.daysUntilPeriod = diffDays(today, result.nextPeriod);
            result.nextOvulation = addDays(result.nextPeriod, -14);
            result.ovulationWindow = [addDays(result.nextOvulation, -2), addDays(result.nextOvulation, 2)];
            result.confidence = rs.length >= 3 ? 'high' : (rs.length >= 2 ? 'medium' : 'low');
            return result;
        }

        // 今天在经期内吗？（考虑之前的记录）
        for (var i = rs.length - 1; i >= 0; i--) {
            var s = parseISO(rs[i].startDate);
            var e = parseISO(rs[i].endDate);
            if (s && e && today >= s && today <= e) {
                result.phase = 'period';
                result.isPeriodDay = true;
                result.cycleDay = diffDays(s, today) + 1;
                break;
            }
        }

        if (result.isPeriodDay) {
            result.nextPeriod = addDays(lastStart, cfg.cycleLen);
            result.nextPeriodEnd = addDays(result.nextPeriod, cfg.duration - 1);
            result.daysUntilPeriod = diffDays(today, result.nextPeriod);
            result.nextOvulation = addDays(result.nextPeriod, -14);
            result.ovulationWindow = [addDays(result.nextOvulation, -2), addDays(result.nextOvulation, 2)];
            result.confidence = rs.length >= 3 ? 'high' : 'medium';
            return result;
        }

        // 不在经期 — 判断所处阶段
        var daysSinceLast = lastStart ? diffDays(lastStart, today) : cfg.cycleLen;
        var cycleLen = cfg.cycleLen;

        // 排卵期：周期第 10-17 天左右（排卵前2天到后2天）
        var ovulationDay = Math.max(1, cycleLen - 14); // 排卵日大约在下次经期前14天
        var ovStart = Math.max(1, ovulationDay - 2);
        var ovEnd = Math.min(cycleLen - 1, ovulationDay + 2);

        result.cycleDay = daysSinceLast; // 从上次经期第一天算起
        if (result.cycleDay < 1) result.cycleDay = 1;

        result.nextPeriod = addDays(lastStart, cycleLen);
        result.nextPeriodEnd = addDays(result.nextPeriod, cfg.duration - 1);
        result.daysUntilPeriod = diffDays(today, result.nextPeriod);
        result.nextOvulation = addDays(lastStart, ovulationDay);
        result.ovulationWindow = [addDays(lastStart, ovStart), addDays(lastStart, ovEnd)];

        if (daysSinceLast >= ovStart && daysSinceLast <= ovEnd) {
            result.phase = 'ovulation';
        } else if (daysSinceLast > ovEnd) {
            result.phase = 'luteal';
        } else {
            result.phase = 'follicular';
        }

        result.confidence = rs.length >= 3 ? 'high' : (rs.length >= 2 ? 'medium' : 'low');
        return result;
    }

    // ---- 日历数据生成 ----

    /**
     * 生成指定月份的日历数据，标记经期日期
     * @param {number} year
     * @param {number} month 0-indexed
     * @returns {{ year, month, weeks: [[{date, iso, isToday, isPeriod, flow, recordId, isFuture}]] }}
     */
    function getCalendarMonth(year, month) {
        var data = load();
        var firstDay = new Date(year, month, 1);
        var lastDay = new Date(year, month + 1, 0);
        var startDow = firstDay.getDay(); // 0=Sun
        var daysInMonth = lastDay.getDate();

        var today = new Date();
        today.setHours(0, 0, 0, 0);
        var todayISO = fmtISO(today);

        // 构建该月所有日期的经期状态映射
        var periodMap = {}; // iso -> { flow, recordId }
        data.records.forEach(function (r) {
            var s = parseISO(r.startDate);
            var e = parseISO(r.endDate);
            if (!s || !e) return;
            var cur = new Date(s);
            while (cur <= e) {
                var key = fmtISO(cur);
                periodMap[key] = { flow: r.flow, recordId: r.id };
                cur.setDate(cur.getDate() + 1);
            }
        });

        // 也标记预测的下次经期
        var pred = predict(data);
        if (pred.nextPeriod && pred.nextPeriodEnd) {
            var ps = parseISO(pred.nextPeriod);
            var pe = parseISO(pred.nextPeriodEnd);
            if (ps && pe) {
                var pc = new Date(ps);
                while (pc <= pe) {
                    var pk = fmtISO(pc);
                    if (!periodMap[pk]) periodMap[pk] = { predicted: true, flow: '预测' };
                    pc.setDate(pc.getDate() + 1);
                }
            }
        }

        var weeks = [];
        var week = [];
        // 前置空白
        for (var i = 0; i < startDow; i++) week.push(null);
        // 日期
        for (var d = 1; d <= daysInMonth; d++) {
            var dateObj = new Date(year, month, d);
            var iso = fmtISO(dateObj);
            var pinfo = periodMap[iso];
            week.push({
                date: d,
                iso: iso,
                isToday: iso === todayISO,
                isPeriod: !!pinfo && !pinfo.predicted,
                isPredicted: !!(pinfo && pinfo.predicted),
                flow: pinfo ? pinfo.flow : null,
                recordId: pinfo ? pinfo.recordId : null,
                isFuture: dateObj > today
            });
            if (week.length === 7) { weeks.push(week); week = []; }
        }
        // 后置空白
        if (week.length > 0) { while (week.length < 7) week.push(null); weeks.push(week); }

        return { year: year, month: month, weeks: weeks };
    }

    // ---- 导出 / 导入（给同步用）----

    function exportData() { return load(); }

    function importData(d) {
        if (d && typeof d === 'object' && Array.isArray(d.records)) {
            save(d);
            return true;
        }
        return false;
    }

    // ---- 工具函数 ----

    function parseISO(s) {
        if (!s) return null;
        var d = new Date(s + 'T00:00:00');
        return isNaN(d.getTime()) ? null : d;
    }

    function fmtISO(d) {
        if (!(d instanceof Date) || isNaN(d.getTime())) return '';
        var y = d.getFullYear();
        var m = String(d.getMonth() + 1).padStart(2, '0');
        var day = String(d.getDate()).padStart(2, '0');
        return y + '-' + m + '-' + day;
    }

    function addDays(d, n) {
        var r = new Date(d);
        r.setDate(r.getDate() + n);
        return fmtISO(r);
    }

    function diffDays(a, b) {
        var da = (a instanceof Date) ? a : parseISO(a);
        var db = (b instanceof Date) ? b : parseISO(b);
        if (!da || !db) return 0;
        return Math.round((db - da) / 86400000);
    }

    // ---- 公开 API ----

    window.LP = window.LP || {};
    window.LP.Period = {
        FLOW_OPTIONS: FLOW_OPTIONS,
        SYMPTOM_OPTIONS: SYMPTOM_OPTIONS,
        DEFAULT_CYCLE: DEFAULT_CYCLE,
        load: load,
        save: save,
        addRecord: addRecord,
        updateRecord: updateRecord,
        delRecord: delRecord,
        predict: predict,
        getCalendarMonth: getCalendarMonth,
        exportData: exportData,
        importData: importData,
        recalcConfig: recalcConfig,
        _fmtISO: fmtISO,
        _parseISO: parseISO
    };

})();
