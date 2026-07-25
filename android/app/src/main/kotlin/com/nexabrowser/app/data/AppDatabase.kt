package com.nexabrowser.app.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

/**
 * Opened from every account-slot process as well as the main process — all
 * pointing at the same on-disk file. Room/SQLite handle concurrent access
 * from multiple OS processes safely as long as WAL is on (the default
 * journal mode isn't multi-process-safe for writers). What this does NOT
 * give us for free is live cross-process UI refresh: a slot process writing
 * a new URL won't push that update into another process's in-memory Flow
 * collectors. Good enough for Fase 2 — the account list re-reads on resume
 * rather than needing a push channel between processes.
 */
@Database(entities = [Account::class], version = 1, exportSchema = false)
abstract class AppDatabase : RoomDatabase() {
    abstract fun accountDao(): AccountDao

    companion object {
        @Volatile private var instance: AppDatabase? = null

        fun getInstance(context: Context): AppDatabase =
            instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    "nexa-browser.db"
                )
                    .setJournalMode(JournalMode.WRITE_AHEAD_LOGGING)
                    .build()
                    .also { instance = it }
            }
    }
}
