package com.ajeitaai.tiagenteos;

import android.app.AlertDialog;
import android.app.DownloadManager;
import android.annotation.SuppressLint;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.Settings;
import android.view.Gravity;
import android.view.inputmethod.EditorInfo;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.URLUtil;
import android.webkit.WebBackForwardList;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import java.net.URLEncoder;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

public class BrowserActivity extends BaseWebActivity {
    static final String EXTRA_URL = "com.ajeitaai.tiagenteos.extra.URL";
    private static final String APK_MIME = "application/vnd.android.package-archive";
    private static final int REQUEST_INSTALL_SOURCE = 7302;

    private WebView webView;
    private EditText address;
    private ProgressBar progress;
    private Button backButton;
    private Button forwardButton;
    private final Map<Long, DownloadInfo> downloads = new HashMap<>();
    private Uri pendingInstallUri;
    private boolean downloadReceiverRegistered;

    private final BroadcastReceiver downloadReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
            DownloadInfo info = downloads.remove(id);
            if (info == null) return;
            finishDownload(id, info);
        }
    };

    static Intent createIntent(Context context, String url) {
        Intent intent = new Intent(context, BrowserActivity.class);
        intent.putExtra(EXTRA_URL, url);
        return intent;
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(34, 24, 75));
        getWindow().setNavigationBarColor(Color.rgb(18, 14, 42));
        LinearLayout root = createLayout();
        setContentView(root);
        registerDownloadReceiver();

        webView = new WebView(this);
        configureWebView(webView, false);
        webView.setWebViewClient(new SafeWebViewClient(this) {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("about".equalsIgnoreCase(uri.getScheme())) return false;
                if (!"https".equalsIgnoreCase(uri.getScheme())) {
                    Toast.makeText(BrowserActivity.this, "Por segurança, este navegador abre apenas páginas HTTPS.", Toast.LENGTH_SHORT).show();
                    return true;
                }
                return false;
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                super.onPageStarted(view, url, icon);
                address.setText(url);
                progress.setVisibility(ProgressBar.VISIBLE);
                updateNavigationButtons();
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                progress.setVisibility(ProgressBar.GONE);
                address.setText(url);
                updateNavigationButtons();
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int value) {
                progress.setProgress(value);
                progress.setVisibility(value >= 100 ? ProgressBar.GONE : ProgressBar.VISIBLE);
            }

            @Override
            public boolean onShowFileChooser(
                    WebView view,
                    android.webkit.ValueCallback<Uri[]> callback,
                    FileChooserParams params) {
                return showFilePicker(callback, params);
            }
        });
        webView.setDownloadListener(createDownloadListener());
        root.addView(webView, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));

        String initialUrl = getIntent().getStringExtra(EXTRA_URL);
        if (initialUrl == null || initialUrl.length() == 0) initialUrl = "https://html.duckduckgo.com/";
        loadAddress(initialUrl);
    }

    private LinearLayout createLayout() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(246, 244, 251));

        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setOrientation(LinearLayout.HORIZONTAL);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setPadding(dp(8), dp(8), dp(8), dp(8));
        toolbar.setBackgroundColor(Color.rgb(34, 24, 75));

        backButton = toolbarButton("Voltar");
        backButton.setContentDescription("Voltar na navegação");
        backButton.setEnabled(false);
        backButton.setOnClickListener(view -> {
            if (webView != null && webView.canGoBack()) webView.goBack();
        });
        toolbar.addView(backButton, new LinearLayout.LayoutParams(dp(60), dp(44)));

        forwardButton = toolbarButton("Avançar");
        forwardButton.setContentDescription("Avançar na navegação");
        forwardButton.setEnabled(false);
        forwardButton.setOnClickListener(view -> {
            if (webView != null && webView.canGoForward()) webView.goForward();
        });
        toolbar.addView(forwardButton, new LinearLayout.LayoutParams(dp(68), dp(44)));

        address = new EditText(this);
        address.setSingleLine(true);
        address.setTextColor(Color.rgb(28, 25, 45));
        address.setHintTextColor(Color.rgb(113, 107, 132));
        address.setHint("Endereço ou pesquisa");
        address.setTextSize(14);
        address.setInputType(android.text.InputType.TYPE_CLASS_TEXT
                | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        address.setImeOptions(EditorInfo.IME_ACTION_GO);
        address.setPadding(dp(12), 0, dp(12), 0);
        address.setBackgroundColor(Color.WHITE);
        address.setSelectAllOnFocus(true);
        address.setOnEditorActionListener((view, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_GO) {
                loadAddress(address.getText().toString());
                return true;
            }
            return false;
        });
        toolbar.addView(address, new LinearLayout.LayoutParams(0, dp(44), 1f));

        Button goButton = toolbarButton("Ir");
        goButton.setContentDescription("Abrir endereço");
        goButton.setOnClickListener(view -> loadAddress(address.getText().toString()));
        toolbar.addView(goButton, new LinearLayout.LayoutParams(dp(48), dp(44)));

        Button closeButton = toolbarButton("Fechar");
        closeButton.setContentDescription("Fechar navegador interno");
        closeButton.setOnClickListener(view -> finish());
        toolbar.addView(closeButton, new LinearLayout.LayoutParams(dp(64), dp(44)));

        root.addView(toolbar, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        progress.setProgressTintList(android.content.res.ColorStateList.valueOf(Color.rgb(109, 40, 217)));
        root.addView(progress, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(3)));

        TextView notice = new TextView(this);
        notice.setText("Navegação dentro do TIAgente OS. Downloads de APK exigem confirmação do Android.");
        notice.setTextColor(Color.rgb(77, 69, 103));
        notice.setTextSize(12);
        notice.setPadding(dp(12), dp(7), dp(12), dp(7));
        notice.setBackgroundColor(Color.rgb(238, 233, 250));
        root.addView(notice, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        return root;
    }

    private Button toolbarButton(String label) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextSize(12);
        button.setAllCaps(false);
        button.setTextColor(Color.WHITE);
        button.setBackgroundTintList(android.content.res.ColorStateList.valueOf(Color.rgb(79, 55, 139)));
        return button;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void loadAddress(String value) {
        String input = value == null ? "" : value.trim();
        if (input.length() == 0) return;
        String url;
        if (input.matches("(?i)^https://.*")) {
            url = input;
        } else if (input.matches("(?i)^[a-z0-9.-]+\\.[a-z]{2,}([/:?#].*)?$")) {
            url = "https://" + input;
        } else if (input.matches("(?i)^http://.*")) {
            Toast.makeText(this, "Use um endereço HTTPS para uma conexão protegida.", Toast.LENGTH_LONG).show();
            return;
        } else {
            String query;
            try {
                query = URLEncoder.encode(input, "UTF-8");
            } catch (java.io.UnsupportedEncodingException error) {
                query = input;
            }
            url = "https://html.duckduckgo.com/html/?q=" + query;
        }
        address.setText(url);
        webView.loadUrl(url);
    }

    private void updateNavigationButtons() {
        if (webView == null) return;
        WebBackForwardList history = webView.copyBackForwardList();
        int index = history.getCurrentIndex();
        backButton.setEnabled(index > 0);
        forwardButton.setEnabled(index >= 0 && index < history.getSize() - 1);
    }

    private DownloadListener createDownloadListener() {
        return (url, userAgent, contentDisposition, mimeType, contentLength) -> {
            if (url == null || !url.toLowerCase(Locale.ROOT).startsWith("https://")) {
                Toast.makeText(this, "Por segurança, downloads precisam usar HTTPS.", Toast.LENGTH_LONG).show();
                return;
            }
            String fileName = URLUtil.guessFileName(url, contentDisposition, mimeType);
            String host = Uri.parse(url).getHost();
            new AlertDialog.Builder(this)
                    .setTitle("Confirmar download")
                    .setMessage("Arquivo: " + fileName + "\nOrigem: " + host
                            + "\n\nBaixar este arquivo?")
                    .setNegativeButton("Cancelar", null)
                    .setPositiveButton("Baixar", (dialog, which) ->
                            enqueueDownload(url, userAgent, fileName, mimeType))
                    .show();
        };
    }

    private void enqueueDownload(String url, String userAgent, String fileName, String mimeType) {
        try {
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.setTitle(fileName);
            request.setDescription("Download pelo TIAgente OS");
            request.setNotificationVisibility(
                    DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setAllowedOverRoaming(false);
            request.setDestinationInExternalFilesDir(
                    this, Environment.DIRECTORY_DOWNLOADS, fileName);
            if (mimeType != null) request.setMimeType(mimeType);
            if (userAgent != null) request.addRequestHeader("User-Agent", userAgent);
            String cookie = CookieManager.getInstance().getCookie(url);
            if (cookie != null) request.addRequestHeader("Cookie", cookie);
            long id = ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(request);
            downloads.put(id, new DownloadInfo(fileName, mimeType));
            Toast.makeText(this, "Download iniciado.", Toast.LENGTH_SHORT).show();
        } catch (Exception error) {
            Toast.makeText(this, "Não foi possível iniciar o download.", Toast.LENGTH_LONG).show();
        }
    }

    @SuppressLint("UnspecifiedRegisterReceiverFlag")
    private void registerDownloadReceiver() {
        IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(downloadReceiver, filter, Context.RECEIVER_EXPORTED);
        } else {
            registerReceiver(downloadReceiver, filter);
        }
        downloadReceiverRegistered = true;
    }

    private void finishDownload(long id, DownloadInfo info) {
        DownloadManager manager = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
        Cursor cursor = manager.query(new DownloadManager.Query().setFilterById(id));
        if (cursor == null) return;
        boolean successful = false;
        try {
            if (cursor.moveToFirst()) {
                int statusIndex = cursor.getColumnIndex(DownloadManager.COLUMN_STATUS);
                successful = statusIndex >= 0
                        && cursor.getInt(statusIndex) == DownloadManager.STATUS_SUCCESSFUL;
            }
        } finally {
            cursor.close();
        }
        if (!successful) {
            Toast.makeText(this, "O download não foi concluído.", Toast.LENGTH_LONG).show();
            return;
        }
        boolean isApk = info.fileName.toLowerCase(Locale.ROOT).endsWith(".apk")
                || APK_MIME.equalsIgnoreCase(info.mimeType);
        if (!isApk) {
            Toast.makeText(this, "Arquivo baixado no armazenamento do TIAgente OS.", Toast.LENGTH_LONG).show();
            return;
        }
        pendingInstallUri = manager.getUriForDownloadedFile(id);
        if (pendingInstallUri == null) {
            Toast.makeText(this, "Não foi possível abrir o instalador do Android.", Toast.LENGTH_LONG).show();
            return;
        }
        new AlertDialog.Builder(this)
                .setTitle("APK baixado")
                .setMessage("Instale apenas aplicativos de fontes confiáveis. O Android verificará o pacote e pedirá confirmação.")
                .setNegativeButton("Agora não", null)
                .setPositiveButton("Revisar instalação", (dialog, which) -> requestInstall())
                .show();
    }

    private void requestInstall() {
        if (pendingInstallUri == null) return;
        if (!getPackageManager().canRequestPackageInstalls()) {
            new AlertDialog.Builder(this)
                    .setTitle("Permissão do Android")
                    .setMessage("Para instalar este APK, autorize o TIAgente OS em “Instalar apps desconhecidos”. A instalação ainda será confirmada pelo Android.")
                    .setNegativeButton("Cancelar", null)
                    .setPositiveButton("Abrir configuração", (dialog, which) -> {
                        Intent settings = new Intent(
                                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                Uri.parse("package:" + getPackageName()));
                        startActivityForResult(settings, REQUEST_INSTALL_SOURCE);
                    })
                    .show();
            return;
        }
        confirmInstall();
    }

    private void confirmInstall() {
        new AlertDialog.Builder(this)
                .setTitle("Continuar instalação?")
                .setMessage("O instalador oficial do Android será aberto. Revise o nome e as permissões do APK antes de confirmar.")
                .setNegativeButton("Cancelar", null)
                .setPositiveButton("Abrir instalador", (dialog, which) -> openSystemInstaller())
                .show();
    }

    private void openSystemInstaller() {
        if (pendingInstallUri == null) return;
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(pendingInstallUri, APK_MIME);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            startActivity(intent);
        } catch (Exception error) {
            Toast.makeText(this, "O Android não conseguiu abrir o instalador.", Toast.LENGTH_LONG).show();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQUEST_INSTALL_SOURCE
                && getPackageManager().canRequestPackageInstalls()) {
            confirmInstall();
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        finish();
    }

    @Override
    protected void onDestroy() {
        if (downloadReceiverRegistered) {
            unregisterReceiver(downloadReceiver);
            downloadReceiverRegistered = false;
        }
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private static final class DownloadInfo {
        final String fileName;
        final String mimeType;

        DownloadInfo(String fileName, String mimeType) {
            this.fileName = fileName;
            this.mimeType = mimeType;
        }
    }
}
