package com.nexabrowser.app.data

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * Groups accounts together — the same concept as data.spaces[] on desktop.
 * Every install gets one seeded "General" space (MainActivity creates it on
 * first launch if the table is empty, mirroring desktop's DEFAULT_DATA.spaces),
 * so there's always at least one space for accounts to belong to.
 */
@Entity(tableName = "spaces")
data class Space(
    @PrimaryKey val id: String,
    val name: String,
    val colorHex: String,
    val createdAt: Long
)
