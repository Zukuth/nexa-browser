package com.nexabrowser.app.adblock

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/**
 * Refreshes the StevenBlack hosts list at most once a day. WorkManager
 * (not a process-lifetime timer) per the port plan: Android's Doze mode
 * kills ordinary background timers, but WorkManager's jobs survive it and
 * get deferred to the next maintenance window instead of just never firing.
 */
class AdBlockRefreshWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        if (AdBlocker.isStale(applicationContext)) {
            AdBlocker.refreshBlocking(applicationContext)
        }
        return Result.success()
    }

    companion object {
        private const val WORK_NAME = "adblock_refresh"

        fun schedule(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()
            val request = PeriodicWorkRequestBuilder<AdBlockRefreshWorker>(24, TimeUnit.HOURS)
                .setConstraints(constraints)
                .build()
            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, request)
        }
    }
}
