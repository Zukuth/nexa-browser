package com.nexabrowser.app.data

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface SpaceDao {
    @Query("SELECT * FROM spaces ORDER BY createdAt ASC")
    fun observeAll(): Flow<List<Space>>

    @Query("SELECT * FROM spaces ORDER BY createdAt ASC")
    suspend fun getAll(): List<Space>

    @Insert
    suspend fun insert(space: Space)

    @Delete
    suspend fun delete(space: Space)
}
