/* =========================================================
   Cloudflare Pages Function — flogdoog 云端同步后端（站同域）
   路由：/api/sync
     GET  → 返回 KV 中的覆盖层 JSON
     PUT  (body) → 写入覆盖层（需 x-sync-key 校验）
   与 worker/sync.js 共用同一个 KV 命名空间（LP_KV），数据一致。
   放在站同域（pages.dev）即可被手机网络访问，且无需跨域。
   ========================================================= */

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, x-sync-key'
};

const KV_KEY = 'overlay';

export async function onRequestOptions() {
    return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet({ request, env }) {
    const key = request.headers.get('x-sync-key');
    if (key !== env.SYNC_KEY) return new Response('forbidden', { status: 403, headers: CORS });
    const ns = env.LP_KV;
    if (!ns) return new Response('KV not bound', { status: 500, headers: CORS });
    const val = await ns.get(KV_KEY, { type: 'json' });
    return new Response(JSON.stringify(val || {}), {
        status: 200,
        headers: { ...CORS, 'content-type': 'application/json' }
    });
}

export async function onRequestPut({ request, env }) {
    const key = request.headers.get('x-sync-key');
    if (key !== env.SYNC_KEY) return new Response('forbidden', { status: 403, headers: CORS });
    const ns = env.LP_KV;
    if (!ns) return new Response('KV not bound', { status: 500, headers: CORS });
    const body = await request.text();
    try { JSON.parse(body); } catch (e) {
        return new Response('invalid json', { status: 400, headers: CORS });
    }
    await ns.put(KV_KEY, body, { expirationTtl: 60 * 60 * 24 * 365 * 5 });
    return new Response('ok', { status: 200, headers: CORS });
}
