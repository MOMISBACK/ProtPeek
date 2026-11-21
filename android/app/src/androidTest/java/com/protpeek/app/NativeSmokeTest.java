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
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.SystemClock;
import android.util.Base64;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;

import androidx.core.content.FileProvider;
import androidx.lifecycle.Lifecycle;
import androidx.test.core.app.ActivityScenario;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.atomic.AtomicInteger;

/** Bundled WebView and native content-URI integration, with synthetic data only. */
public final class NativeSmokeTest {
    // A continuous eight-residue trace has visible cartoon geometry, unlike a
    // single amino acid. This is deliberately synthetic, not experimental data.
    private static String fixturePdb() {
        StringBuilder pdb = new StringBuilder("HEADER    PROTPEEK SYNTHETIC TEST\n");
        String[] names = { "N", "CA", "C", "O" };
        String[] elements = { "N", "C", "C", "O" };
        double[] offsets = { -1.25, 0, 1.25, 1.65 };
        int serial = 1;
        for (int residue = 1; residue <= 8; residue++) {
            double y = Math.sin(residue * 0.75) * 2;
            double z = Math.cos(residue * 0.75) * 2;
            for (int atom = 0; atom < names.length; atom++) {
                pdb.append(String.format(Locale.US,
                        "ATOM  %5d %4s ALA A%4d    %8.3f%8.3f%8.3f  1.00 10.00          %2s\n",
                        serial++, names[atom], residue, (residue - 1) * 3.7 + offsets[atom],
                        y + (atom == 3 ? 0.8 : 0), z, elements[atom]));
            }
        }
        pdb.append("TER\n");
        pdb.append(String.format(Locale.US,
                "HETATM%5d MG    MG B 101    %8.3f%8.3f%8.3f  1.00 20.00          MG\n",
                serial, 12.0, 5.0, 2.0));
        return pdb.append("TER\nEND\n").toString();
    }

    @Test public void bundledUiAndNativeContentUriOpenRealViewer() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File directory = new File(context.getCacheDir(), "shared/smoke");
        assertTrue(directory.isDirectory() || directory.mkdirs());
        File fixture = new File(directory, "native-smoke.pdb");
        try (FileOutputStream output = new FileOutputStream(fixture)) {
            output.write(fixturePdb().getBytes(StandardCharsets.UTF_8));
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
                    + "&& c && c.width>0 && c.height>0 && document.querySelectorAll('.sequence-layer .residue-cell').length>=8; })()";
            awaitJs(scenario, viewerReady, 45000, "The queued launch URI did not reach the Mol* viewer");
            awaitViewerPaint(scenario);
            saveDiagnostics(context, scenario, "cold");
            int coldForeground = saveScreenshot(context, scenario, "native-smoke-cold.png");
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
            saveDiagnostics(context, scenario, "warm");
            int warmForeground = saveScreenshot(context, scenario, "native-smoke-portrait.png");

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
            saveDiagnostics(context, scenario, "rotated");
            int rotatedForeground = saveScreenshot(context, scenario, "native-smoke.png");
            // The real Mol* offscreen export separates framebuffer failures
            // from Android compositor/screenshot failures. Only SAF transport
            // is intercepted; the application export action is unchanged.
            int exportedForeground = saveMolecularPng(context, scenario);
            awaitViewerPaint(scenario);
            saveDiagnostics(context, scenario, "after-export");
            int afterExportForeground = saveScreenshot(context, scenario, "native-smoke-after-export.png");
            fixture.delete();
            assertTrue("The cold native molecular viewport is blank (foreground pixels=" + coldForeground + ")", coldForeground >= 100);
            assertTrue("The warm native molecular viewport is blank (foreground pixels=" + warmForeground + ")", warmForeground >= 100);
            assertTrue("The rotated native molecular viewport is blank (foreground pixels=" + rotatedForeground + ")", rotatedForeground >= 100);
            assertTrue("The real Mol* PNG export is blank (foreground pixels=" + exportedForeground + ")", exportedForeground >= 100);
            assertTrue("The native molecular viewport remains blank after export (foreground pixels=" + afterExportForeground + ")", afterExportForeground >= 100);
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

    private static void saveDiagnostics(Context context, ActivityScenario<MainActivity> scenario, String stage) throws Exception {
        String diagnostic = js(scenario, "(() => { const c=document.querySelector('.viewer-host canvas'); "
                + "const host=document.querySelector('.viewer-host'); const rect=e=>{const r=e?.getBoundingClientRect(); "
                + "return r?{x:r.x,y:r.y,width:r.width,height:r.height}:null;}; let glInfo; try { "
                + "const g=c?.getContext('webgl2')||c?.getContext('webgl'); const ext=g?.getExtension('WEBGL_debug_renderer_info'); "
                + "glInfo=g?{lost:g.isContextLost(),version:g.getParameter(g.VERSION),vendor:g.getParameter(g.VENDOR), "
                + "renderer:g.getParameter(g.RENDERER),unmaskedVendor:ext?g.getParameter(ext.UNMASKED_VENDOR_WEBGL):null, "
                + "unmaskedRenderer:ext?g.getParameter(ext.UNMASKED_RENDERER_WEBGL):null, "
                + "drawingBuffer:[g.drawingBufferWidth,g.drawingBufferHeight],viewport:Array.from(g.getParameter(g.VIEWPORT)), "
                + "attributes:g.getContextAttributes(),extensions:g.getSupportedExtensions()}:null; } catch(e){glInfo={error:String(e)};} "
                + "const style=c?getComputedStyle(c):null; return {userAgent:navigator.userAgent, "
                + "visibility:document.visibilityState,hasFocus:document.hasFocus(),viewport:[innerWidth,innerHeight],dpr:devicePixelRatio, "
                + "viewerState:document.querySelector('.viewer-frame')?.dataset.viewerState, "
                + "loading:document.querySelector('main.android-app')?.dataset.loading,host:rect(host),canvas:rect(c), "
                + "canvasPixels:c?[c.width,c.height]:null,canvasStyle:style?{display:style.display,visibility:style.visibility,opacity:style.opacity}:null, "
                + "rafCompleted:window.__PROTPEEK_PAINT_READY__,toast:document.querySelector('.android-toast')?.textContent, "
                + "loadStatus:document.querySelector('.android-load-status')?.textContent,gl:glInfo, "
                + "exportError:window.__PROTPEEK_EXPORT_ERROR__??null}; })()");
        writeText(context, "viewer-" + stage + ".json", new JSONObject(diagnostic).toString(2));
    }

    private static File qaFile(Context context, String filename) {
        File directory = new File(context.getExternalFilesDir(null), "qa");
        assertTrue(directory.isDirectory() || directory.mkdirs());
        return new File(directory, filename);
    }

    private static void writeText(Context context, String filename, String text) throws Exception {
        try (FileOutputStream output = new FileOutputStream(qaFile(context, filename))) {
            output.write(text.getBytes(StandardCharsets.UTF_8));
        }
    }

    private static int saveScreenshot(Context context, ActivityScenario<MainActivity> scenario, String filename) throws Exception {
        JSONObject viewport = new JSONObject(js(scenario, "(() => { const r=document.querySelector('.viewer-host').getBoundingClientRect(); "
                + "return {x:r.x,y:r.y,width:r.width,height:r.height,innerWidth}; })()"));
        AtomicReference<int[]> nativeBounds = new AtomicReference<>();
        scenario.onActivity(activity -> {
            WebView view = findWebView(activity.findViewById(android.R.id.content));
            assertNotNull(view);
            int[] location = new int[2];
            view.getLocationOnScreen(location);
            nativeBounds.set(new int[] { location[0], location[1], view.getWidth() });
        });
        Bitmap image = InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
        assertNotNull(image);
        int foreground;
        try (FileOutputStream output = new FileOutputStream(qaFile(context, filename))) {
            assertTrue(image.compress(Bitmap.CompressFormat.PNG, 100, output));
            int[] bounds = nativeBounds.get();
            double scale = bounds[2] / viewport.getDouble("innerWidth");
            // The center of the canvas excludes the surrounding shell, lower
            // right toolbar, and corner camera axes. UI alone cannot pass.
            int left = (int) (bounds[0] + (viewport.getDouble("x") + viewport.getDouble("width") * 0.2) * scale);
            int top = (int) (bounds[1] + (viewport.getDouble("y") + viewport.getDouble("height") * 0.2) * scale);
            int right = (int) (bounds[0] + (viewport.getDouble("x") + viewport.getDouble("width") * 0.8) * scale);
            int bottom = (int) (bounds[1] + (viewport.getDouble("y") + viewport.getDouble("height") * 0.7) * scale);
            foreground = foregroundPixels(image, left, top, right, bottom);
            JSONObject proof = new JSONObject().put("foregroundPixels", foreground)
                    .put("crop", new JSONArray(new int[] { left, top, right, bottom }))
                    .put("bitmapWidth", image.getWidth()).put("bitmapHeight", image.getHeight());
            writeText(context, filename + ".json", proof.toString(2));
        } finally {
            image.recycle();
        }
        return foreground;
    }

    private static int foregroundPixels(Bitmap bitmap, int left, int top, int right, int bottom) {
        int count = 0;
        for (int y = Math.max(0, top); y < Math.min(bitmap.getHeight(), bottom); y += 2) {
            for (int x = Math.max(0, left); x < Math.min(bitmap.getWidth(), right); x += 2) {
                int pixel = bitmap.getPixel(x, y);
                if (Color.alpha(pixel) >= 200 && Math.min(Color.red(pixel), Math.min(Color.green(pixel), Color.blue(pixel))) < 235) count++;
            }
        }
        return count;
    }

    private static int saveMolecularPng(Context context, ActivityScenario<MainActivity> scenario) throws Exception {
        String intercepted = js(scenario, "(() => {window.__PROTPEEK_EXPORT_ORIGINAL__=window.ProtPeekAndroid; "
                + "window.__PROTPEEK_EXPORT_PAYLOAD__=null; try {const original=window.ProtPeekAndroid; "
                + "const capture=json=>{window.__PROTPEEK_EXPORT_PAYLOAD__=JSON.parse(json);}; "
                + "const stub={openFile:()=>original.openFile(),ready:()=>original.ready(),exportFile:capture,shareFile:capture}; "
                + "Object.defineProperty(window,'ProtPeekAndroid',{value:stub,writable:true,configurable:true}); "
                + "return window.ProtPeekAndroid===stub;} catch(e){window.__PROTPEEK_EXPORT_ERROR__=String(e);return false;} })()");
        try {
            assertEquals("The instrumentation could not intercept only the native export transport", "true", intercepted);
            assertEquals("true", js(scenario, "(() => { const menu=document.querySelector('[aria-label=\"Export structure or image\"]'); "
                    + "const save=document.querySelector('[data-export-format=\"png\"][data-export-action=\"save\"]'); "
                    + "if(!menu||!save)return false; menu.click(); save.click(); return true; })()"));
            awaitJs(scenario, "typeof window.__PROTPEEK_EXPORT_PAYLOAD__?.base64==='string'", 45000,
                    "The real Mol* image export did not reach the native transport");
            Object encoded = new JSONTokener(js(scenario, "window.__PROTPEEK_EXPORT_PAYLOAD__.base64")).nextValue();
            assertTrue(encoded instanceof String);
            byte[] bytes = Base64.decode((String) encoded, Base64.DEFAULT);
            try (FileOutputStream output = new FileOutputStream(qaFile(context, "molstar-export.png"))) {
                output.write(bytes);
            }
            Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            assertNotNull("Mol* did not export a valid PNG", bitmap);
            try {
                int foreground = foregroundPixels(bitmap, bitmap.getWidth() / 10, bitmap.getHeight() / 10,
                        bitmap.getWidth() * 9 / 10, bitmap.getHeight() * 9 / 10);
                writeText(context, "molstar-export.json", new JSONObject().put("foregroundPixels", foreground)
                        .put("bitmapWidth", bitmap.getWidth()).put("bitmapHeight", bitmap.getHeight()).toString(2));
                return foreground;
            } finally {
                bitmap.recycle();
            }
        } finally {
            js(scenario, "window.ProtPeekAndroid=window.__PROTPEEK_EXPORT_ORIGINAL__; true");
            saveDiagnostics(context, scenario, "export");
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
