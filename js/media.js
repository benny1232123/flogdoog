/* =========================================================
   media.js — 媒体存储层（本次新增）
   IndexedDB 存放用户上传的图片 / 视频原始 Blob
   为什么不用 localStorage：其配额约 5MB，且只能存字符串，
   视频与高清照片必须走 IndexedDB（配额通常为磁盘剩余空间的一部分）。
   ========================================================= */

window.LPMedia = (function () {
    'use strict';

    const DB_NAME = 'lp-media';
    const DB_VER = 1;
    const STORE = 'items';

    const MAX_IMAGE_EDGE = 1800;   // 图片最长边（px），超出则等比压缩
    const IMAGE_QUALITY = 0.86;    // JPEG 质量
    const WARN_VIDEO_MB = 60;      // 单个视频超过此大小给出提示

    let dbPromise = null;

    /* ---------------- 打开数据库 ---------------- */
    function openDB() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise((resolve, reject) => {
            if (!('indexedDB' in window)) {
                reject(new Error('当前浏览器不支持 IndexedDB'));
                return;
            }
            const req = indexedDB.open(DB_NAME, DB_VER);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE)) {
                    const os = db.createObjectStore(STORE, { keyPath: 'id' });
                    os.createIndex('createdAt', 'createdAt');
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        return dbPromise;
    }

    function tx(mode, fn) {
        return openDB().then((db) => new Promise((resolve, reject) => {
            const t = db.transaction(STORE, mode);
            const store = t.objectStore(STORE);
            let result;
            try { result = fn(store); } catch (e) { reject(e); return; }
            t.oncomplete = () => resolve(result && result.result !== undefined ? result.result : result);
            t.onerror = () => reject(t.error);
            t.onabort = () => reject(t.error || new Error('事务被中止'));
        }));
    }

    /* ---------------- 基础读写 ---------------- */
    const put = (rec) => tx('readwrite', (s) => s.put(rec));
    const del = (id) => tx('readwrite', (s) => s.delete(id));
    const clear = () => tx('readwrite', (s) => s.clear());

    function all() {
        return tx('readonly', (s) => s.getAll()).then((list) => {
            const arr = Array.isArray(list) ? list : [];
            // 新上传的排在前面
            return arr.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        });
    }

    function get(id) { return tx('readonly', (s) => s.get(id)); }

    /* ---------------- base64 → Blob（云端同步下来的媒体还原） ---------------- */
    function base64ToBlob(b64, mime) {
        try {
            const bin = atob(b64);
            const len = bin.length;
            const arr = new Uint8Array(len);
            for (let i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
            return new Blob([arr], { type: mime || 'application/octet-stream' });
        } catch (e) {
            console.warn('[LPMedia] base64 解码失败', e);
            return null;
        }
    }

    /* ---------------- 云端媒体 → 写回本机 IndexedDB（作为本地缓存） ----------------
       @param {string} id  媒体 id（与云端 media:<id> 对应）
       @param {Blob} blob 已取回的原始字节
       @param {object} meta mediaMeta 中的元数据 {kind,name,mime,caption,date,w,h,size,duration}
       @param {Blob|null} posterBlob 封面原始字节（可选）
       已存在的 id 不覆盖；返回是否实际写入。 */
    async function putRemote(id, blob, meta, posterBlob) {
        if (!id || !blob) return false;
        try {
            const exist = await get(id);
            if (exist && exist.blob) return false; // 本机已有，不覆盖
            const rec = {
                id,
                kind: (meta && meta.kind) || (blob.type && blob.type.indexOf('video') >= 0 ? 'video' : 'image'),
                name: (meta && meta.name) || (id + '.bin'),
                mime: (meta && meta.mime) || blob.type,
                caption: (meta && meta.caption) || '',
                date: (meta && meta.date) || '',
                createdAt: Date.now(),
                w: (meta && meta.w) || null,
                h: (meta && meta.h) || null,
                size: (meta && meta.size) || blob.size,
                duration: (meta && meta.duration) || null,
                blob
            };
            if (posterBlob) rec.poster = posterBlob;
            await put(rec);
            return true;
        } catch (e) {
            console.warn('[LPMedia] 写入云端媒体失败: ' + id, e);
            return false;
        }
    }

    /* ---------------- 容量估算 ---------------- */
    async function estimate() {
        if (!navigator.storage || !navigator.storage.estimate) return null;
        try {
            const e = await navigator.storage.estimate();
            return { usage: e.usage || 0, quota: e.quota || 0 };
        } catch (err) { return null; }
    }

    const fmtSize = (bytes) => {
        if (!bytes) return '0 B';
        const u = ['B', 'KB', 'MB', 'GB'];
        const i = Math.min(u.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
        return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + u[i];
    };

    /* ---------------- 图片压缩 ---------------- */
    async function shrinkImage(file) {
        // GIF 压缩会丢失动画，原样保留
        if (file.type === 'image/gif') {
            const size = await imageSize(file).catch(() => null);
            return { blob: file, w: size && size.w, h: size && size.h };
        }

        let bmp;
        try {
            bmp = await createImageBitmap(file);
        } catch (e) {
            // createImageBitmap 不支持该格式（如部分 HEIC）时原样存
            return { blob: file, w: null, h: null };
        }

        const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bmp.width, bmp.height));
        const w = Math.round(bmp.width * scale);
        const h = Math.round(bmp.height * scale);

        // 无需缩放且体积不大 → 直接存原文件，避免二次有损
        if (scale === 1 && file.size < 900 * 1024) {
            bmp.close && bmp.close();
            return { blob: file, w, h };
        }

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bmp, 0, 0, w, h);
        bmp.close && bmp.close();

        const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', IMAGE_QUALITY));
        // 压缩后反而更大（例如原图是高压缩 WebP）→ 用原文件
        if (!blob || blob.size >= file.size) return { blob: file, w, h };
        return { blob, w, h };
    }

    function imageSize(file) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => { resolve({ w: img.naturalWidth, h: img.naturalHeight }); URL.revokeObjectURL(url); };
            img.onerror = () => { reject(new Error('读取图片尺寸失败')); URL.revokeObjectURL(url); };
            img.src = url;
        });
    }

    /* ---------------- 视频封面帧 ---------------- */
    function videoPoster(file) {
        return new Promise((resolve) => {
            const url = URL.createObjectURL(file);
            const v = document.createElement('video');
            v.preload = 'metadata';
            v.muted = true;
            v.playsInline = true;
            let done = false;

            const finish = (data) => {
                if (done) return;
                done = true;
                URL.revokeObjectURL(url);
                resolve(data);
            };

            // 某些编码无法解码，5 秒后放弃取帧
            const timer = setTimeout(() => finish(null), 5000);

            v.onloadeddata = () => {
                const t = isFinite(v.duration) && v.duration > 0 ? Math.min(1, v.duration / 4) : 0;
                try { v.currentTime = t; } catch (e) { /* 部分格式不可 seek */ }
            };

            v.onseeked = () => {
                clearTimeout(timer);
                try {
                    const scale = Math.min(1, 900 / Math.max(v.videoWidth, v.videoHeight));
                    const w = Math.round(v.videoWidth * scale);
                    const h = Math.round(v.videoHeight * scale);
                    const canvas = document.createElement('canvas');
                    canvas.width = w;
                    canvas.height = h;
                    canvas.getContext('2d').drawImage(v, 0, 0, w, h);
                    canvas.toBlob((poster) => {
                        finish({ poster, w: v.videoWidth, h: v.videoHeight, duration: v.duration });
                    }, 'image/jpeg', 0.8);
                } catch (e) {
                    finish({ poster: null, w: v.videoWidth, h: v.videoHeight, duration: v.duration });
                }
            };

            v.onerror = () => { clearTimeout(timer); finish(null); };
            v.src = url;
        });
    }

    /* ---------------- 对外：处理并保存一批文件 ---------------- */
    /**
     * @param {FileList|File[]} files
     * @param {object} opts { caption, date, onProgress(done,total,name) }
     * @returns {Promise<{saved:Array, skipped:Array, warnings:Array}>}
     */
    async function addFiles(files, opts) {
        opts = opts || {};
        const list = Array.from(files || []);
        const saved = [];
        const skipped = [];
        const warnings = [];

        for (let i = 0; i < list.length; i++) {
            const file = list[i];
            if (opts.onProgress) opts.onProgress(i, list.length, file.name);

            const isImage = file.type.startsWith('image/');
            const isVideo = file.type.startsWith('video/');

            if (!isImage && !isVideo) {
                skipped.push({ name: file.name, reason: '不是图片或视频' });
                continue;
            }

            const id = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
            const rec = {
                id,
                kind: isVideo ? 'video' : 'image',
                name: file.name,
                mime: file.type,
                caption: opts.caption || stripExt(file.name),
                date: opts.date || fileDate(file),
                createdAt: Date.now(),
                w: null, h: null
            };

            try {
                if (isImage) {
                    const r = await shrinkImage(file);
                    rec.blob = r.blob;
                    rec.size = r.blob.size;
                    rec.w = r.w;
                    rec.h = r.h;
                } else {
                    const mb = file.size / 1048576;
                    if (mb > WARN_VIDEO_MB) {
                        warnings.push(`${file.name} 约 ${mb.toFixed(0)}MB，较大可能影响加载`);
                    }
                    const meta = await videoPoster(file);
                    rec.blob = file;
                    rec.size = file.size;
                    if (meta) {
                        rec.poster = meta.poster || null;
                        rec.w = meta.w || null;
                        rec.h = meta.h || null;
                        rec.duration = meta.duration || null;
                    }
                }

                await put(rec);
                saved.push(rec);
            } catch (err) {
                console.error('[LPMedia] 保存失败', file.name, err);
                const quotaHit = err && (err.name === 'QuotaExceededError' ||
                    String(err.message || '').indexOf('quota') > -1);
                skipped.push({ name: file.name, reason: quotaHit ? '浏览器存储空间不足' : '处理失败' });
                if (quotaHit) break;   // 空间已满，无需继续
            }
        }

        if (opts.onProgress) opts.onProgress(list.length, list.length, '');
        return { saved, skipped, warnings };
    }

    /* ---------------- 对外：以固定 id 存储一张图片（覆盖式） ----------------
       供编辑器使用：头像 / 资料卡配图等需要可被反复替换且引用稳定。
       @returns {Promise<{id:string, blob:Blob, w:number|null, h:number|null}>} */
    async function putImage(id, file, meta) {
        const r = await shrinkImage(file);
        const rec = Object.assign({
            id,
            kind: 'image',
            name: file.name || (id + '.jpg'),
            mime: file.type || 'image/jpeg',
            createdAt: Date.now(),
            w: r.w,
            h: r.h
        }, meta || {});
        rec.blob = r.blob;
        rec.size = r.blob.size;
        await put(rec);
        return rec;
    }

    /* ---------------- 对外：把一条记录解析成可渲染的 ObjectURL ----------------
       @returns {Promise<string|null>} */
    async function urlOf(id) {
        if (!id) return null;
        try {
            const rec = await get(id);
            if (!rec || !rec.blob) return null;
            return toURL(rec.blob);
        } catch (e) {
            console.warn('[LPMedia] 取媒体失败：', id, e);
            return null;
        }
    }

    const stripExt = (n) => String(n || '').replace(/\.[^.]+$/, '').slice(0, 40);

    function fileDate(file) {
        const d = file.lastModified ? new Date(file.lastModified) : new Date();
        const p = (x) => String(x).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }

    /* ---------------- ObjectURL 生命周期管理 ---------------- */
    const urls = new Set();

    function toURL(blob) {
        const u = URL.createObjectURL(blob);
        urls.add(u);
        return u;
    }

    function revokeAll() {
        urls.forEach((u) => URL.revokeObjectURL(u));
        urls.clear();
    }

    return { all, get, put, del, clear, addFiles, putImage, urlOf, estimate, fmtSize, toURL, revokeAll, putRemote };
})();
