package com.ajeitaai.tiagenteos;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Toast;

abstract class BaseWebActivity extends Activity {
    private static final int REQUEST_PICK_FILE = 7301;
    private ValueCallback<Uri[]> fileCallback;

    protected void configureWebView(WebView webView, boolean markNativeHost) {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSafeBrowsingEnabled(true);
        if (markNativeHost) {
            settings.setUserAgentString(
                    settings.getUserAgentString() + " TIAgenteOSNative/1.0");
        }
        CookieManager.getInstance().setAcceptCookie(true);
        webView.setWebViewClient(new SafeWebViewClient(this));
    }

    protected boolean showFilePicker(
            ValueCallback<Uri[]> callback,
            WebChromeClient.FileChooserParams params) {
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        fileCallback = callback;
        try {
            Intent intent = params.createIntent();
            startActivityForResult(intent, REQUEST_PICK_FILE);
            return true;
        } catch (Exception error) {
            fileCallback = null;
            callback.onReceiveValue(null);
            Toast.makeText(this, "Não foi possível abrir os arquivos.", Toast.LENGTH_SHORT).show();
            return false;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQUEST_PICK_FILE || fileCallback == null) return;
        Uri[] result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
        fileCallback.onReceiveValue(result);
        fileCallback = null;
    }

    @Override
    protected void onDestroy() {
        if (fileCallback != null) {
            fileCallback.onReceiveValue(null);
            fileCallback = null;
        }
        super.onDestroy();
    }
}
