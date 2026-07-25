package com.nexabrowser.app

import android.app.Application
import android.util.Log
import com.nexabrowser.app.adblock.AdBlockRefreshWorker
import com.nexabrowser.app.adblock.AdBlocker

/**
 * Runs once per Android process — and on a multi-process app, that means once
 * per *slot*, since each `android:process` entry in the manifest gets its own
 * completely separate Application instance. That's the whole trick behind
 * per-account isolation: there is no per-WebView-instance partition API on
 * Android, only this per-process one, so "one account = one process" is not
 * an implementation detail, it's the only way this works at all.
 *
 * setDataDirectorySuffix() is NOT called here even though this runs early
 * enough to do it — it needs the account ID, which isn't known yet at
 * Application.onCreate() time (only the launching Intent has it, and that's
 * only available once an Activity is created). A slot process outlives many
 * different accounts over the app's life (LRU eviction reassigns slots), so
 * keying the suffix off the process/slot name instead of the account would
 * mean two different accounts sharing one slot's on-disk WebView data
 * directory — exactly the cross-account leak this whole architecture exists
 * to prevent. See WebViewSlotActivity.onCreate() for where this actually
 * happens, keyed off the account ID instead.
 */
class NexaApplication : Application() {

    override fun onCreate() {
        super.onCreate()
        val processName = currentProcessName()
        Log.d(TAG, "onCreate in process: $processName")

        // Both of these are pushed to a background thread rather than run
        // inline here — empirically, doing this synchronously in
        // Application.onCreate() reproducibly caused a ~15s stall (WorkManager's
        // first-touch initialization, most likely) that tripped Android's own
        // "process failed to complete startup" ANR before a single Activity
        // ever got a chance to draw. Application.onCreate() has to return fast;
        // neither of these needs to finish before the first Activity shows.
        Thread {
            // Every process (main + each slot) keeps its own in-memory copy
            // of whatever list is cached, same reasoning as the comment on
            // AdBlocker itself.
            AdBlocker.loadCached(this)

            // Only the main process should own the periodic refresh job —
            // scheduling it from every slot process too would be four
            // redundant registrations of the exact same unique work name
            // (harmless thanks to KEEP, but pointless).
            if (processName == packageName) {
                AdBlockRefreshWorker.schedule(this)
            }
        }.start()
    }

    private fun currentProcessName(): String =
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
            Application.getProcessName()
        } else {
            packageName
        }

    companion object {
        private const val TAG = "NexaApplication"
    }
}
