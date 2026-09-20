package com.yellowblitz.trainer;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.*;
import android.content.Intent;
import android.content.ClipboardManager;
import android.content.ClipData;
import android.content.Context;
import android.net.Uri;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.Toast;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;

public class MainActivity extends Activity {
    private FrameLayout root;
    private WebView web;
    private WebView chatWeb;
    private LinearLayout chatContainer;
    private String pendingSharedText;
    private boolean pageReady = false;
    private int systemTopInset = 0;
    private int systemBottomInset = 0;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        captureSharedText(getIntent());
        getWindow().setStatusBarColor(0xff101915);
        getWindow().setNavigationBarColor(0xff101915);

        root = new FrameLayout(this);
        web = buildTrainerWebView();
        chatContainer = buildEmbeddedChatGPT();

        root.addView(web, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(chatContainer, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        chatContainer.setVisibility(View.GONE);

        root.setOnApplyWindowInsetsListener((v, insets) -> {
            systemTopInset = Math.max(0, insets.getSystemWindowInsetTop());
            systemBottomInset = Math.max(0, insets.getSystemWindowInsetBottom());
            web.setPadding(Math.max(0, insets.getSystemWindowInsetLeft()), 0,
                Math.max(0, insets.getSystemWindowInsetRight()), 0);
            applySystemInsetsToWeb();
            return insets;
        });

        setContentView(root);
        web.loadUrl("https://appassets.androidplatform.net/assets/index.html");
        root.requestApplyInsets();
    }

    private WebView buildTrainerWebView() {
        WebView trainer = new WebView(this);
        trainer.setBackgroundColor(0xff101915);
        WebSettings settings = trainer.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        // Native bridges exist only on the trusted packaged trainer origin.
        trainer.addJavascriptInterface(new KeyVault(this), "TrainerKeys");
        trainer.addJavascriptInterface(new ShareBridge(), "TrainerShare");
        trainer.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri uri = req.getUrl();
                if ("https".equals(uri.getScheme()) && "aistudio.google.com".equals(uri.getHost())) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception ignored) { }
                    return true;
                }
                return !("https".equals(uri.getScheme())
                    && "appassets.androidplatform.net".equals(uri.getHost())
                    && "/assets/index.html".equals(uri.getPath()));
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (url != null && url.startsWith("https://appassets.androidplatform.net/assets/index.html")) {
                    pageReady = true;
                    applySystemInsetsToWeb();
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
        return trainer;
    }

    private LinearLayout buildEmbeddedChatGPT() {
        LinearLayout shell = new LinearLayout(this);
        shell.setOrientation(LinearLayout.VERTICAL);
        shell.setBackgroundColor(0xff101915);

        chatWeb = new WebView(this);
        chatWeb.setBackgroundColor(0xff101915);
        WebSettings chatSettings = chatWeb.getSettings();
        chatSettings.setJavaScriptEnabled(true);
        chatSettings.setDomStorageEnabled(true);
        chatSettings.setDatabaseEnabled(true);
        chatSettings.setAllowFileAccess(false);
        chatSettings.setAllowContentAccess(true);
        chatSettings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        chatSettings.setMediaPlaybackRequiresUserGesture(true);
        chatSettings.setSupportMultipleWindows(false);
        chatSettings.setCacheMode(WebSettings.LOAD_DEFAULT);
        chatSettings.setSaveFormData(true);

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(chatWeb, true);

        // Deliberately no addJavascriptInterface() calls on chatWeb.
        chatWeb.setWebChromeClient(new WebChromeClient());
        chatWeb.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri uri = req.getUrl();
                String scheme = uri.getScheme();
                if ("http".equals(scheme) || "https".equals(scheme)) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception ignored) { }
                return true;
            }
            @Override public void onPageFinished(WebView view, String url) {
                CookieManager.getInstance().flush();
                applyChatFocusMode(url);
            }
            @Override public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
                super.doUpdateVisitedHistory(view, url, isReload);
                applyChatFocusMode(url);
            }
        });
        shell.addView(chatWeb, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        return shell;
    }

    private void applyChatFocusMode(String url) {
        if (chatWeb == null || url == null) return;
        Uri uri;
        try { uri = Uri.parse(url); } catch (Exception e) { return; }
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase();
        String lower = url.toLowerCase();

        // Leave authentication pages intact so first-time sign-in remains usable.
        boolean loginPage = host.endsWith("auth.openai.com")
            || lower.contains("/auth/")
            || lower.contains("/login")
            || lower.contains("/signin");
        if (loginPage || !(host.equals("chatgpt.com") || host.endsWith(".chatgpt.com"))) return;

        String script =
            "(function(){" +
            "const STYLE_ID='trainer-focus-style';" +
            "let s=document.getElementById(STYLE_ID);" +
            "if(!s){s=document.createElement('style');s.id=STYLE_ID;" +
            "s.textContent=\"" +
            "#stage-slideover-sidebar,aside,header," +
            "nav[aria-label*='chat history' i]," +
            "[data-testid='sidebar'],[data-testid='open-sidebar-button']," +
            "[data-testid='close-sidebar-button'],[data-testid='model-switcher-dropdown-button']," +
            "[data-testid='share-chat-button'],[data-testid='conversation-options-button']," +
            "[data-testid='profile-button'],[data-testid='new-chat-button']," +
            "button[aria-label*='sidebar' i],button[aria-label*='temporary chat' i]," +
            "button[aria-label*='attach' i],button[aria-label*='voice' i]," +
            "button[aria-label*='dictate' i],button[aria-label*='tools' i]{display:none!important;}" +
            "main{margin-left:0!important;width:100%!important;max-width:100%!important;}" +
            "body{overflow-x:hidden!important;}" +
            "\";document.head.appendChild(s);}" +
            "const tidy=()=>{" +
            "document.querySelectorAll('button').forEach(b=>{" +
            "const a=(b.getAttribute('aria-label')||'').toLowerCase();" +
            "if(a.includes('sidebar')||a.includes('temporary chat')||a.includes('share chat')||a.includes('model selector'))b.style.display='none';" +
            "});" +
            "};tidy();" +
            "if(!window.__trainerFocusObserver){window.__trainerFocusObserver=new MutationObserver(tidy);window.__trainerFocusObserver.observe(document.documentElement,{childList:true,subtree:true});}" +
            "})();";
        chatWeb.evaluateJavascript(script, null);
    }

    // The trusted trainer page supplies the rectangle of its inline chat slot.
    // ChatGPT stays in an isolated native WebView, sized only to that rectangle.
    private void positionInlineChat(double x, double y, double width, double height, double viewportWidth) {
        if (!Double.isFinite(x) || !Double.isFinite(y) || !Double.isFinite(width)
                || !Double.isFinite(height) || !Double.isFinite(viewportWidth) || viewportWidth <= 0) return;
        runOnUiThread(() -> {
            float scale = web.getWidth() / (float) viewportWidth;
            int left = Math.max(0, Math.round((float)x * scale));
            int top = Math.max(0, Math.round((float)y * scale));
            int right = Math.min(root.getWidth(), Math.round((float)(x + width) * scale));
            int bottom = Math.min(root.getHeight(), Math.round((float)(y + height) * scale));
            if (right <= left || bottom <= top) { closeEmbeddedChatGPT(); return; }
            FrameLayout.LayoutParams bounds = new FrameLayout.LayoutParams(right-left, bottom-top);
            bounds.leftMargin = left;
            bounds.topMargin = top;
            chatContainer.setLayoutParams(bounds);
            chatContainer.setVisibility(View.VISIBLE);
            if (chatWeb.getUrl() == null) chatWeb.loadUrl("https://chatgpt.com/");
        });
    }

    private void closeEmbeddedChatGPT() {
        chatContainer.setVisibility(View.GONE);
    }

    private void useClipboardAsTrainerResponse() {
        ClipboardManager clipboard = (ClipboardManager)getSystemService(Context.CLIPBOARD_SERVICE);
        if (clipboard == null || !clipboard.hasPrimaryClip() || clipboard.getPrimaryClip() == null
            || clipboard.getPrimaryClip().getItemCount() == 0) {
            Toast.makeText(this, "Copy a ChatGPT response first.", Toast.LENGTH_SHORT).show();
            return;
        }
        CharSequence value = clipboard.getPrimaryClip().getItemAt(0).coerceToText(this);
        if (value == null || value.toString().trim().isEmpty()) {
            Toast.makeText(this, "Clipboard text is empty.", Toast.LENGTH_SHORT).show();
            return;
        }
        pendingSharedText = value.toString().trim().substring(0, Math.min(value.toString().trim().length(), 50000));
        flushSharedText();
    }

    private void applySystemInsetsToWeb() {
        if (!pageReady || web == null) return;
        final float density = getResources().getDisplayMetrics().density;
        final int top = Math.round(systemTopInset / density);
        final int bottom = Math.round(systemBottomInset / density);
        web.post(() -> web.evaluateJavascript(
            "document.documentElement.style.setProperty('--system-top-inset','" + top + "px');" +
            "document.documentElement.style.setProperty('--system-bottom-inset','" + bottom + "px'); if(window.syncInlineChat) window.syncInlineChat();",
            null
        ));
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
        web.post(() -> web.evaluateJavascript(
            "window.__trainerSharedText=" + payload + "; if(window.receiveTrainerShare){window.receiveTrainerShare(window.__trainerSharedText); window.__trainerSharedText=\"\";}",
            null));
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
        @JavascriptInterface public void positionChat(double x, double y, double width, double height, double viewportWidth) {
            positionInlineChat(x, y, width, height, viewportWidth);
        }
        @JavascriptInterface public void hideChat() {
            runOnUiThread(() -> closeEmbeddedChatGPT());
        }
        @JavascriptInterface public void reloadChat() {
            runOnUiThread(() -> { if (chatWeb.getUrl() != null) chatWeb.reload(); });
        }
        // Use copied response: clipboard is read only after an explicit trainer button tap.
        @JavascriptInterface public void useCopiedResponse() {
            runOnUiThread(() -> useClipboardAsTrainerResponse());
        }
    }

    @Override public void onBackPressed() {
        if (chatContainer != null && chatContainer.getVisibility() == View.VISIBLE) {
            if (chatWeb != null && chatWeb.canGoBack()) chatWeb.goBack();
            else web.evaluateJavascript("window.showTrainerWorkout && window.showTrainerWorkout();", null);
            return;
        }
        if (web.canGoBack()) web.goBack(); else super.onBackPressed();
    }

    @Override protected void onPause() {
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override public void onDestroy() {
        CookieManager.getInstance().flush();
        if (chatWeb != null) chatWeb.destroy();
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
