package com.flogdoog.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.webkit.DownloadListener;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * 秘密基地 WebView 壳。
 * 加载 main.flogdoog.pages.dev；站内链接内部打开、外部链接交给系统浏览器；
 * 支持 <input type=file>（照片墙/点评传图）、DownloadManager 下载（云盘）、返回键网页后退。
 * 同步密钥内置在站点前端，App 内 localStorage 首次打开即自动同步。
 */
public class MainActivity extends Activity {

    private static final String HOME = "https://main.flogdoog.pages.dev/";
    private static final String HOST_SUFFIX = "flogdoog.pages.dev";
    private static final String UPDATE_META_URL = "https://main.flogdoog.pages.dev/api/app/latest";
    private static final String UPDATE_APK_URL = "https://main.flogdoog.pages.dev/api/app/apk";
    private static final int FILE_CHOOSER_CODE = 1001;

    private WebView web;
    private android.webkit.ValueCallback<Uri[]> fileCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 状态栏与背景融入站点奶油色，沉浸式
        Window w = getWindow();
        w.setStatusBarColor(Color.parseColor("#FFF7F3"));
        w.getDecorView().setSystemUiVisibility(
                w.getDecorView().getSystemUiVisibility() | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);

        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);      // localStorage：解锁状态 / 同步配置 / 全部模块数据
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportZoom(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                Uri u = req.getUrl();
                String host = u.getHost() == null ? "" : u.getHost();
                if (host.endsWith(HOST_SUFFIX)) return false; // 站内：WebView 自己加载
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u)); // 外部：系统浏览器
                } catch (Exception ignored) {
                }
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            // 照片墙 / 点评 / 云盘的 <input type="file"> 上传
            @Override
            public boolean onShowFileChooser(WebView v, android.webkit.ValueCallback<Uri[]> cb,
                                             FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                try {
                    Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    i.setType("*/*");
                    String[] types = params.getAcceptTypes();
                    if (types != null && types.length > 0 && types[0] != null) {
                        String t = types[0];
                        if (t.contains("image")) i.setType("image/*");
                        else if (t.contains("video")) i.setType("video/*");
                    }
                    startActivityForResult(Intent.createChooser(i, "选择文件"), FILE_CHOOSER_CODE);
                    return true;
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
            }
        });

        // 云盘等下载走系统 DownloadManager
        web.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String ua, String disposition, String mime, long len) {
                try {
                    DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
                    req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                    DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                    dm.enqueue(req);
                    Toast.makeText(MainActivity.this, "开始下载", Toast.LENGTH_SHORT).show();
                } catch (Exception e) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                    } catch (Exception ignored) {
                    }
                }
            }
        });

        if (savedInstanceState == null) {
            web.loadUrl(HOME);
        }

        // 应用内更新：延迟 2.5s（让首屏先加载），后台检查云端版本
        new Thread(() -> {
            try { Thread.sleep(2500); } catch (InterruptedException ignored) { }
            checkForUpdate();
        }).start();
    }

    /* ============ 应用内更新 ============ */

    /** 启动后检查 /api/app/latest，云端 versionCode 更大则弹窗引导升级。任何异常静默跳过。 */
    private void checkForUpdate() {
        try {
            HttpURLConnection conn = openGet(UPDATE_META_URL, 8000);
            if (conn.getResponseCode() != 200) { conn.disconnect(); return; }
            JSONObject meta = new JSONObject(readAll(conn.getInputStream()));
            conn.disconnect();
            int remote = meta.optInt("versionCode", 0);
            if (remote <= installedVersionCode()) return;

            final String name = meta.optString("versionName", String.valueOf(remote));
            final String notes = meta.optString("notes", "修复了一些问题，体验更顺滑");
            runOnUiThread(() -> new AlertDialog.Builder(MainActivity.this)
                    .setTitle("发现新版本 " + name)
                    .setMessage(notes)
                    .setCancelable(true)
                    .setPositiveButton("立即更新", (DialogInterface d, int w) ->
                            new Thread(() -> downloadAndInstall(remote), "apk-download").start())
                    .setNegativeButton("下次再说", null)
                    .show());
        } catch (Exception ignored) {
            // 无网络 / 接口不可用：不打扰用户
        }
    }

    /** 下载新 APK 到 cacheDir/update.apk，成功后拉起系统安装器。 */
    private void downloadAndInstall(int remoteVersionCode) {
        File apk = new File(getCacheDir(), "update.apk");
        try {
            HttpURLConnection conn = openGet(UPDATE_APK_URL, 30000);
            if (conn.getResponseCode() != 200) throw new Exception("http " + conn.getResponseCode());
            InputStream in = conn.getInputStream();
            FileOutputStream out = new FileOutputStream(apk);
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            out.close();
            in.close();
            conn.disconnect();
            if (apk.length() < 1024) throw new Exception("apk too small");

            runOnUiThread(() -> {
                try {
                    Uri uri = FileProvider.getUriForFile(MainActivity.this,
                            getPackageName() + ".fileprovider", apk);
                    Intent i = new Intent(Intent.ACTION_VIEW);
                    i.setDataAndType(uri, "application/vnd.android.package-archive");
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    startActivity(i);
                    Toast.makeText(MainActivity.this, "下载完成，请在安装提示中确认", Toast.LENGTH_LONG).show();
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "无法启动安装：" + e.getMessage(), Toast.LENGTH_LONG).show();
                }
            });
        } catch (Exception e) {
            runOnUiThread(() -> Toast.makeText(MainActivity.this,
                    "更新下载失败，请稍后重试", Toast.LENGTH_SHORT).show());
        }
    }

    private int installedVersionCode() {
        try {
            PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0);
            return pi.versionCode;
        } catch (Exception e) {
            return 0;
        }
    }

    private HttpURLConnection openGet(String url, int timeoutMs) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setRequestMethod("GET");
        conn.setConnectTimeout(timeoutMs);
        conn.setReadTimeout(timeoutMs);
        return conn;
    }

    private String readAll(InputStream in) throws Exception {
        java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        int n;
        while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
        in.close();
        return bos.toString("UTF-8");
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_CODE) {
            Uri[] out = null;
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                out = new Uri[]{data.getData()};
            }
            if (fileCallback != null) {
                fileCallback.onReceiveValue(out);
                fileCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        // 返回键 = 网页后退（站内多级浏览时不直接退出）
        if (keyCode == KeyEvent.KEYCODE_BACK && web != null && web.canGoBack()) {
            web.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (web != null) web.saveState(outState);
    }

    @Override
    protected void onRestoreInstanceState(Bundle savedInstanceState) {
        super.onRestoreInstanceState(savedInstanceState);
        if (web != null) web.restoreState(savedInstanceState);
    }
}
