package com.nexabrowser.app

import android.app.Application
import android.os.Build
import android.webkit.WebView
import android.util.Log
import androidx.webkit.WebViewFeature

/**
 * Runs once per Android process — and on a multi-process app, that means once
 * per *slot*, since each `android:process` entry in the manifest gets its own
 * completely separate Application instance. That's the whole trick behind
 * per-account isolation: there is no per-WebView-instance partition API on
 * Android, only this per-process one, so "one account = one process" is not
 * an implementation detail, it's the only way this works at all.
 *
 * setDataDirectorySuffix() MUST run here, before any WebView is constructed
 * anywhere in this process — Activity.onCreate() is already too late if the
 * layout inflates a <WebView>, so this has to happen in Application.onCreate().
 */
class NexaApplication : Application() {

    override fun onCreate() {
        super.onCreate()

        val processName = currentProcessName()
        Log.d(TAG, "onCreate in process: $processName")

        // The main/launcher process (no ":suffix") never touches a WebView
        // directly and gets no suffix — only slot processes need one.
        if (processName == packageName) return

        val slotSuffix = processName.substringAfterLast(':', "")
        if (slotSuffix.isEmpty()) return

        if (!WebViewFeature.isStartupFeatureSupported(this, WebViewFeature.STARTUP_FEATURE_SET_DATA_DIRECTORY_SUFFIX)) {
            Log.e(TAG, "setDataDirectorySuffix unsupported on this WebView build — slot $slotSuffix will NOT be isolated")
            return
        }

        try {
            WebView.setDataDirectorySuffix(slotSuffix)
            Log.d(TAG, "setDataDirectorySuffix(\"$slotSuffix\") applied for this process")
        } catch (e: IllegalStateException) {
            // Means a WebView (or another component that touches one) was
            // already created in this process before we got here — the whole
            // point of doing this in Application.onCreate() is to prevent
            // exactly this, so if it happens, something upstream is wrong.
            Log.e(TAG, "setDataDirectorySuffix failed — a WebView already existed in this process", e)
        }
    }

    private fun currentProcessName(): String =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            Application.getProcessName()
        } else {
            packageName
        }

    companion object {
        private const val TAG = "NexaApplication"
    }
}
