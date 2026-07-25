package com.nexabrowser.app.slots

import android.Manifest
import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.os.Process
import android.util.Log
import android.view.KeyEvent
import android.view.View
import android.view.inputmethod.EditorInfo
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.URLUtil
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.ImageButton
import android.widget.ProgressBar
import android.widget.Toast
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import androidx.webkit.WebViewFeature
import com.nexabrowser.app.R
import com.nexabrowser.app.data.AppDatabase
import kotlinx.coroutines.launch

/**
 * Fase 2: this is the real per-account browser screen — Fase 1's browsing
 * chrome (address bar, back/forward/reload, permissions, downloads) hosted
 * inside a Fase 0-validated isolated process. Four concrete subclasses
 * (SlotActivity0..3) each declare a distinct `android:process` in the
 * manifest, so despite sharing 100% of this code, two of them running at
 * once are two genuinely separate OS processes — same pattern the Fase 0
 * isolation test proved, now carrying a full browser instead of a cookie
 * probe.
 *
 * Doesn't touch WebView.setDataDirectorySuffix() itself — NexaApplication's
 * onCreate() already did that for this process before this Activity (or any
 * WebView) existed.
 */
abstract class WebViewSlotActivity : androidx.appcompat.app.AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var addressBar: EditText
    private lateinit var progressBar: ProgressBar
    private lateinit var btnBack: ImageButton
    private lateinit var btnForward: ImageButton

    private var pendingPermissionRequest: PermissionRequest? = null
    private lateinit var accountId: String
    private val db by lazy { AppDatabase.getInstance(this) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        if (intent?.getBooleanExtra(EXTRA_TERMINATE, false) == true) {
            // The coordinator is evicting this slot to free it up for another
            // account. Killing our own process is the only way to actually
            // release setDataDirectorySuffix's process-lifetime lock on this
            // slot — finish() alone would leave the process (and the old
            // suffix) alive in the background.
            //
            // finishAndRemoveTask() first is load-bearing: if this activity
            // is the top activity of its task when the process dies,
            // ActivityManager treats the death as a crash and auto-relaunches
            // it with the SAME (still-terminate-flagged) intent — an infinite
            // self-kill crash loop. Removing the task first leaves nothing
            // for ActivityManager to restore.
            Log.w(TAG, "${processName()}: evicted, self-terminating")
            finishAndRemoveTask()
            // Chromium's WebView buffers cookies in memory and writes them to
            // the on-disk Cookies database asynchronously — killProcess()
            // gives it no chance to do that, so anything set since the last
            // flush would otherwise vanish the moment this slot is reused.
            CookieManager.getInstance().flush()
            Process.killProcess(Process.myPid())
            return
        }

        // Must happen before setContentView(): activity_browser.xml declares
        // a <WebView> directly, so inflating it constructs the WebView, and
        // setDataDirectorySuffix() is only legal before the first WebView
        // exists in this process. Keyed off the account id (not the slot)
        // so an account keeps its own cookies/storage even if a later LRU
        // eviction moves it into a different slot next time it's opened.
        val incomingAccountId = intent?.getStringExtra(EXTRA_ACCOUNT_ID)
        if (incomingAccountId == null) {
            Log.e(TAG, "${processName()}: launched without an account id — nothing to isolate, finishing")
            finish()
            return
        }
        applyDataDirectorySuffix(incomingAccountId)

        setContentView(R.layout.activity_browser)

        webView = findViewById(R.id.webView)
        addressBar = findViewById(R.id.addressBar)
        progressBar = findViewById(R.id.progressBar)
        btnBack = findViewById(R.id.btnBack)
        btnForward = findViewById(R.id.btnForward)

        setupWebView()
        setupChrome()

        loadAccountFromIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.getBooleanExtra(EXTRA_TERMINATE, false)) {
            Log.w(TAG, "${processName()}: evicted while foregrounded, self-terminating")
            finishAndRemoveTask()
            CookieManager.getInstance().flush()
            Process.killProcess(Process.myPid())
            return
        }
        setIntent(intent)
        loadAccountFromIntent(intent)
    }

    override fun onPause() {
        super.onPause()
        // Defensive flush beyond the eviction path above: Android can kill a
        // backgrounded process for memory pressure at any time, with no
        // terminate intent involved at all, so this is the only reliable
        // point to make sure recently-set cookies survive that.
        CookieManager.getInstance().flush()
    }

    private fun loadAccountFromIntent(intent: Intent) {
        val id = intent.getStringExtra(EXTRA_ACCOUNT_ID) ?: return
        val isSameAccountAlreadyShowing = ::accountId.isInitialized && accountId == id
        accountId = id
        title = intent.getStringExtra(EXTRA_ACCOUNT_NAME) ?: "Nexa Browser"
        if (isSameAccountAlreadyShowing) return // already showing this account, e.g. re-tapped from the hub

        lifecycleScope.launch {
            val account = db.accountDao().getById(id)
            val url = account?.url?.takeIf { it.isNotBlank() } ?: "https://www.google.com/"
            addressBar.setText(url)
            webView.loadUrl(url)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            loadWithOverviewMode = true
            useWideViewPort = true
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
        }
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean = false

            override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                addressBar.setText(url)
                progressBar.visibility = View.VISIBLE
            }

            // SPA sites (History API pushState, no full reload) never fire
            // onPageFinished a second time — this fires for both, same fix
            // already validated in Fase 1 for Google's own search-suggestion
            // clicks.
            override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
                addressBar.setText(url)
                updateNavButtons()
                persistUrl(url)
            }

            override fun onPageFinished(view: WebView, url: String?) {
                progressBar.visibility = View.GONE
                updateNavButtons()
                persistUrl(url)
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView, newProgress: Int) {
                progressBar.progress = newProgress
            }

            override fun onPermissionRequest(request: PermissionRequest) {
                val resources = request.resources
                val grantable = resources.all {
                    it == PermissionRequest.RESOURCE_VIDEO_CAPTURE || it == PermissionRequest.RESOURCE_AUDIO_CAPTURE
                }
                if (!grantable) {
                    request.deny()
                    return
                }
                val needsCamera = resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)
                val needsMic = resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)
                val missing = mutableListOf<String>()
                if (needsCamera && ContextCompat.checkSelfPermission(this@WebViewSlotActivity, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                    missing.add(Manifest.permission.CAMERA)
                }
                if (needsMic && ContextCompat.checkSelfPermission(this@WebViewSlotActivity, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                    missing.add(Manifest.permission.RECORD_AUDIO)
                }
                if (missing.isEmpty()) {
                    request.grant(resources)
                } else {
                    pendingPermissionRequest = request
                    ActivityCompat.requestPermissions(this@WebViewSlotActivity, missing.toTypedArray(), REQ_SITE_PERMISSION)
                }
            }
        }

        webView.setDownloadListener { url, _, contentDisposition, mimeType, _ ->
            val request = DownloadManager.Request(Uri.parse(url))
            val fileName = URLUtil.guessFileName(url, contentDisposition, mimeType)
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName)
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            request.addRequestHeader("cookie", CookieManager.getInstance().getCookie(url))
            (getSystemService(DOWNLOAD_SERVICE) as DownloadManager).enqueue(request)
            Toast.makeText(this, "Descargando $fileName", Toast.LENGTH_SHORT).show()
        }
    }

    private fun persistUrl(url: String?) {
        if (url.isNullOrBlank() || !::accountId.isInitialized) return
        lifecycleScope.launch {
            db.accountDao().updateUrl(accountId, url, System.currentTimeMillis())
        }
    }

    private fun setupChrome() {
        btnBack.setOnClickListener { if (webView.canGoBack()) webView.goBack() }
        btnForward.setOnClickListener { if (webView.canGoForward()) webView.goForward() }
        findViewById<ImageButton>(R.id.btnReload).setOnClickListener { webView.reload() }

        addressBar.setOnEditorActionListener { _, actionId, event ->
            val isGo = actionId == EditorInfo.IME_ACTION_GO ||
                (event?.keyCode == KeyEvent.KEYCODE_ENTER && event.action == KeyEvent.ACTION_DOWN)
            if (isGo) {
                navigateTo(addressBar.text.toString())
                true
            } else {
                false
            }
        }
    }

    private fun navigateTo(input: String) {
        val trimmed = input.trim()
        val url = when {
            trimmed.isEmpty() -> return
            Uri.parse(trimmed).scheme != null -> trimmed
            trimmed.contains(" ") || !trimmed.contains(".") ->
                "https://www.google.com/search?q=" + Uri.encode(trimmed)
            else -> "https://$trimmed"
        }
        webView.loadUrl(url)
    }

    private fun updateNavButtons() {
        btnBack.isEnabled = webView.canGoBack()
        btnForward.isEnabled = webView.canGoForward()
        btnBack.alpha = if (btnBack.isEnabled) 1f else 0.3f
        btnForward.alpha = if (btnForward.isEnabled) 1f else 0.3f
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQ_SITE_PERMISSION) return
        val request = pendingPermissionRequest ?: return
        pendingPermissionRequest = null
        if (grantResults.isNotEmpty() && grantResults.all { it == PackageManager.PERMISSION_GRANTED }) {
            request.grant(request.resources)
        } else {
            request.deny()
        }
    }

    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    private fun applyDataDirectorySuffix(accountId: String) {
        if (!WebViewFeature.isStartupFeatureSupported(this, WebViewFeature.STARTUP_FEATURE_SET_DATA_DIRECTORY_SUFFIX)) {
            Log.e(TAG, "setDataDirectorySuffix unsupported on this WebView build — account $accountId will NOT be isolated")
            return
        }
        try {
            WebView.setDataDirectorySuffix(accountId)
            Log.d(TAG, "${processName()}: setDataDirectorySuffix(\"$accountId\") applied for this process")
        } catch (e: IllegalStateException) {
            // Means a WebView (or another component that touches one) was
            // already created in this process before we got here.
            Log.e(TAG, "setDataDirectorySuffix failed — a WebView already existed in this process", e)
        }
    }

    private fun processName(): String =
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
            android.app.Application.getProcessName()
        } else {
            packageName
        }

    companion object {
        private const val TAG = "WebViewSlotActivity"
        private const val REQ_SITE_PERMISSION = 1001
        const val EXTRA_ACCOUNT_ID = "account_id"
        const val EXTRA_ACCOUNT_NAME = "account_name"
        const val EXTRA_TERMINATE = "terminate"
    }
}
