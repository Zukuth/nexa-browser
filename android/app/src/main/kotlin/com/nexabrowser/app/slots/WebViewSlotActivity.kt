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
import androidx.webkit.ProxyConfig
import androidx.webkit.ProxyController
import androidx.webkit.WebViewFeature
import com.nexabrowser.app.R
import com.nexabrowser.app.adblock.AdBlocker
import com.nexabrowser.app.data.Account
import com.nexabrowser.app.data.AppDatabase
import com.nexabrowser.app.security.PasswordCrypto
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

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

    // Filled in by applyProxy() whenever the current account has proxy
    // credentials, so onReceivedHttpAuthRequest can answer a proxy auth
    // challenge without a second DB round-trip.
    private var proxyUsername: String? = null
    private var proxyPassword: String? = null

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
            if (account != null) applyProxy(account)
            val url = account?.url?.takeIf { it.isNotBlank() } ?: "https://www.google.com/"
            addressBar.setText(url)
            webView.loadUrl(url)
        }
    }

    // Fase 4. ProxyController.setProxyOverride() is process-scoped like
    // setDataDirectorySuffix() but — unlike it — NOT one-shot, so it's safe
    // to call again any time the account showing in this process changes.
    // Equivalent to desktop's applyProxy()/ses.setProxy() in main.js.
    private fun applyProxy(account: Account) {
        proxyUsername = account.proxyUsername
        proxyPassword = account.proxyPassword

        if (!WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE)) {
            Log.e(TAG, "ProxyController unsupported on this WebView build — proxy will NOT be applied")
            return
        }
        val controller = ProxyController.getInstance()
        val server = account.proxyServer?.trim()
        if (server.isNullOrEmpty()) {
            controller.clearProxyOverride(Runnable::run) {}
            return
        }
        val config = ProxyConfig.Builder().addProxyRule(server).build()
        controller.setProxyOverride(config, Runnable::run) {
            Log.d(TAG, "${processName()}: proxy override applied ($server)")
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

            // Fase 4 proxy auth. Android's WebView doesn't expose a distinct
            // "this challenge came from the proxy, not the site" flag the
            // way Electron's session 'login' event does with isProxy — this
            // is the one public callback for any 401/407 challenge. Answer
            // it with the account's proxy credentials when we have them;
            // cancel() otherwise falls through to the site's own auth UI.
            override fun onReceivedHttpAuthRequest(
                view: WebView,
                handler: android.webkit.HttpAuthHandler,
                host: String?,
                realm: String?
            ) {
                val user = proxyUsername
                val pass = proxyPassword
                if (!user.isNullOrEmpty()) {
                    handler.proceed(user, pass ?: "")
                } else {
                    handler.cancel()
                }
            }

            // Fase 3 adblock. isForMainFrame() is the exact equivalent of the
            // desktop blocker's `resourceType === 'mainFrame'` skip (main.js)
            // — never block the page's own navigation, only its subresources
            // (ad/tracker scripts, iframes, images, XHR/fetch).
            override fun shouldInterceptRequest(
                view: WebView,
                request: android.webkit.WebResourceRequest
            ): android.webkit.WebResourceResponse? {
                if (request.isForMainFrame) return null
                val blocked = AdBlocker.isBlockedHost(request.url.host)
                if (blocked) Log.d(TAG, "adblock: blocked ${request.url.host}")
                return if (blocked) {
                    android.webkit.WebResourceResponse(
                        "text/plain",
                        "utf-8",
                        java.io.ByteArrayInputStream(ByteArray(0))
                    )
                } else {
                    null
                }
            }

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
                injectAutofill(url)
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

    // Same origin-matching semantics as the desktop app's hostnameOf(): strip
    // a leading "www.", and if the string has no scheme, retry as if it did
    // (covers passwords saved with a bare "example.com" URL).
    private fun hostnameOf(url: String?): String? {
        if (url.isNullOrBlank()) return null
        val host = Uri.parse(url).host ?: Uri.parse("https://$url").host
        return host?.lowercase()?.removePrefix("www.")
    }

    // Fase 3: autocompletado de contraseñas. Pushed via evaluateJavascript()
    // rather than addJavascriptInterface() — a JS bridge exposes the app to
    // reflection-based RCE from any page it's ever injected into, whereas
    // evaluateJavascript() only ever runs a script this app wrote itself.
    // The tradeoff versus desktop's contextIsolated preload: this executes in
    // the page's own JS world, not a separate isolated one, so the matched
    // credentials are technically visible to the page's own scripts from the
    // moment of injection rather than only after the user picks one. Accepted
    // per the port plan — the alternative (addJavascriptInterface) is worse.
    // Nothing is auto-filled; the user must click a suggestion, same as desktop.
    private fun injectAutofill(url: String?) {
        val host = hostnameOf(url) ?: return
        lifecycleScope.launch {
            val matches = db.passwordDao().getAll().filter { hostnameOf(it.url) == host }
            if (matches.isEmpty()) return@launch
            val jsonMatches = JSONArray()
            matches.forEach { entry ->
                val password = try {
                    PasswordCrypto.decrypt(entry.encryptedPassword)
                } catch (e: Exception) {
                    Log.e(TAG, "failed to decrypt password ${entry.id}, skipping", e)
                    return@forEach
                }
                jsonMatches.put(
                    JSONObject().apply {
                        put("username", entry.username)
                        put("password", password)
                        put("name", entry.name)
                        put("url", entry.url)
                    }
                )
            }
            if (jsonMatches.length() == 0) return@launch
            webView.evaluateJavascript(buildAutofillScript(jsonMatches), null)
        }
    }

    private fun buildAutofillScript(matches: JSONArray): String = """
        (function() {
          if (window.__nexaAutofillInstalled) {
            window.__nexaAutofillMatches = $matches;
            return;
          }
          window.__nexaAutofillInstalled = true;
          window.__nexaAutofillMatches = $matches;

          function classifyField(input) {
            var type = (input.type || '').toLowerCase();
            if (type === 'password') return 'password';
            var hint = ((input.name || '') + ' ' + (input.id || '') + ' ' + (input.autocomplete || '')).toLowerCase();
            if (type === 'email' || hint.indexOf('email') >= 0 || hint.indexOf('user') >= 0 || hint.indexOf('login') >= 0) return 'username';
            return null;
          }

          function setNativeValue(el, value) {
            var proto = Object.getPrototypeOf(el);
            var descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
            if (descriptor && descriptor.set) descriptor.set.call(el, value); else el.value = value;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }

          function fillFrom(input, entry) {
            var form = input.closest('form') || document;
            var userField = form.querySelector('input[type="email"], input[autocomplete="username"], input[name*="user" i], input[name*="email" i], input[name*="login" i]') ||
              (classifyField(input) === 'username' ? input : null);
            var passField = form.querySelector('input[type="password"]');
            if (userField && entry.username) setNativeValue(userField, entry.username);
            if (passField && entry.password) setNativeValue(passField, entry.password);
            if (!passField && classifyField(input) === 'username' && entry.username) setNativeValue(input, entry.username);
            if (!userField && classifyField(input) === 'password' && entry.password) setNativeValue(input, entry.password);
          }

          var host = null, shadow = null;
          function ensureHost() {
            if (host && document.body.contains(host)) return;
            host = document.createElement('div');
            host.style.cssText = 'all:initial; position:fixed; z-index:2147483647;';
            document.documentElement.appendChild(host);
            shadow = host.attachShadow({ mode: 'closed' });
            var style = document.createElement('style');
            style.textContent = '.box { font-family: -apple-system, Segoe UI, Roboto, sans-serif; background:#fff; color:#1a1a1a; border:1px solid #dadce0; border-radius:8px; box-shadow:0 4px 16px rgba(0,0,0,0.25); min-width:220px; max-width:320px; overflow:hidden; } .row { display:flex; flex-direction:column; gap:2px; padding:9px 12px; cursor:pointer; } .row:hover { background:#f1f3f4; } .row + .row { border-top:1px solid #f0f0f0; } .user { font-size:13px; font-weight:600; } .src { font-size:11px; color:#5f6368; }';
            shadow.appendChild(style);
          }

          var openForInput = null;
          function hideDropdown() { if (host) host.style.display = 'none'; openForInput = null; }

          function showDropdown(input) {
            var current = window.__nexaAutofillMatches || [];
            if (!current.length) return;
            ensureHost();
            var box = shadow.querySelector('.box') || document.createElement('div');
            box.className = 'box';
            box.replaceChildren();
            current.forEach(function(entry) {
              var row = document.createElement('div');
              row.className = 'row';
              var user = document.createElement('div');
              user.className = 'user';
              user.textContent = entry.username || entry.name || entry.url;
              var src = document.createElement('div');
              src.className = 'src';
              src.textContent = 'Contraseña guardada';
              row.appendChild(user);
              row.appendChild(src);
              row.onmousedown = function(e) { e.preventDefault(); fillFrom(input, entry); hideDropdown(); };
              box.appendChild(row);
            });
            if (!shadow.contains(box)) shadow.appendChild(box);
            var rect = input.getBoundingClientRect();
            host.style.left = Math.round(rect.left) + 'px';
            host.style.top = Math.round(rect.bottom + 4) + 'px';
            host.style.display = 'block';
            openForInput = input;
          }

          document.addEventListener('mousedown', function(e) {
            var target = e.target;
            if (target && target.tagName === 'INPUT' && classifyField(target)) { showDropdown(target); return; }
            var insideDropdown = host && host.contains(target);
            if (!insideDropdown && openForInput) hideDropdown();
          }, true);

          window.addEventListener('scroll', hideDropdown, true);
        })();
    """.trimIndent()

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
