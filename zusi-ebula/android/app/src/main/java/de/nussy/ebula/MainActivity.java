package de.nussy.ebula;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.Collections;

/**
 * Nussy EBuLa / Fahrpult – Android-App. Zeigt die Anzeige (assets/index.html bzw. assets/fahrpult.html,
 * je nach App-Variante BuildConfig.START_PAGE) im Vollbild
 * und verbindet sich über das WLAN mit der Bridge auf dem Zusi-PC.
 */
public class MainActivity extends Activity {
    private static final int FILE_REQUEST = 1;
    private WebView web;
    private ValueCallback<Uri[]> fileCallback;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        web = new WebView(this);
        web.setBackgroundColor(0xFF000000);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        // Die Seite liegt lokal (file://) und spricht die Bridge per http im WLAN an
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setTextZoom(100);
        s.setUserAgentString(s.getUserAgentString() + " NussyEBuLa/" + BuildConfig.VERSION_NAME);

        web.addJavascriptInterface(new AppInterface((Vibrator) getSystemService(VIBRATOR_SERVICE)), "NussyApp");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("file".equals(uri.getScheme())) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) {
                    // kein Browser vorhanden
                }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                try {
                    startActivityForResult(Intent.createChooser(intent, "Fahrplandatei wählen"), FILE_REQUEST);
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });

        if (state != null) web.restoreState(state);
        else web.loadUrl("file:///android_asset/" + BuildConfig.START_PAGE);
        hideSystemBars();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_REQUEST && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileCallback = null;
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        // Zurück-Taste = Taste C; auf der Hauptseite App verlassen
        web.evaluateJavascript("(window.appBack && window.appBack()) ? 'ok' : 'no'", value -> {
            if (value == null || !value.contains("ok")) finish();
        });
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onPause() {
        super.onPause();
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }

    @SuppressWarnings("deprecation")
    private void hideSystemBars() {
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.systemBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
        }
    }

    /** Wird im JavaScript als window.NussyApp angeboten. */
    public static class AppInterface {
        private final Vibrator vibrator;

        AppInterface(Vibrator vibrator) {
            this.vibrator = vibrator;
        }

        /** Haptische Rückmeldung der Tasten. Muster wie navigator.vibrate: "an,aus,an,…" in ms. */
        @JavascriptInterface
        @SuppressWarnings("deprecation")
        public void vibrate(String pattern) {
            if (vibrator == null || !vibrator.hasVibrator()) return;
            try {
                String[] parts = pattern.split(",");
                long[] wave = new long[parts.length + 1];
                for (int i = 0; i < parts.length; i++) wave[i + 1] = Math.max(0, Long.parseLong(parts[i].trim()));
                if (Build.VERSION.SDK_INT >= 26) {
                    vibrator.vibrate(parts.length == 1
                            ? VibrationEffect.createOneShot(wave[1], VibrationEffect.DEFAULT_AMPLITUDE)
                            : VibrationEffect.createWaveform(wave, -1));
                } else {
                    vibrator.vibrate(wave, -1);
                }
            } catch (Exception ignored) {
                // ungültiges Muster
            }
        }

        /** IPv4-Adresse im WLAN, damit die Anzeige das passende Netz nach der Bridge durchsuchen kann. */
        @JavascriptInterface
        public String getLocalIp() {
            try {
                String fallback = null;
                for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                    if (!ni.isUp() || ni.isLoopback()) continue;
                    for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                        if (!(a instanceof Inet4Address) || !a.isSiteLocalAddress()) continue;
                        String name = ni.getName();
                        if (name.startsWith("wlan") || name.startsWith("eth") || name.startsWith("ap") || name.startsWith("swlan")) {
                            return a.getHostAddress();
                        }
                        if (fallback == null) fallback = a.getHostAddress();
                    }
                }
                return fallback;
            } catch (Exception e) {
                return null;
            }
        }

        @JavascriptInterface
        public String version() {
            return BuildConfig.VERSION_NAME;
        }

        /** Startseite dieser App (EBuLa: index.html, Fahrpult: fahrpult.html). */
        @JavascriptInterface
        public String startPage() {
            return BuildConfig.START_PAGE;
        }
    }
}
