package com.nexabrowser.app.data

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * One browsing account/profile — the same concept as an "account" in the
 * desktop app's data.json, minus the fields that don't translate to phone
 * screens (widthFrac/freeRect layout geometry has no meaning without a
 * multi-panel grid).
 */
@Entity(tableName = "accounts")
data class Account(
    @PrimaryKey val id: String,
    val name: String,
    val url: String,
    val colorHex: String,
    val createdAt: Long,
    val lastActiveAt: Long
)
