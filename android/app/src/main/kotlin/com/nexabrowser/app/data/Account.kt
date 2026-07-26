package com.nexabrowser.app.data

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * One browsing account/profile — the same concept as an "account" in the
 * desktop app's data.json, minus the fields that don't translate to phone
 * screens (widthFrac/freeRect layout geometry has no meaning without a
 * multi-panel grid).
 *
 * proxyServer/proxyUsername/proxyPassword mirror desktop's account.proxy
 * object (Fase 4) — null/blank proxyServer means "no proxy", same as
 * desktop's `!account.proxy || !account.proxy.server` check. The proxy
 * password is stored as plain text here deliberately, matching desktop:
 * store.js only encrypts data.passwords[], never account.proxy.password.
 */
@Entity(tableName = "accounts")
data class Account(
    @PrimaryKey val id: String,
    val name: String,
    val url: String,
    val colorHex: String,
    val createdAt: Long,
    val lastActiveAt: Long,
    val spaceId: String,
    val proxyServer: String? = null,
    val proxyUsername: String? = null,
    val proxyPassword: String? = null
)
