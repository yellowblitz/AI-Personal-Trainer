package com.yellowblitz.trainer;

import android.app.Activity;
import android.net.Uri;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.GetCredentialException;
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;
import org.json.JSONObject;
import java.security.SecureRandom;
import java.util.Base64;

public final class GoogleAuthBridge {
    private final Activity activity;
    private final WebView web;
    private final CredentialManager credentialManager;
    private final SecureRandom random = new SecureRandom();

    public GoogleAuthBridge(Activity activity, WebView web) {
        this.activity = activity;
        this.web = web;
        this.credentialManager = CredentialManager.create(activity);
    }

    @JavascriptInterface public void signIn(String webClientId) {
        if (webClientId == null || webClientId.trim().isEmpty() || webClientId.length() > 512) {
            error("Google OAuth Web Client ID is not configured.");
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                GetSignInWithGoogleOption option = new GetSignInWithGoogleOption.Builder(webClientId.trim())
                    .setNonce(makeNonce())
                    .build();
                GetCredentialRequest request = new GetCredentialRequest.Builder()
                    .addCredentialOption(option)
                    .build();

                credentialManager.getCredentialAsync(
                    activity,
                    request,
                    null,
                    activity.getMainExecutor(),
                    new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                        @Override public void onResult(GetCredentialResponse result) {
                            handleCredential(result.getCredential());
                        }
                        @Override public void onError(GetCredentialException e) {
                            error(e.getMessage() == null ? "Google sign-in was cancelled or unavailable." : e.getMessage());
                        }
                    }
                );
            } catch (Exception e) {
                error(e.getMessage() == null ? "Could not start Google sign-in." : e.getMessage());
            }
        });
    }

    private String makeNonce() {
        byte[] bytes = new byte[24];
        random.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private void handleCredential(Credential credential) {
        try {
            if (!(credential instanceof CustomCredential)) throw new IllegalStateException("Unsupported Google credential.");
            CustomCredential custom = (CustomCredential) credential;
            if (!GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(custom.getType()))
                throw new IllegalStateException("Unexpected credential type.");
            GoogleIdTokenCredential google = GoogleIdTokenCredential.createFrom(custom.getData());
            JSONObject data = new JSONObject();
            data.put("uniqueId", google.getUniqueId());
            data.put("email", google.getEmail());
            data.put("name", google.getDisplayName());
            Uri picture = google.getProfilePictureUri();
            data.put("picture", picture == null ? JSONObject.NULL : picture.toString());
            data.put("localProfileOnly", true);
            success(data);
        } catch (Exception e) {
            error(e.getMessage() == null ? "Could not read Google account." : e.getMessage());
        }
    }

    private void success(JSONObject data) {
        activity.runOnUiThread(() -> web.evaluateJavascript(
            "window.onTrainerGoogleSignIn && window.onTrainerGoogleSignIn(" + data.toString() + ");", null));
    }

    private void error(String message) {
        String safe = message == null ? "Google sign-in failed." : message;
        activity.runOnUiThread(() -> web.evaluateJavascript(
            "window.onTrainerGoogleSignInError && window.onTrainerGoogleSignInError(" + JSONObject.quote(safe) + ");", null));
    }
}
