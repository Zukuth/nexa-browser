package com.nexabrowser.app

import android.annotation.SuppressLint
import android.app.Activity
import android.os.Bundle
import android.os.Process
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.TextView

/**
 * Shared logic for every account-slot activity. Each concrete subclass
 * (SlotActivity0, SlotActivity1, ...) is declared in the manifest with its
 * own `android:process`, so — despite sharing 100% of this code — two
 * subclasses running at once are two genuinely separate OS processes, each
 * with its own NexaApplication.onCreate() call and its own WebView data
 * directory (see NexaApplication for the suffix logic).
 *
 * The isolation test: load a fixed fake origin, set a cookie unique to this
 * process if none exists yet, then read the cookie jar straight back. If two
 * slots ever show each other's marker, the process/suffix wiring is broken —
 * this is meant to fail loudly, not silently pass.
 */
abstract class WebViewSlotActivity : Activity() {

    private lateinit var webView: WebView
    private lateinit var cookieText: TextView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_slot)

        val processName = currentProcessNameCompat()
        findViewById<TextView>(R.id.txtProcessName).text = "Proceso: $processName"
        cookieText = findViewById(R.id.txtCookieValue)
        cookieText.text = "Cookie leída: (cargando…)"

        findViewById<Button>(R.id.btnKillProcess).setOnClickListener {
            Log.w(TAG, "$processName: matando este proceso a propósito (Process.killProcess)")
            Process.killProcess(Process.myPid())
        }

        webView = findViewById(R.id.webView)
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.addJavascriptInterface(CookieBridge(), "AndroidBridge")
        webView.webViewClient = WebViewClient()

        // A fixed fake https origin so cookies behave like they would on a
        // real site — data:/file: URLs don't give a stable cookie origin.
        val html = """
            <html><body>
            <script>
              if (!document.cookie.includes('accountMarker=')) {
                document.cookie = 'accountMarker=$processName; path=/; max-age=31536000';
              }
              AndroidBridge.onCookieRead(document.cookie);
            </script>
            </body></html>
        """.trimIndent()
        webView.loadDataWithBaseURL("https://nexa-browser-slot-test.local/", html, "text/html", "utf-8", null)
    }

    private fun currentProcessNameCompat(): String =
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
            // Application.getProcessName() is a static method — it works from
            // any class, it's not inherited via Activity/Context.
            android.app.Application.getProcessName()
        } else {
            packageName
        }

    inner class CookieBridge {
        @JavascriptInterface
        fun onCookieRead(cookieString: String) {
            Log.i(TAG, "${currentProcessNameCompat()}: document.cookie = \"$cookieString\"")
            runOnUiThread {
                cookieText.text = "Cookie leída: $cookieString"
            }
        }
    }

    companion object {
        private const val TAG = "WebViewSlotActivity"
    }
}
