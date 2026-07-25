package com.nexabrowser.app.data

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * A saved login, matched to sites by hostname — same model as
 * data.passwords[] on desktop. encryptedPassword is ciphertext produced by
 * PasswordCrypto; the plaintext password never gets its own column and only
 * ever exists in memory transiently after a decrypt() call.
 */
@Entity(tableName = "passwords")
data class PasswordEntry(
    @PrimaryKey val id: String,
    val name: String,
    val url: String,
    val username: String,
    val encryptedPassword: ByteArray,
    val createdAt: Long
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is PasswordEntry) return false
        return id == other.id && name == other.name && url == other.url &&
            username == other.username && encryptedPassword.contentEquals(other.encryptedPassword) &&
            createdAt == other.createdAt
    }

    override fun hashCode(): Int {
        var result = id.hashCode()
        result = 31 * result + name.hashCode()
        result = 31 * result + url.hashCode()
        result = 31 * result + username.hashCode()
        result = 31 * result + encryptedPassword.contentHashCode()
        result = 31 * result + createdAt.hashCode()
        return result
    }
}
