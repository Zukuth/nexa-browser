// @ts-check
// crashReporter.start() (see main.js) never prunes its own output -- .dmp
// files in userData/crashDumps accumulate forever unless something deletes
// them. Kept as its own pure-ish module (fs/now injectable) instead of
// inline in main.js so the actual deletion logic is unit-testable without
// spinning up a real Electron app, same reasoning as crash-classifier.js.
const fsDefault = require('fs');
const path = require('path');

const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Walks recursively (Crashpad's on-disk database uses subfolders like
// completed/new/attachments on Windows) deleting only files older than
// maxAgeMs -- directories are left in place since Crashpad expects that
// structure to exist even when currently empty.
function pruneCrashDumps(dir, { maxAgeMs = DEFAULT_MAX_AGE_MS, fs = fsDefault, now = Date.now() } = {}) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return { deleted: 0 };
  }
  const cutoff = now - maxAgeMs;
  let deleted = 0;
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      deleted += pruneCrashDumps(full, { maxAgeMs, fs, now }).deleted;
      continue;
    }
    try {
      if (fs.statSync(full).mtimeMs < cutoff) {
        fs.unlinkSync(full);
        deleted += 1;
      }
    } catch {
      // Best-effort cleanup — a file mid-write or already gone isn't worth surfacing.
    }
  }
  return { deleted };
}

// Same problem, same shape, different producer: diagnostics:startNetLog writes
// netlog-<accountId>-<timestamp>.json straight into userData, up to 20MB each,
// and nothing ever deleted them — unlike the crash dumps above, which have had
// this treatment since they were added. Flat (no recursion) and name-scoped so
// it can only ever touch files this app wrote.
const NETLOG_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function pruneNetLogs(dir, { maxAgeMs = NETLOG_MAX_AGE_MS, fs = fsDefault, now = Date.now() } = {}) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return { deleted: 0 };
  }
  const cutoff = now - maxAgeMs;
  let deleted = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!/^netlog-.*\.json$/.test(entry.name)) continue;
    const full = path.join(dir, entry.name);
    try {
      if (fs.statSync(full).mtimeMs < cutoff) {
        fs.unlinkSync(full);
        deleted += 1;
      }
    } catch {
      // Best-effort — a capture still being written, or already gone.
    }
  }
  return { deleted };
}

module.exports = { pruneCrashDumps, DEFAULT_MAX_AGE_MS, pruneNetLogs, NETLOG_MAX_AGE_MS };
