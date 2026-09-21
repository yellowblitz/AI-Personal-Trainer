package com.yellowblitz.trainer;

import android.app.Activity;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class DeepSeekBridge {
    private static final String ENDPOINT = "https://api.deepseek.com/chat/completions";
    private final Activity activity;
    private final WebView web;
    private final DeepSeekKeyVault vault;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    public DeepSeekBridge(Activity activity, WebView web, DeepSeekKeyVault vault) {
        this.activity = activity;
        this.web = web;
        this.vault = vault;
    }

    @JavascriptInterface public void request(String requestId, String jsonBody) {
        if (requestId == null || requestId.length() > 80 || jsonBody == null || jsonBody.length() > 900000) {
            reply(requestId, 400, "{\"error\":{\"message\":\"Invalid DeepSeek request.\"}}");
            return;
        }
        executor.execute(() -> executeRequest(requestId, jsonBody));
    }

    private void executeRequest(String requestId, String jsonBody) {
        HttpURLConnection connection = null;
        try {
            String apiKey = vault.getKey();
            if (apiKey == null || apiKey.trim().isEmpty()) {
                reply(requestId, 401, "{\"error\":{\"message\":\"DeepSeek API key is missing.\"}}");
                return;
            }
            URL url = new URL(ENDPOINT);
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(30000);
            connection.setReadTimeout(120000);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("Authorization", "Bearer " + apiKey.trim());

            byte[] bytes = jsonBody.getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream out = connection.getOutputStream()) {
                out.write(bytes);
            }

            int status = connection.getResponseCode();
            InputStream stream = status >= 200 && status < 400 ? connection.getInputStream() : connection.getErrorStream();
            String body = readLimited(stream, 4000000);
            reply(requestId, status, body);
        } catch (Exception e) {
            String message = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
            reply(requestId, 0, "{\"error\":{\"message\":" + JSONObject.quote(message) + "}}");
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static String readLimited(InputStream stream, int maxChars) throws Exception {
        if (stream == null) return "";
        StringBuilder out = new StringBuilder();
        char[] buffer = new char[8192];
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            int read;
            while ((read = reader.read(buffer)) >= 0) {
                int remaining = maxChars - out.length();
                if (remaining <= 0) break;
                out.append(buffer, 0, Math.min(read, remaining));
            }
        }
        return out.toString();
    }

    private void reply(String requestId, int status, String body) {
        String id = requestId == null ? "" : requestId;
        String safeBody = body == null ? "" : body;
        activity.runOnUiThread(() -> {
            if (web == null) return;
            web.evaluateJavascript(
                "window.__deepSeekNativeResolve && window.__deepSeekNativeResolve(" +
                    JSONObject.quote(id) + "," + status + "," + JSONObject.quote(safeBody) + ");",
                null
            );
        });
    }

    public void shutdown() {
        executor.shutdownNow();
    }
}
