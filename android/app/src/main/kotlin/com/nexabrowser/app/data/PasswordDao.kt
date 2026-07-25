package com.nexabrowser.app.data

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface PasswordDao {
    @Query("SELECT * FROM passwords ORDER BY createdAt DESC")
    fun observeAll(): Flow<List<PasswordEntry>>

    // Matching is done in Kotlin (hostnameOf comparison), same as the
    // desktop's autofill:query handler — the list is small enough per user
    // that filtering in SQL isn't worth the string-parsing complexity there.
    @Query("SELECT * FROM passwords")
    suspend fun getAll(): List<PasswordEntry>

    @Insert
    suspend fun insert(entry: PasswordEntry)

    @Delete
    suspend fun delete(entry: PasswordEntry)
}
