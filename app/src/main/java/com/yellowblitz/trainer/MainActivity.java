package com.yellowblitz.trainer;

import android.app.Activity;
import android.os.Bundle;
import android.content.Intent;
import android.net.Uri;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import java.io.ByteArrayInputStream;

public class MainActivity extends Activity {
    private FrameLayout root;
    private WebView web;
    private DeepSeekBridge deepSeekBridge;
    private boolean pageReady = false;
    private int systemTopInset = 0;
    private int systemBottomInset = 0;
    private String currentTheme = "dark";

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        applyNativeTheme();

        root = new FrameLayout(this);
        web = buildTrainerWebView();
        root.addView(web, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        root.setOnApplyWindowInsetsListener((v, insets) -> {
            if (android.os.Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(
                    android.view.WindowInsets.Type.systemBars() | android.view.WindowInsets.Type.displayCutout());
                systemTopInset = bars.top;
                systemBottomInset = bars.bottom;
                web.setPadding(bars.left, 0, bars.right, 0);
            } else {
                systemTopInset = Math.max(0, insets.getSystemWindowInsetTop());
                systemBottomInset = Math.max(0, Math.min(
                    insets.getSystemWindowInsetBottom(), insets.getStableInsetBottom()));
                web.setPadding(
                    Math.max(0, insets.getSystemWindowInsetLeft()), 0,
                    Math.max(0, insets.getSystemWindowInsetRight()), 0);
            }
            applySystemInsetsToWeb();
            return insets;
        });

        setContentView(root);
        web.loadUrl("https://appassets.androidplatform.net/assets/index.html");
        root.requestApplyInsets();
    }

    private int themeBackground() {
        if ("light".equals(currentTheme)) return 0xfff5f7f4;
        if ("green".equals(currentTheme)) return 0xff101915;
        return 0xff0d1014;
    }

    private void setTheme(String theme) {
        if (!"light".equals(theme) && !"green".equals(theme)) theme = "dark";
        currentTheme = theme;
        applyNativeTheme();
    }

    private void applyNativeTheme() {
        int bg = themeBackground();
        getWindow().setStatusBarColor(bg);
        getWindow().setNavigationBarColor(bg);
        int flags = getWindow().getDecorView().getSystemUiVisibility();
        if ("light".equals(currentTheme)) {
            flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        } else {
            flags &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            flags &= ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        }
        getWindow().getDecorView().setSystemUiVisibility(flags);
        if (root != null) root.setBackgroundColor(bg);
        if (web != null) web.setBackgroundColor(bg);
    }

    private WebView buildTrainerWebView() {
        WebView trainer = new WebView(this);
        trainer.setBackgroundColor(themeBackground());

        WebSettings settings = trainer.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);

        // Native bridges are exposed only to the packaged trainer origin.
        DeepSeekKeyVault deepSeekVault = new DeepSeekKeyVault(this);
        trainer.addJavascriptInterface(deepSeekVault, "TrainerKeys");
        trainer.addJavascriptInterface(new ShareBridge(), "TrainerShare");
        deepSeekBridge = new DeepSeekBridge(this, trainer, deepSeekVault);
        trainer.addJavascriptInterface(deepSeekBridge, "TrainerDeepSeek");
        trainer.addJavascriptInterface(new GoogleAuthBridge(this, trainer), "TrainerGoogle");

        trainer.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri uri = req.getUrl();
                String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
                String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase();
                boolean https = "https".equals(scheme);
                boolean local = https && "appassets.androidplatform.net".equals(host)
                    && "/assets/index.html".equals(uri.getPath());
                boolean youtube = "youtube.com".equals(host) || host.endsWith(".youtube.com")
                    || "youtube-nocookie.com".equals(host) || host.endsWith(".youtube-nocookie.com")
                    || "youtu.be".equals(host);

                if (!req.isForMainFrame() && https && youtube) return false;
                if (req.isForMainFrame() && local) return false;

                if (req.isForMainFrame() && ("http".equals(scheme) || https)) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception ignored) { }
                    return true;
                }
                return true;
            }

            @Override public void onPageFinished(WebView view, String url) {
                if (url != null && url.startsWith("https://appassets.androidplatform.net/assets/index.html")) {
                    pageReady = true;
                    applySystemInsetsToWeb();
                }
            }

            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                if (!"appassets.androidplatform.net".equals(req.getUrl().getHost())) return null;
                String path = req.getUrl().getPath();
                try {
                    if (path == null || !path.startsWith("/assets/") || path.contains("..")) throw new Exception();
                    String file = path.substring(8);
                    String mime = file.endsWith(".html") ? "text/html"
                        : file.endsWith(".css") ? "text/css"
                        : file.endsWith(".js") ? "application/javascript"
                        : file.endsWith(".json") ? "application/json"
                        : file.endsWith(".svg") ? "image/svg+xml"
                        : "image/jpeg";
                    return new WebResourceResponse(mime, "UTF-8", getAssets().open(file));
                } catch (Exception e) {
                    return new WebResourceResponse(
                        "text/plain", "UTF-8", 404, "Not Found", null,
                        new ByteArrayInputStream(new byte[0]));
                }
            }
        });
        return trainer;
    }

    private void applySystemInsetsToWeb() {
        if (!pageReady || web == null) return;
        final float density = getResources().getDisplayMetrics().density;
        final int top = Math.round(systemTopInset / density);
        final int bottom = Math.round(systemBottomInset / density);
        web.post(() -> web.evaluateJavascript(
            "document.documentElement.style.setProperty('--system-top-inset','" + top + "px');" +
            "document.documentElement.style.setProperty('--system-bottom-inset','" + bottom + "px');",
            null
        ));
    }

    public class ShareBridge {
        @JavascriptInterface public void setTheme(String theme) {
            runOnUiThread(() -> MainActivity.this.setTheme(theme));
        }

        @JavascriptInterface public void clearMediaCache() {
            runOnUiThread(() -> {
                if (web != null) web.clearCache(true);
            });
        }
    }

    @Override public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override public void onDestroy() {
        if (deepSeekBridge != null) deepSeekBridge.shutdown();
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
