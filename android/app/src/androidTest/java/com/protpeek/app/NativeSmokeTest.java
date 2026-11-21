// SPDX-License-Identifier: MPL-2.0
package com.protpeek.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.SystemClock;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;

import androidx.core.content.FileProvider;
import androidx.test.core.app.ActivityScenario;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** Bundled WebView and native content-URI integration, with synthetic data only. */
public final class NativeSmokeTest {
    private static final String FIXTURE = "HEADER    PROTPEEK TEST                         31-AUG-26   FPRT\n"
            + "ATOM      1  N   ALA A   5       0.000   0.000   0.000  1.00 10.00           N\n"
            + "ATOM      2  CA  ALA A   5       1.450   0.000   0.000  1.00 10.00           C\n"
            + "ATOM      3  C   ALA A   5       2.050   1.350   0.000  1.00 10.00           C\n"
            + "HETATM    4 MG    MG B 101       5.000   0.000   0.000  1.00 20.00          MG\nTER\nEND\n";

    @Test public void bundledUiAndNativeContentUriOpenRealViewer() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitJs(scenario, "document.readyState === 'complete' && document.querySelector('#app[data-ready=\"true\"]') !== null "
                    + "&& typeof window.ProtPeekAndroid.openFile === 'function'", 30000, "The bundled UI and native bridge did not become ready");
            assertEquals("\"https://appassets.androidplatform.net\"", js(scenario, "location.origin"));
            scenario.onActivity(activity -> {
                WebView view = findWebView(activity.findViewById(android.R.id.content));
                assertNotNull(view);
                assertTrue(view.getSettings().getJavaScriptEnabled());
                assertTrue(!view.getSettings().getAllowFileAccess());
                assertTrue(!view.getSettings().getAllowContentAccess());
            });

            File directory = new File(context.getCacheDir(), "shared/smoke");
            assertTrue(directory.isDirectory() || directory.mkdirs());
            File fixture = new File(directory, "native-smoke.pdb");
            try (FileOutputStream output = new FileOutputStream(fixture)) {
                output.write(FIXTURE.getBytes(StandardCharsets.UTF_8));
            }
            Uri uri = FileProvider.getUriForFile(context, context.getPackageName() + ".files", fixture);
            Intent open = new Intent(context, MainActivity.class).setAction(Intent.ACTION_VIEW)
                    .setDataAndType(uri, "chemical/x-pdb")
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            context.startActivity(open);
            awaitJs(scenario, "(() => { const c=document.querySelector('.viewer-host canvas'); "
                    + "return document.querySelector('.viewer-frame[data-viewer-state=\"ready\"]') "
                    + "&& c && c.width>0 && c.height>0 && document.querySelectorAll('.sequence-layer .residue-cell').length>0; })()",
                    45000, "The native content URI did not reach the Mol* viewer");
            assertEquals("false", js(scenario, "Boolean(document.querySelector('.android-load-status[data-error=\"true\"]'))"));

            Bitmap image = InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
            assertNotNull(image);
            File screenshots = new File(context.getExternalFilesDir(null), "qa");
            assertTrue(screenshots.isDirectory() || screenshots.mkdirs());
            try (FileOutputStream output = new FileOutputStream(new File(screenshots, "native-smoke.png"))) {
                assertTrue(image.compress(Bitmap.CompressFormat.PNG, 100, output));
            } finally {
                image.recycle();
            }
            fixture.delete();
        }
    }

    private static String js(ActivityScenario<MainActivity> scenario, String expression) throws InterruptedException {
        CountDownLatch result = new CountDownLatch(1);
        AtomicReference<String> value = new AtomicReference<>();
        scenario.onActivity(activity -> {
            WebView view = findWebView(activity.findViewById(android.R.id.content));
            if (view == null) { value.set("null"); result.countDown(); return; }
            view.evaluateJavascript(expression, answer -> { value.set(answer); result.countDown(); });
        });
        assertTrue("WebView evaluation timed out", result.await(5, TimeUnit.SECONDS));
        return value.get();
    }

    private static void awaitJs(ActivityScenario<MainActivity> scenario, String condition, long timeout, String message) throws InterruptedException {
        long end = SystemClock.elapsedRealtime() + timeout;
        String value = null;
        while (SystemClock.elapsedRealtime() < end) {
            value = js(scenario, "Boolean(" + condition + ")");
            if ("true".equals(value)) return;
            SystemClock.sleep(150);
        }
        assertEquals(message, "true", value);
    }

    private static WebView findWebView(View view) {
        if (view instanceof WebView) return (WebView) view;
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++) {
                WebView found = findWebView(group.getChildAt(i));
                if (found != null) return found;
            }
        }
        return null;
    }
}
