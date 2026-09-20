package com.yellowblitz.trainer;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.*;
import android.content.Intent;
import android.content.ClipboardManager;
import android.content.ClipData;
import android.content.Context;
import android.net.Uri;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;

public class MainActivity extends Activity {
    private WebView web;
    private String pendingSharedText;
    private boolean pageReady = false;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        captureSharedText(getIntent());
        getWindow().setStatusBarColor(0xff101915);
        getWindow().setNavigationBarColor(0xff101915);
        web = new WebView(this);
        web.setOnApplyWindowInsetsListener((v, insets) -> {
            v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets;
        });
        setContentView(web);
        web.setBackgroundColor(0xff101915);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.addJavascriptInterface(new KeyVault(this), "TrainerKeys");
        web.addJavascriptInterface(new ShareBridge(), "TrainerShare");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                if ("https".equals(req.getUrl().getScheme()) &&
                    ("aistudio.google.com".equals(req.getUrl().getHost()) || "chatgpt.com".equals(req.getUrl().getHost()))) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, req.getUrl())); } catch (Exception ignored) { }
                    return true;
                }
                return !("https".equals(req.getUrl().getScheme()) && "appassets.androidplatform.net".equals(req.getUrl().getHost()) && "/assets/index.html".equals(req.getUrl().getPath()));
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (url != null && url.startsWith("https://appassets.androidplatform.net/assets/index.html")) {
                    pageReady = true;
                    flushSharedText();
                }
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                if (!"appassets.androidplatform.net".equals(req.getUrl().getHost())) return null;
                String path = req.getUrl().getPath();
                try {
                    if (path == null || !path.startsWith("/assets/") || path.contains("..")) throw new Exception();
                    String file = path.substring(8);
                    String mime = file.endsWith(".html") ? "text/html" : file.endsWith(".css") ? "text/css" :
                        file.endsWith(".js") ? "application/javascript" : file.endsWith(".json") ? "application/json" : "image/jpeg";
                    return new WebResourceResponse(mime, "UTF-8", getAssets().open(file));
                } catch (Exception e) {
                    return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", null, new ByteArrayInputStream(new byte[0]));
                }
            }
        });
        web.loadUrl("https://appassets.androidplatform.net/assets/index.html");
    }

    private void captureSharedText(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        CharSequence shared = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        if (shared != null) pendingSharedText = shared.toString().substring(0, Math.min(shared.length(), 50000));
    }

    private void flushSharedText() {
        if (!pageReady || web == null || pendingSharedText == null || pendingSharedText.isEmpty()) return;
        String payload = JSONObject.quote(pendingSharedText);
        pendingSharedText = null;
        web.post(() -> web.evaluateJavascript("window.receiveTrainerShare && window.receiveTrainerShare(" + payload + ");", null));
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        captureSharedText(intent);
        flushSharedText();
    }

    public class ShareBridge {
        @JavascriptInterface public void copyText(String value) {
            if (value == null) return;
            String safe = value.substring(0, Math.min(value.length(), 50000));
            runOnUiThread(() -> {
                ClipboardManager clipboard = (ClipboardManager)getSystemService(Context.CLIPBOARD_SERVICE);
                clipboard.setPrimaryClip(ClipData.newPlainText("Trainer context for ChatGPT", safe));
            });
        }
        @JavascriptInterface public void openChatGPT() {
            runOnUiThread(() -> {
                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://chatgpt.com/"))); } catch (Exception ignored) { }
            });
        }
    }

    @Override public void onBackPressed() { if(web.canGoBack()) web.goBack(); else super.onBackPressed(); }
    @Override public void onDestroy() { web.destroy(); super.onDestroy(); }
}
