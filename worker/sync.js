/* =========================================================
   Cloudflare Worker — flogdoog 云端同步后端
   配合站点 js/sync.js 使用：
     GET  <endpoint>            → 返回 KV 中的覆盖层 JSON
     PUT  <endpoint>  (body)    → 写入覆盖层（需 x-sync-key 校验）
   覆盖层 = 站点/资料/纪念日/时间轴/照片墙 的全部文本与结构。
   图片/视频不在此同步（存各设备本机 IndexedDB）。
   ========================================================= */

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, x-sync-key'
};

const KV_KEY = 'overlay';

export default {
    async fetch(request, env, ctx) {
        // 预检
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: CORS });
        }

        // 密钥校验（站点为公开页，用共享密钥防陌生人篡改）
        const key = request.headers.get('x-sync-key');
        if (key !== env.SYNC_KEY) {
            return new Response('forbidden', { status: 403, headers: CORS });
        }

        const ns = env.LP_KV;
        if (!ns) {
            return new Response('KV not bound', { status: 500, headers: CORS });
        }

        if (request.method === 'GET') {
            const val = await ns.get(KV_KEY, { type: 'json' });
            return new Response(JSON.stringify(val || {}), {
                status: 200,
                headers: { ...CORS, 'content-type': 'application/json' }
            });
        }

        if (request.method === 'PUT') {
            const body = await request.text();
            // 写入前做一次 JSON 合法性校验，避免脏数据覆盖
            try { JSON.parse(body); } catch (e) {
                return new Response('invalid json', { status: 400, headers: CORS });
            }
            await ns.put(KV_KEY, body, { expirationTtl: 60 * 60 * 24 * 365 * 5 });
            return new Response('ok', { status: 200, headers: CORS });
        }

        return new Response('method not allowed', { status: 405, headers: CORS });
    }
};
