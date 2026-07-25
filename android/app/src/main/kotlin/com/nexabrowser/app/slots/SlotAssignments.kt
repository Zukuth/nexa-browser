package com.nexabrowser.app.slots

import android.content.Context

/**
 * Which account currently occupies each of the 4 process slots, plus a
 * last-used timestamp per slot for LRU eviction. Backed by SharedPreferences
 * rather than Room deliberately: this is coordinator bookkeeping the main
 * process owns, not app data a slot process needs to read for itself.
 *
 * Survives the main process dying — which matters, since the slot processes
 * themselves can outlive it. On the next launch we trust this mapping as a
 * best guess; if a slot's process actually died in the meantime, relaunching
 * its Activity just cold-starts that process again with the same account
 * (its cookies/state already persisted to that slot's suffixed data
 * directory), so a stale-but-wrong mapping degrades gracefully rather than
 * breaking anything.
 */
class SlotAssignments(context: Context) {
    private val prefs = context.getSharedPreferences("slot_assignments", Context.MODE_PRIVATE)

    val slotCount = 4

    fun getAssignments(): Map<Int, String?> =
        (0 until slotCount).associateWith { prefs.getString(accountKey(it), null) }

    fun assign(slot: Int, accountId: String?) {
        prefs.edit().apply {
            if (accountId == null) remove(accountKey(slot)) else putString(accountKey(slot), accountId)
        }.apply()
    }

    fun touch(slot: Int) {
        prefs.edit().putLong(lastUsedKey(slot), System.currentTimeMillis()).apply()
    }

    fun getLastUsed(slot: Int): Long = prefs.getLong(lastUsedKey(slot), 0L)

    fun slotForAccount(accountId: String): Int? =
        getAssignments().entries.find { it.value == accountId }?.key

    private fun accountKey(slot: Int) = "slot_${slot}_account"
    private fun lastUsedKey(slot: Int) = "slot_${slot}_lastUsed"
}
