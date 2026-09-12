/* =========================================================
   Cloudflare Pages Function — App 壳版本分发（站同域）
   路由（catch-all，覆盖 /api/app 及其子路径）：
     /api/app/latest  GET → 返回最新壳版本元数据（KV 键 app:latest，JSON）：
                              { versionCode, versionName, notes }
                              未发布时返回 { versionCode: 0 }（客户端视为无更新）
     /api/app/apk     GET → 返回最新壳 APK 原始字节（KV 键 app:apk，
                              content-type: application/vnd.android.package-archive）
   发布方式：Actions 构建出 APK 后用 wrangler 写入两个 KV 键：
     npx wrangler kv key put app:apk  --path app-debug.apk --namespace-id <LP_KV_ID> --remote
     npx wrangler kv key put app:latest --path meta.json --namespace-id <LP_KV_ID> --remote
   客户端（Android 壳）启动时 GET latest，versionCode 大于本机即弹窗引导下载安装。
   ========================================================= */

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type'
};

const KEY_META = 'app:latest';
const KEY_APK = 'app:apk';

export async function onRequestOptions() {
    return new Response(null, { status: 204, headers: CORS });
}

export async function onRequest({ request, env }) {
    const ns = env.LP_KV;
    if (!ns) return new Response('kv not bound', { status: 500, headers: CORS });

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');

    if (path.endsWith('/latest')) {
        if (request.method !== 'GET') return new Response('method not allowed', { status: 405, headers: CORS });
        try {
            const meta = await ns.get(KEY_META, { type: 'json' });
            if (meta && typeof meta === 'object' && meta.versionCode) {
                return new Response(JSON.stringify(meta), { status: 200, headers: { ...CORS, 'content-type': 'application/json', 'cache-control': 'no-store' } });
            }
        } catch (e) { /* KV 异常按无更新处理 */ }
        return new Response(JSON.stringify({ versionCode: 0 }), { status: 200, headers: { ...CORS, 'content-type': 'application/json', 'cache-control': 'no-store' } });
    }

    if (path.endsWith('/apk')) {
        if (request.method !== 'GET') return new Response('method not allowed', { status: 405, headers: CORS });
        try {
            const buf = await ns.get(KEY_APK, { type: 'arrayBuffer' });
            if (buf && buf.byteLength > 0) {
                return new Response(buf, {
                    status: 200,
                    headers: { ...CORS, 'content-type': 'application/vnd.android.package-archive', 'content-length': String(buf.byteLength), 'cache-control': 'no-store' }
                });
            }
        } catch (e) { /* 落到 404 */ }
        return new Response('no apk published', { status: 404, headers: CORS });
    }

    return new Response('not found', { status: 404, headers: CORS });
}
