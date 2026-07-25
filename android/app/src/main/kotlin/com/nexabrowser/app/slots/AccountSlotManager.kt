package com.nexabrowser.app.slots

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.util.Log
import kotlinx.coroutines.delay

/**
 * The Fase 2 coordinator: decides which of the 4 process slots an account
 * lands in, and evicts the least-recently-used slot when all 4 are already
 * taken by other accounts. This is the piece the whole port's architecture
 * hinges on — see the Fase 2 section of the plan for why "one process per
 * account" isn't optional on Android.
 */
object AccountSlotManager {

    private const val TAG = "AccountSlotManager"

    private val SLOT_CLASSES = listOf(
        SlotActivity0::class.java,
        SlotActivity1::class.java,
        SlotActivity2::class.java,
        SlotActivity3::class.java
    )

    /** Opens (or brings to front) an account, evicting the LRU slot if needed. */
    suspend fun openAccount(context: Context, accountId: String, accountName: String) {
        val assignments = SlotAssignments(context)
        val current = assignments.getAssignments()

        val targetSlot = assignments.slotForAccount(accountId)
            ?: current.entries.find { it.value == null }?.key
            ?: run {
                val lruSlot = (0 until assignments.slotCount).minByOrNull { assignments.getLastUsed(it) }!!
                evictSlot(context, lruSlot)
                lruSlot
            }

        assignments.assign(targetSlot, accountId)
        assignments.touch(targetSlot)
        launchSlot(context, targetSlot, accountId, accountName)
    }

    /** Frees an account's slot (used when the account itself is deleted). */
    suspend fun closeAccount(context: Context, accountId: String) {
        val assignments = SlotAssignments(context)
        val slot = assignments.slotForAccount(accountId) ?: return
        evictSlot(context, slot)
        assignments.assign(slot, null)
    }

    private suspend fun evictSlot(context: Context, slot: Int) {
        val activityClass = SLOT_CLASSES[slot]
        if (!isProcessAlive(context, "wv$slot")) return
        Log.d(TAG, "evicting slot $slot ($activityClass)")
        val intent = Intent(context, activityClass).apply {
            putExtra(WebViewSlotActivity.EXTRA_TERMINATE, true)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
        // setDataDirectorySuffix is a one-shot-per-process-lifetime lock —
        // reusing this slot before the old process has actually finished
        // dying (Process.killProcess isn't instantaneous) would race against
        // it. A short wait is simpler and more robust here than polling
        // ActivityManager for the process to disappear.
        delay(400)
    }

    private fun launchSlot(context: Context, slot: Int, accountId: String, accountName: String) {
        val intent = Intent(context, SLOT_CLASSES[slot]).apply {
            putExtra(WebViewSlotActivity.EXTRA_ACCOUNT_ID, accountId)
            putExtra(WebViewSlotActivity.EXTRA_ACCOUNT_NAME, accountName)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
    }

    private fun isProcessAlive(context: Context, processSuffix: String): Boolean {
        val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val targetName = "${context.packageName}:$processSuffix"
        return am.runningAppProcesses?.any { it.processName == targetName } == true
    }
}
