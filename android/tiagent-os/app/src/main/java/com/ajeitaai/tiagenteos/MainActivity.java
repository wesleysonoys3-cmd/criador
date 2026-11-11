package com.ajeitaai.tiagenteos;

import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.WebChromeClient;
import android.webkit.WebBackForwardList;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.widget.Toast;

public class MainActivity extends BaseWebActivity {
    private static final String START_URL = "https://criador.onrender.com/tiagent-os/";
    private static final String APP_HOST = "criador.onrender.com";
    private WebView webView;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(34, 24, 75));
        getWindow().setNavigationBarColor(Color.rgb(18, 14, 42));

        webView = new WebView(this);
        webView.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        configureWebView(webView, true);
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(
                    WebView view,
                    android.webkit.ValueCallback<Uri[]> callback,
                    FileChooserParams params) {
                return showFilePicker(callback, params);
            }
        });
        webView.setWebViewClient(new SafeWebViewClient(this) {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("about".equalsIgnoreCase(uri.getScheme())) return false;
                if (!"https".equalsIgnoreCase(uri.getScheme())) {
                    Toast.makeText(MainActivity.this, "O aplicativo abre somente páginas HTTPS.", Toast.LENGTH_SHORT).show();
                    return true;
                }
                if (APP_HOST.equalsIgnoreCase(uri.getHost())) return false;
                openBrowser(uri);
                return true;
            }
        });
        setContentView(webView);

        WebBackForwardList restored = state == null ? null : webView.restoreState(state);
        if (restored == null || restored.getSize() == 0) webView.loadUrl(START_URL);
    }

    private void openBrowser(Uri uri) {
        startActivity(BrowserActivity.createIntent(this, uri.toString()));
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle state) {
        if (webView != null) webView.saveState(state);
        super.onSaveInstanceState(state);
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
