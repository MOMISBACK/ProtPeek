// SPDX-License-Identifier: MPL-2.0
package com.protpeek.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.SystemClock;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;

import androidx.core.content.FileProvider;
import androidx.lifecycle.Lifecycle;
import androidx.test.core.app.ActivityScenario;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.atomic.AtomicInteger;

/** Bundled WebView and native content-URI integration, with synthetic data only. */
public final class NativeSmokeTest {
    private static final String FIXTURE = "HEADER    PROTPEEK TEST                         31-AUG-26   FPRT\n"
            + "ATOM      1  N   ALA A   5       0.000   0.000   0.000  1.00 10.00           N\n"
            + "ATOM      2  CA  ALA A   5       1.450   0.000   0.000  1.00 10.00           C\n"
            + "ATOM      3  C   ALA A   5       2.050   1.350   0.000  1.00 10.00           C\n"
            + "HETATM    4 MG    MG B 101       5.000   0.000   0.000  1.00 20.00          MG\nTER\nEND\n";

    @Test public void bundledUiAndNativeContentUriOpenRealViewer() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
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
        // ActivityScenario identifies its Activity using Intent.filterEquals().
        // Use the same VIEW intent for launch and onNewIntent so setIntent() in
        // production does not make the harness ignore subsequent lifecycle events.
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(open)) {
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

            String viewerReady = "(() => { const c=document.querySelector('.viewer-host canvas'); "
                    + "return document.querySelector('.viewer-frame[data-viewer-state=\"ready\"]') "
                    + "&& c && c.width>0 && c.height>0 && document.querySelectorAll('.sequence-layer .residue-cell').length>0; })()";
            awaitJs(scenario, viewerReady, 45000, "The queued launch URI did not reach the Mol* viewer");
            // Also exercise an incoming VIEW while the same document is ready.
            assertEquals("true", js(scenario, "window.__PROTPEEK_WARM_IMPORTS__=0; "
                    + "window.addEventListener('protpeek:file-opened',()=>{window.__PROTPEEK_WARM_IMPORTS__++;}); true"));
            // launch() adds CLEAR_TASK to its Intent; never copy that flag into
            // the warm launch, which must exercise onNewIntent on this Activity.
            context.startActivity(new Intent(open).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                    | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_GRANT_READ_URI_PERMISSION));
            awaitJs(scenario, "window.__PROTPEEK_WARM_IMPORTS__===1 && (" + viewerReady + ")",
                    45000, "The onNewIntent URI did not reach the existing Mol* viewer");
            assertEquals("false", js(scenario, "Boolean(document.querySelector('.android-load-status[data-error=\"true\"]'))"));
            awaitViewerPaint(scenario);
            saveScreenshot(context, "native-smoke-portrait.png");

            // Preserve the actual WebView and document when the device rotates.
            assertEquals("true", js(scenario, "window.__PROTPEEK_ROTATION_SMOKE__ = 'same-document'; true"));
            AtomicReference<WebView> beforeRotation = new AtomicReference<>();
            AtomicInteger targetOrientation = new AtomicInteger();
            scenario.onActivity(activity -> {
                beforeRotation.set(findWebView(activity.findViewById(android.R.id.content)));
                int current = activity.getResources().getConfiguration().orientation;
                int requested = current == Configuration.ORIENTATION_LANDSCAPE
                        ? ActivityInfo.SCREEN_ORIENTATION_PORTRAIT : ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE;
                targetOrientation.set(requested);
                activity.setRequestedOrientation(requested);
            });
            boolean landscape = targetOrientation.get() == ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE;
            awaitJs(scenario, "window.__PROTPEEK_ROTATION_SMOKE__ === 'same-document' "
                    + "&& document.querySelector('.viewer-frame[data-viewer-state=\"ready\"]') !== null "
                    + "&& (innerWidth > innerHeight) === " + landscape,
                    15000, "Rotation recreated the document or lost the loaded viewer");
            scenario.onActivity(activity -> {
                assertSame("Rotation must preserve the WebView instance", beforeRotation.get(),
                        findWebView(activity.findViewById(android.R.id.content)));
                assertEquals(landscape ? Configuration.ORIENTATION_LANDSCAPE : Configuration.ORIENTATION_PORTRAIT,
                        activity.getResources().getConfiguration().orientation);
            });

            awaitViewerPaint(scenario);
            saveScreenshot(context, "native-smoke.png");
            fixture.delete();
        }
    }

    private static void awaitViewerPaint(ActivityScenario<MainActivity> scenario) throws InterruptedException {
        awaitJs(scenario, "(() => { const c=document.querySelector('.viewer-host canvas'); "
                + "const host=document.querySelector('.viewer-host')?.getBoundingClientRect(); "
                + "const frame=document.querySelector('.viewer-frame')?.getBoundingClientRect(); "
                + "return c && host && frame && host.width>0 && host.height>0 "
                + "&& Math.abs(host.width-frame.width)<2 && Math.abs(host.height-frame.height)<2 "
                + "&& Math.abs(c.width/c.height-host.width/host.height)<0.03; })()",
                15000, "The molecular canvas did not resize with its viewport");
        assertEquals("true", js(scenario, "window.__PROTPEEK_PAINT_READY__=false; "
                + "requestAnimationFrame(()=>requestAnimationFrame(()=>{window.__PROTPEEK_PAINT_READY__=true;})); true"));
        awaitJs(scenario, "window.__PROTPEEK_PAINT_READY__===true", 15000, "The viewer did not draw after layout");
        CountDownLatch painted = new CountDownLatch(1);
        scenario.onActivity(activity -> {
            WebView view = findWebView(activity.findViewById(android.R.id.content));
            assertNotNull(view);
            view.postVisualStateCallback(SystemClock.uptimeMillis(), new WebView.VisualStateCallback() {
                @Override public void onComplete(long requestId) {
                    if (Build.VERSION.SDK_INT >= 29 && view.isHardwareAccelerated()) {
                        view.getViewTreeObserver().registerFrameCommitCallback(painted::countDown);
                    } else {
                        view.postOnAnimation(() -> view.postOnAnimation(painted::countDown));
                    }
                    view.postInvalidateOnAnimation();
                }
            });
        });
        assertTrue("The resized WebView frame did not reach the compositor", painted.await(20, TimeUnit.SECONDS));
        InstrumentationRegistry.getInstrumentation().waitForIdleSync();
    }

    private static void saveScreenshot(Context context, String filename) throws Exception {
        Bitmap image = InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
        assertNotNull(image);
        File screenshots = new File(context.getExternalFilesDir(null), "qa");
        assertTrue(screenshots.isDirectory() || screenshots.mkdirs());
        try (FileOutputStream output = new FileOutputStream(new File(screenshots, filename))) {
            assertTrue(image.compress(Bitmap.CompressFormat.PNG, 100, output));
        } finally {
            image.recycle();
        }
    }

    private static String js(ActivityScenario<MainActivity> scenario, String expression) throws InterruptedException {
        return js(scenario, expression, 15000);
    }

    private static String js(ActivityScenario<MainActivity> scenario, String expression, long timeoutMs) throws InterruptedException {
        CountDownLatch result = new CountDownLatch(1);
        AtomicReference<String> value = new AtomicReference<>();
        scenario.onActivity(activity -> {
            WebView view = findWebView(activity.findViewById(android.R.id.content));
            if (view == null) { value.set("null"); result.countDown(); return; }
            view.evaluateJavascript(expression, answer -> { value.set(answer); result.countDown(); });
        });
        // A measured cold SwiftShader/HWUI frame exceeded five seconds. Allow
        // its callback to finish while retaining the outer readiness deadline.
        assertTrue("WebView evaluation timed out", result.await(timeoutMs, TimeUnit.MILLISECONDS));
        return value.get();
    }

    private static void awaitJs(ActivityScenario<MainActivity> scenario, String condition, long timeout, String message) throws InterruptedException {
        long end = SystemClock.elapsedRealtime() + timeout;
        String value = null;
        while (SystemClock.elapsedRealtime() < end) {
            while (scenario.getState() != Lifecycle.State.RESUMED && SystemClock.elapsedRealtime() < end)
                SystemClock.sleep(25);
            assertEquals("The test Activity did not resume", Lifecycle.State.RESUMED, scenario.getState());
            long remaining = end - SystemClock.elapsedRealtime();
            if (remaining <= 0) break;
            value = js(scenario, "Boolean(" + condition + ")", Math.min(15000, remaining));
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
