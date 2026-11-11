package com.ajeitaai.tiagenteos;

import android.net.Uri;
import android.net.http.SslError;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.util.Locale;

class SafeWebViewClient extends WebViewClient {
    protected final BaseWebActivity activity;

    SafeWebViewClient(BaseWebActivity activity) {
        this.activity = activity;
    }

    static boolean isWebUrl(Uri uri) {
        if (uri == null || uri.getScheme() == null) return false;
        String scheme = uri.getScheme().toLowerCase(Locale.ROOT);
        return "https".equals(scheme) || "http".equals(scheme);
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        Uri uri = request.getUrl();
        if ("about".equalsIgnoreCase(uri.getScheme())) return false;
        return !isWebUrl(uri);
    }

    @Override
    public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
        handler.cancel();
        Toast.makeText(activity, "Conexão segura não validada; página bloqueada.", Toast.LENGTH_LONG).show();
    }

    @Override
    public void onReceivedError(
            WebView view,
            WebResourceRequest request,
            WebResourceError error) {
        if (request.isForMainFrame()) {
            Toast.makeText(activity, "Não foi possível carregar esta página.", Toast.LENGTH_SHORT).show();
        }
    }
}
