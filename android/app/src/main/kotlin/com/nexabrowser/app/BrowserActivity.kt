package com.nexabrowser.app

import android.Manifest
import android.app.Activity
import android.app.DownloadManager
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.view.KeyEvent
import android.view.inputmethod.EditorInfo
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.URLUtil
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.ImageButton
import android.widget.ProgressBar
import android.widget.Toast
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

/**
 * Fase 1 MVP: navegación real de una sola cuenta — barra de direcciones,
 * atrás/adelante/recargar, permisos de sitio (cámara/mic/geo, el mismo
 * conjunto que ALLOWED_PERMISSIONS en el main.js de escritorio) y descargas.
 *
 * A propósito NO llama WebView.setDataDirectorySuffix() ni nada del
 * aislamiento por proceso de la Fase 0/2 — esta pantalla es la que después,
 * en la Fase 2, se aloja dentro de cada proceso-cuenta; por ahora corre en el
 * proceso principal, una sola cuenta, sin partición.
 */
class BrowserActivity : Activity() {

    private lateinit var webView: WebView
    private lateinit var addressBar: EditText
    private lateinit var progressBar: ProgressBar
    private lateinit var btnBack: ImageButton
    private lateinit var btnForward: ImageButton

    private var pendingPermissionRequest: PermissionRequest? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_browser)

        webView = findViewById(R.id.webView)
        addressBar = findViewById(R.id.addressBar)
        progressBar = findViewById(R.id.progressBar)
        btnBack = findViewById(R.id.btnBack)
        btnForward = findViewById(R.id.btnForward)

        setupWebView()
        setupChrome()

        val startUrl = "https://www.google.com/"
        addressBar.setText(startUrl)
        webView.loadUrl(startUrl)
    }

    @android.annotation.SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            loadWithOverviewMode = true
            useWideViewPort = true
            mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
        }
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)

        webView.webViewClient = object : WebViewClient() {
            // Keep every navigation inside this WebView instead of handing it
            // off to an external browser — this IS the browser.
            override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean = false

            override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                addressBar.setText(url)
                progressBar.visibility = android.view.View.VISIBLE
            }

            // Sites that route client-side (History API pushState, no full
            // reload — e.g. Google's own search-suggestion clicks) never
            // fire onPageFinished a second time, so back/forward state would
            // otherwise go stale after the very first load. This callback
            // fires for BOTH regular navigations and pushState-only ones,
            // which onPageFinished does not — same fix as the did-navigate-
            // in-page hook already applied to the desktop Electron app for
            // the exact same class of bug.
            override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
                android.util.Log.d("BrowserActivity", "doUpdateVisitedHistory url=$url isReload=$isReload canGoBack=${view.canGoBack()}")
                addressBar.setText(url)
                updateNavButtons()
            }

            override fun onPageFinished(view: WebView, url: String?) {
                android.util.Log.d("BrowserActivity", "onPageFinished url=$url canGoBack=${view.canGoBack()}")
                progressBar.visibility = android.view.View.GONE
                updateNavButtons()
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView, newProgress: Int) {
                progressBar.progress = newProgress
            }

            // Mirrors ALLOWED_PERMISSIONS in the desktop app's main.js: grant
            // the common expected set (camera/mic for calls, geolocation) so
            // sites that need them work like a normal browser, instead of
            // Android's WebView default of silently denying everything.
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
                if (needsCamera && ContextCompat.checkSelfPermission(this@BrowserActivity, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                    missing.add(Manifest.permission.CAMERA)
                }
                if (needsMic && ContextCompat.checkSelfPermission(this@BrowserActivity, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                    missing.add(Manifest.permission.RECORD_AUDIO)
                }
                if (missing.isEmpty()) {
                    request.grant(resources)
                } else {
                    pendingPermissionRequest = request
                    ActivityCompat.requestPermissions(this@BrowserActivity, missing.toTypedArray(), REQ_SITE_PERMISSION)
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

    private fun setupChrome() {
        btnBack.setOnClickListener {
            android.util.Log.d("BrowserActivity", "btnBack clicked, canGoBack=${webView.canGoBack()}, isEnabled=${btnBack.isEnabled}")
            if (webView.canGoBack()) webView.goBack()
        }
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

    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    companion object {
        private const val REQ_SITE_PERMISSION = 1001
    }
}
