// SPDX-License-Identifier: MPL-2.0
package com.protpeek.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.res.Configuration;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

import androidx.core.content.FileProvider;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** A single trusted, bundled WebView with native document and sharing actions. */
public final class MainActivity extends Activity {
    private static final String APP_HOST = "appassets.androidplatform.net";
    private static final String ENTRY_URL = "https://" + APP_HOST + "/assets/www/index.html";
    private static final int OPEN_DOCUMENT = 10;
    private static final int CREATE_DOCUMENT = 11;
    private static final int MAX_BYTES = 32 * 1024 * 1024;
    private static final int MAX_BASE64_CHARS = 4 * ((MAX_BYTES + 2) / 3);
    private static final long CACHE_RETENTION_MS = 24L * 60 * 60 * 1000;
    private static final Set<String> STRUCTURE_EXTENSIONS = new HashSet<>(Arrays.asList("pdb", "cif", "mmcif", "bcif", "gro"));
    private static final Set<String> NETWORK_HOSTS = new HashSet<>(Arrays.asList("models.rcsb.org", "files.rcsb.org", "alphafold.ebi.ac.uk",
            "rest.uniprot.org", "search.rcsb.org", "data.rcsb.org", "www.ebi.ac.uk"));
    private static final Set<String> EXPORT_MIMES = new HashSet<>(Arrays.asList("image/png", "chemical/x-cif", "chemical/x-pdb", "text/plain", "application/octet-stream"));
    private static final String CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            + "img-src 'self' data: blob:; connect-src 'self' https://models.rcsb.org https://files.rcsb.org https://alphafold.ebi.ac.uk "
            + "https://rest.uniprot.org https://search.rcsb.org https://data.rcsb.org https://www.ebi.ac.uk; "
            + "worker-src 'self' blob:; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";

    private final ExecutorService files = Executors.newSingleThreadExecutor();
    private FrameLayout root;
    private WebView webView;
    private boolean pageReady;
    private boolean pickerOpen;
    private String pendingError;
    private File importedFile;
    private String importedName;
    private String importedMime;
    private File pendingImport;
    private ExportData pendingExport;
    private OnBackInvokedCallback backCallback;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        root = new FrameLayout(this);
        root.setBackgroundColor(isDarkTheme() ? Color.rgb(20, 26, 32) : Color.WHITE);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                android.graphics.Insets keyboard = insets.getInsets(WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, keyboard.bottom));
            } else {
                view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                        insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });
        setContentView(root);
        if (Build.VERSION.SDK_INT >= 33) {
            backCallback = this::handleBack;
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, backCallback);
        }
        restoreImportedFile(state);
        createWebView();
        root.requestApplyInsets();
        if (state == null) acceptIntent(getIntent());
        files.execute(this::cleanOldSharedFiles);
    }

    private boolean isDarkTheme() {
        return (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
    }

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    private void createWebView() {
        pageReady = false;
        WebView view = new WebView(this);
        webView = view;
        view.setBackgroundColor(isDarkTheme() ? Color.rgb(20, 26, 32) : Color.WHITE);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setSafeBrowsingEnabled(true);
        view.addJavascriptInterface(new NativeBridge(), "ProtPeekAndroid");
        WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        view.setWebViewClient(new WebViewClientCompat() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView current, WebResourceRequest request) {
                Uri uri = request.getUrl();
                WebResourceResponse asset = loader.shouldInterceptRequest(uri);
                if (asset != null) {
                    Map<String, String> headers = new HashMap<>();
                    if (asset.getResponseHeaders() != null) headers.putAll(asset.getResponseHeaders());
                    headers.put("Content-Security-Policy", CSP);
                    headers.put("X-Content-Type-Options", "nosniff");
                    asset.setResponseHeaders(headers);
                    return asset;
                }
                if ("https".equals(uri.getScheme()) && NETWORK_HOSTS.contains(uri.getHost())) return null;
                return new WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", Collections.emptyMap(),
                        new ByteArrayInputStream("Not available in ProtPeek".getBytes(StandardCharsets.UTF_8)));
            }

            @Override public boolean shouldOverrideUrlLoading(WebView current, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (isTrusted(uri)) return false;
                if (request.isForMainFrame() && "https".equals(uri.getScheme())) openExternal(uri);
                return true;
            }

            @Override public void onPageStarted(WebView current, String url, android.graphics.Bitmap favicon) {
                pageReady = false;
                if (!isTrusted(Uri.parse(url))) current.stopLoading();
            }

            @Override public boolean onRenderProcessGone(WebView current, RenderProcessGoneDetail detail) {
                pageReady = false;
                root.removeView(current);
                current.removeJavascriptInterface("ProtPeekAndroid");
                current.destroy();
                if (webView == current) webView = null;
                if (!isFinishing() && !isDestroyed()) new AlertDialog.Builder(MainActivity.this)
                        .setTitle("Reopen ProtPeek")
                        .setMessage("Android stopped the 3D view. Reopen the last local structure?")
                        .setPositiveButton("Reopen", (dialog, which) -> {
                            pendingImport = importedFile;
                            createWebView();
                        }).setNegativeButton("Close", (dialog, which) -> finish()).show();
                return true;
            }
        });
        root.addView(view, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        view.loadUrl(ENTRY_URL);
    }

    private static boolean isTrusted(Uri uri) {
        return "https".equals(uri.getScheme()) && APP_HOST.equals(uri.getHost())
                && (uri.getPort() == -1 || uri.getPort() == 443)
                && uri.getPath() != null && uri.getPath().startsWith("/assets/www/");
    }

    private void trusted(Runnable action) {
        runOnUiThread(() -> {
            if (isFinishing() || isDestroyed() || webView == null) return;
            String url = webView.getUrl();
            if (url != null && isTrusted(Uri.parse(url))) action.run();
        });
    }

    private final class NativeBridge {
        @JavascriptInterface public void ready() {
            trusted(() -> {
                pageReady = true;
                if (pendingError != null) {
                    String message = pendingError;
                    pendingError = null;
                    emitError(message);
                }
                if (pendingImport != null) {
                    File file = pendingImport;
                    pendingImport = null;
                    deliverFile(file, importedName, importedMime);
                }
            });
        }

        @JavascriptInterface public void openFile() {
            trusted(MainActivity.this::chooseFile);
        }

        @JavascriptInterface public void exportFile(String json) {
            trusted(() -> prepareExport(json, false));
        }

        @JavascriptInterface public void shareFile(String json) {
            trusted(() -> prepareExport(json, true));
        }
    }

    private void chooseFile() {
        if (pickerOpen) return;
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            pickerOpen = true;
            startActivityForResult(intent, OPEN_DOCUMENT);
        } catch (ActivityNotFoundException error) {
            pickerOpen = false;
            emitError("No document picker is available.");
        }
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        acceptIntent(intent);
    }

    private void acceptIntent(Intent intent) {
        if (intent == null) return;
        Uri uri = null;
        if (Intent.ACTION_VIEW.equals(intent.getAction())) uri = intent.getData();
        else if (Intent.ACTION_SEND.equals(intent.getAction())) {
            if (Build.VERSION.SDK_INT >= 33) uri = intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
            else uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (uri == null && intent.getClipData() != null && intent.getClipData().getItemCount() > 0)
                uri = intent.getClipData().getItemAt(0).getUri();
        }
        if (uri != null) importUri(uri);
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == OPEN_DOCUMENT) {
            pickerOpen = false;
            if (resultCode == RESULT_OK && data != null && data.getData() != null) importUri(data.getData());
        } else if (requestCode == CREATE_DOCUMENT) {
            ExportData export = pendingExport;
            pendingExport = null;
            if (export == null) return;
            if (resultCode != RESULT_OK || data == null || data.getData() == null) {
                export.file.delete();
                return;
            }
            Uri destination = data.getData();
            files.execute(() -> {
                try (InputStream input = new FileInputStream(export.file);
                     OutputStream output = getContentResolver().openOutputStream(destination, "w")) {
                    if (output == null) throw new IOException("Could not create the export file.");
                    copyLimited(input, output, MAX_BYTES);
                    emit("protpeek:export-complete", json("filename", export.filename));
                } catch (Exception error) {
                    emitError("The export could not be saved.");
                } finally {
                    export.file.delete();
                }
            });
        }
    }

    private void importUri(Uri uri) {
        if (!"content".equals(uri.getScheme())) {
            emitError("Choose a document from the Android file picker.");
            return;
        }
        files.execute(() -> {
            File copied = null;
            try {
                String filename = displayName(uri);
                int dot = filename.lastIndexOf('.');
                String extension = dot < 0 ? "" : filename.substring(dot + 1).toLowerCase(Locale.ROOT);
                if (!STRUCTURE_EXTENSIONS.contains(extension)) throw new IOException("Choose a PDB, CIF, mmCIF, BCIF or GRO file.");
                File directory = new File(getCacheDir(), "imports");
                if (!directory.exists() && !directory.mkdirs()) throw new IOException("Could not prepare the document.");
                copied = new File(directory, UUID.randomUUID() + "-" + safeFilename(filename));
                try (InputStream input = getContentResolver().openInputStream(uri);
                     OutputStream output = new FileOutputStream(copied)) {
                    if (input == null) throw new IOException("This document could not be opened.");
                    if (copyLimited(input, output, MAX_BYTES) == 0) throw new IOException("The selected document is empty.");
                }
                String mime = getContentResolver().getType(uri);
                if (mime == null) mime = "application/octet-stream";
                File staged = copied;
                String type = mime;
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) { staged.delete(); return; }
                    File previous = importedFile;
                    importedFile = staged;
                    importedName = filename;
                    importedMime = type;
                    if (previous != null && !previous.equals(staged)) previous.delete();
                    if (pageReady) deliverFile(staged, filename, type);
                    else pendingImport = staged;
                });
            } catch (Exception error) {
                if (copied != null) copied.delete();
                emitError(error.getMessage() == null ? "This document could not be opened." : error.getMessage());
            }
        });
    }

    private String displayName(Uri uri) throws IOException {
        try (Cursor cursor = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int sizeColumn = cursor.getColumnIndex(OpenableColumns.SIZE);
                if (sizeColumn >= 0 && !cursor.isNull(sizeColumn) && cursor.getLong(sizeColumn) > MAX_BYTES)
                    throw new IOException("The document is larger than 32 MiB.");
                int nameColumn = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (nameColumn >= 0 && !cursor.isNull(nameColumn)) return safeFilename(cursor.getString(nameColumn));
            }
        }
        return safeFilename(uri.getLastPathSegment());
    }

    private void deliverFile(File file, String name, String mimeType) {
        files.execute(() -> {
            try (InputStream input = new FileInputStream(file); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
                copyLimited(input, bytes, MAX_BYTES);
                JSONObject detail = new JSONObject();
                detail.put("name", name);
                detail.put("mimeType", mimeType);
                detail.put("base64", Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP));
                emit("protpeek:file-opened", detail);
            } catch (Exception error) {
                emitError("The local document could not be read.");
            }
        });
    }

    private void prepareExport(String payload, boolean share) {
        if (pendingExport != null && !share) { emitError("Finish the current save first."); return; }
        files.execute(() -> {
            ExportData export = null;
            try {
                if (payload == null || payload.length() > MAX_BASE64_CHARS + 8192) throw new IOException("The export is too large.");
                JSONObject object = new JSONObject(payload);
                String filename = safeFilename(object.optString("filename", "ProtPeek-export.bin"));
                String mimeType = object.optString("mimeType", "application/octet-stream");
                if (!EXPORT_MIMES.contains(mimeType)) throw new IOException("Unsupported export format.");
                boolean hasText = object.has("text") && !object.isNull("text");
                boolean hasBase64 = object.has("base64") && !object.isNull("base64");
                if (hasText == hasBase64) throw new IOException("The export needs exactly one data field.");
                byte[] bytes;
                if (hasText) {
                    String text = object.getString("text");
                    if (text.length() > MAX_BYTES) throw new IOException("The export is larger than 32 MiB.");
                    bytes = text.getBytes(StandardCharsets.UTF_8);
                } else {
                    String encoded = object.getString("base64");
                    if (encoded.length() > MAX_BASE64_CHARS) throw new IOException("The export is larger than 32 MiB.");
                    bytes = Base64.decode(encoded, Base64.DEFAULT);
                }
                if (bytes.length == 0 || bytes.length > MAX_BYTES) throw new IOException("The export must contain between 1 byte and 32 MiB.");
                File folder = new File(getCacheDir(), share ? "shared/" + UUID.randomUUID() : "exports");
                if (!folder.exists() && !folder.mkdirs()) throw new IOException("Could not prepare the export.");
                File file = share ? new File(folder, filename) : File.createTempFile("export-", ".tmp", folder);
                try (OutputStream stream = new FileOutputStream(file)) { stream.write(bytes); }
                export = new ExportData(file, filename, mimeType);
                ExportData ready = export;
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) { ready.file.delete(); return; }
                    if (share) shareExport(ready);
                    else chooseExportDestination(ready);
                });
            } catch (Exception error) {
                if (export != null) export.file.delete();
                emitError(error.getMessage() == null ? "The export could not be prepared." : error.getMessage());
            }
        });
    }

    private void chooseExportDestination(ExportData export) {
        if (pendingExport != null) { export.file.delete(); emitError("Finish the current save first."); return; }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                .setType(export.mimeType).putExtra(Intent.EXTRA_TITLE, export.filename);
        pendingExport = export;
        try { startActivityForResult(intent, CREATE_DOCUMENT); }
        catch (ActivityNotFoundException error) {
            pendingExport = null;
            export.file.delete();
            emitError("No document saver is available.");
        }
    }

    private void shareExport(ExportData export) {
        Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".files", export.file);
        Intent intent = new Intent(Intent.ACTION_SEND).setType(export.mimeType)
                .putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        intent.setClipData(ClipData.newRawUri(export.filename, uri));
        try { startActivity(Intent.createChooser(intent, "Share structure")); }
        catch (ActivityNotFoundException error) { emitError("No application is available to share this file."); }
    }

    private void openExternal(Uri uri) {
        try { startActivity(new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)); }
        catch (ActivityNotFoundException error) { emitError("No browser is available to open this link."); }
    }

    private void emitError(String message) {
        runOnUiThread(() -> {
            if (isFinishing() || isDestroyed()) return;
            if (!pageReady) { pendingError = message; return; }
            emit("protpeek:error", json("message", message));
        });
    }

    private void emit(String event, JSONObject detail) {
        String script = "window.dispatchEvent(new CustomEvent(" + JSONObject.quote(event) + ",{detail:" + detail + "}));";
        runOnUiThread(() -> {
            if (pageReady && webView != null && !isFinishing() && !isDestroyed()) {
                String url = webView.getUrl();
                if (url != null && isTrusted(Uri.parse(url))) webView.evaluateJavascript(script, null);
            }
        });
    }

    private static JSONObject json(String key, String value) {
        JSONObject object = new JSONObject();
        try { object.put(key, value); } catch (org.json.JSONException ignored) { /* String key/value cannot fail. */ }
        return object;
    }

    private static String safeFilename(String raw) {
        if (raw == null || raw.trim().isEmpty()) return "ProtPeek-document.pdb";
        String name = Normalizer.normalize(raw.replace('\\', '/'), Normalizer.Form.NFKC);
        name = name.substring(name.lastIndexOf('/') + 1).replaceAll("[^\\p{L}\\p{N}._ ()-]", "_");
        name = name.replaceAll("\\.{2,}", "_").replaceAll("^\\.+", "").trim();
        if (name.isEmpty()) name = "ProtPeek-document.pdb";
        if (name.length() > 160) {
            int dot = name.lastIndexOf('.');
            String extension = dot > 0 && name.length() - dot <= 12 ? name.substring(dot) : "";
            name = name.substring(0, 160 - extension.length()) + extension;
        }
        return name;
    }

    private static long copyLimited(InputStream input, OutputStream output, int maximum) throws IOException {
        byte[] buffer = new byte[16384];
        long count = 0;
        int read;
        while ((read = input.read(buffer)) != -1) {
            count += read;
            if (count > maximum) throw new IOException("The document is larger than 32 MiB.");
            output.write(buffer, 0, read);
        }
        return count;
    }

    private void cleanOldSharedFiles() {
        File directory = new File(getCacheDir(), "shared");
        File[] folders = directory.listFiles();
        if (folders == null) return;
        long cutoff = System.currentTimeMillis() - CACHE_RETENTION_MS;
        for (File folder : folders) {
            if (!folder.isDirectory() || folder.lastModified() >= cutoff) continue;
            File[] children = folder.listFiles();
            if (children != null) for (File child : children) if (child.isFile()) child.delete();
            folder.delete();
        }
    }

    private void restoreImportedFile(Bundle state) {
        if (state == null) return;
        String path = state.getString("importedFile");
        if (path == null) return;
        try {
            File file = new File(path).getCanonicalFile();
            File directory = new File(getCacheDir(), "imports").getCanonicalFile();
            if (file.isFile() && file.length() <= MAX_BYTES && directory.equals(file.getParentFile())) {
                importedFile = file;
                importedName = state.getString("importedName", "ProtPeek-document.pdb");
                importedMime = state.getString("importedMime", "application/octet-stream");
                pendingImport = file;
            }
        } catch (IOException ignored) { /* A deleted cache file is simply not restored. */ }
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        if (importedFile != null) {
            state.putString("importedFile", importedFile.getAbsolutePath());
            state.putString("importedName", importedName);
            state.putString("importedMime", importedMime);
        }
    }

    private void handleBack() {
        if (webView == null) { finish(); return; }
        WebView active = webView;
        active.evaluateJavascript("Boolean(window.ProtPeekAndroidUI && typeof window.ProtPeekAndroidUI.back === 'function' "
                + "? window.ProtPeekAndroidUI.back() : !window.dispatchEvent(new CustomEvent('protpeek:back',{cancelable:true})))", handled -> {
            if ("true".equals(handled)) return;
            if (active != webView || isFinishing()) return;
            if (active.canGoBack()) active.goBack(); else finish();
        });
    }

    @Override public void onBackPressed() { handleBack(); }

    @Override protected void onPause() {
        if (webView != null) {
            if (pageReady) webView.evaluateJavascript("window.dispatchEvent(new Event('protpeek:pause'))", null);
            webView.onPause();
            webView.pauseTimers();
        }
        super.onPause();
    }

    @Override protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.resumeTimers();
            webView.onResume();
            if (pageReady) webView.evaluateJavascript("window.dispatchEvent(new Event('protpeek:resume'))", null);
        }
    }

    @Override protected void onDestroy() {
        pageReady = false;
        if (Build.VERSION.SDK_INT >= 33 && backCallback != null)
            getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backCallback);
        if (webView != null) {
            root.removeView(webView);
            webView.removeJavascriptInterface("ProtPeekAndroid");
            webView.destroy();
            webView = null;
        }
        if (pendingExport != null) pendingExport.file.delete();
        files.shutdown();
        super.onDestroy();
    }

    private static final class ExportData {
        final File file;
        final String filename;
        final String mimeType;
        ExportData(File file, String filename, String mimeType) {
            this.file = file;
            this.filename = filename;
            this.mimeType = mimeType;
        }
    }
}
