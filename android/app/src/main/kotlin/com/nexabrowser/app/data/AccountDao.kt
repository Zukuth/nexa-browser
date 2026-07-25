package com.nexabrowser.app.data

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface AccountDao {
    @Query("SELECT * FROM accounts ORDER BY createdAt ASC")
    fun observeAll(): Flow<List<Account>>

    @Query("SELECT * FROM accounts ORDER BY createdAt ASC")
    suspend fun getAll(): List<Account>

    @Query("SELECT * FROM accounts WHERE id = :id")
    suspend fun getById(id: String): Account?

    @Insert
    suspend fun insert(account: Account)

    @Query("UPDATE accounts SET url = :url, lastActiveAt = :lastActiveAt WHERE id = :id")
    suspend fun updateUrl(id: String, url: String, lastActiveAt: Long)

    @Query("UPDATE accounts SET name = :name WHERE id = :id")
    suspend fun rename(id: String, name: String)

    @Delete
    suspend fun delete(account: Account)
}
