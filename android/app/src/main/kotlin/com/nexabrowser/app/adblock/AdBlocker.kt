package com.nexabrowser.app.adblock

import android.content.Context
import android.util.Log
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Per-process ad/tracker blocklist — each account-slot process ends up with
 * its own in-memory copy, which is fine: they're already separate OS
 * processes (Fase 2), so there's no shared state to synchronize. Mirrors the
 * desktop app's isBlockedHost()/BUILTIN_BLOCKLIST/StevenBlack-list setup in
 * electron/main.js, applied via WebViewClient.shouldInterceptRequest()
 * instead of Electron's session.webRequest.onBeforeRequest().
 */
object AdBlocker {
    private const val TAG = "AdBlocker"
    private const val CACHE_FILE_NAME = "blocklist-cache.txt"
    private const val BLOCKLIST_URL = "https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts"
    const val STALE_AFTER_MS = 24L * 60 * 60 * 1000

    // Same curated starter list as the desktop app's BUILTIN_BLOCKLIST —
    // blocks the most common ad/analytics/tracking domains immediately, with
    // no network fetch needed, before the larger community-maintained
    // StevenBlack hosts list (cached to disk, refreshed at most once a day)
    // is available.
    private val BUILTIN_BLOCKLIST = setOf(
        "doubleclick.net", "googlesyndication.com", "googleadservices.com", "google-analytics.com",
        "googletagmanager.com", "googletagservices.com", "adservice.google.com", "pagead2.googlesyndication.com",
        "connect.facebook.net", "ads-twitter.com", "analytics.twitter.com",
        "amazon-adsystem.com", "adnxs.com", "adsrvr.org", "adroll.com", "criteo.com", "criteo.net",
        "taboola.com", "outbrain.com", "pubmatic.com", "rubiconproject.com", "openx.net", "media.net",
        "moatads.com", "scorecardresearch.com", "quantserve.com", "quantcast.com", "hotjar.com",
        "mixpanel.com", "segment.io", "segment.com", "fullstory.com", "mouseflow.com", "crazyegg.com",
        "mc.yandex.ru", "bat.bing.com", "ads.yahoo.com", "advertising.com",
        "adcolony.com", "applovin.com", "chartboost.com", "unityads.unity3d.com", "vungle.com",
        "ironsrc.com", "inmobi.com", "smartadserver.com", "adform.net", "flashtalking.com",
        "bidswitch.net", "casalemedia.com", "contextweb.com", "sharethrough.com", "triplelift.com",
        "yieldmo.com", "indexexchange.com", "sovrn.com", "gumgum.com", "teads.tv", "spotxchange.com",
        "tremorhub.com", "undertone.com", "zedo.com", "adtechus.com", "exelator.com", "demdex.net",
        "krxd.net", "bluekai.com", "rlcdn.com", "agkn.com", "adsymptotic.com", "mathtag.com",
        "turn.com", "rfihub.com", "simpli.fi", "tapad.com", "chango.com", "brightroll.com",
        "yieldlab.net", "improvedigital.com", "smartclip.net", "adtelligent.com", "sonobi.com",
        "33across.com", "lijit.com", "rhythmone.com", "freewheel.tv", "innovid.com",
        "newrelic.com", "nr-data.net", "bugsnag.com", "sentry.io", "amplitude.com",
        "clicktale.net", "clarity.ms", "histats.com", "statcounter.com", "analytics.google.com"
    )

    @Volatile private var blockedDomains: Set<String> = BUILTIN_BLOCKLIST

    private fun cacheFile(context: Context) = File(context.filesDir, CACHE_FILE_NAME)

    /** Cheap, synchronous disk read — call once per process at startup. */
    fun loadCached(context: Context) {
        try {
            val text = cacheFile(context).readText()
            val merged = BUILTIN_BLOCKLIST.toMutableSet()
            parseHostsFile(text, merged)
            blockedDomains = merged
            Log.d(TAG, "loaded cached list — ${blockedDomains.size} domains")
        } catch (e: Exception) {
            Log.d(TAG, "no cache yet — using built-in list of ${blockedDomains.size} domains")
        }
    }

    fun isBlockedHost(hostname: String?): Boolean {
        if (hostname.isNullOrEmpty()) return false
        var h = hostname.lowercase()
        while (h.contains('.')) {
            if (blockedDomains.contains(h)) return true
            h = h.substringAfter('.')
        }
        return false
    }

    fun isStale(context: Context): Boolean {
        val file = cacheFile(context)
        if (!file.exists()) return true
        return System.currentTimeMillis() - file.lastModified() > STALE_AFTER_MS
    }

    /** Blocking network call — only safe off the main thread. */
    fun refreshBlocking(context: Context) {
        try {
            val connection = URL(BLOCKLIST_URL).openConnection() as HttpURLConnection
            connection.setRequestProperty("User-Agent", "Mozilla/5.0")
            connection.connectTimeout = 15_000
            connection.readTimeout = 15_000
            if (connection.responseCode != 200) {
                connection.disconnect()
                return
            }
            val text = connection.inputStream.bufferedReader().use { it.readText() }
            connection.disconnect()
            cacheFile(context).writeText(text)
            val fresh = BUILTIN_BLOCKLIST.toMutableSet()
            parseHostsFile(text, fresh)
            blockedDomains = fresh
            Log.d(TAG, "refreshed list — ${blockedDomains.size} domains")
        } catch (e: Exception) {
            // Offline, blocked, or GitHub is down — keep using the
            // built-in/cached list rather than fail loudly.
            Log.d(TAG, "refresh failed, keeping current list: ${e.message}")
        }
    }

    private val HOSTS_LINE = Regex("""^\s*0\.0\.0\.0\s+(\S+)""", RegexOption.MULTILINE)

    private fun parseHostsFile(text: String, into: MutableSet<String>) {
        HOSTS_LINE.findAll(text).forEach { match ->
            val host = match.groupValues[1].lowercase()
            if (host != "localhost" && host != "0.0.0.0") into.add(host)
        }
    }
}
