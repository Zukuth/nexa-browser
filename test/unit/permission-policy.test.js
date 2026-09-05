// The web-permission policy decides, per site, whether a page gets the
// camera, the microphone, the user's location, or the ability to hand an
// arbitrary URI to an installed protocol handler. It had no tests at all.
//
// permissions-manager.js requires game-telemetry.js and electron at module
// load, so electron is mocked first — same approach as store.test.js.
const { test, describe, mock } = require('node:test');
const assert = require('node:assert/strict');

mock.module('electron', {
  exports: {
    ipcMain: { handle: () => {}, on: () => {}, removeListener: () => {} },
    session: { fromPartition: () => ({}) },
    BrowserWindow: class {}
  }
});

const {
  ALLOWED_PERMISSIONS,
  GAME_DENIED_PERMISSIONS,
  PROMPTABLE_PERMISSIONS
} = require('../../electron/permissions-manager');

describe('permission policy sets', () => {
  test('the privacy-sensitive permissions are all promptable, never auto-granted', () => {
    for (const p of ['media', 'notifications', 'geolocation']) {
      assert.ok(PROMPTABLE_PERMISSIONS.has(p), `${p} must be promptable`);
      assert.ok(ALLOWED_PERMISSIONS.has(p), `${p} must be a known permission`);
    }
  });

  test('promptable is a strict subset of allowed', () => {
    // A permission that is promptable but not allowed could never be granted;
    // one that is allowed but unknown to the policy map can't exist by
    // construction, since both sets derive from PERMISSION_POLICY.
    for (const p of PROMPTABLE_PERMISSIONS) {
      assert.ok(ALLOWED_PERMISSIONS.has(p), `${p} is promptable but not allowed`);
    }
    assert.ok(PROMPTABLE_PERMISSIONS.size < ALLOWED_PERMISSIONS.size);
  });

  test('anything not explicitly listed is denied', () => {
    // Electron's default is to deny unknown permissions, and applyPermissionHandler
    // reproduces that via !ALLOWED_PERMISSIONS.has(permission). These are real
    // Chromium permission names the app deliberately does not grant.
    for (const p of ['display-capture', 'clipboard-read', 'usb', 'serial', 'hid', 'idle-detection', 'window-management']) {
      assert.equal(ALLOWED_PERMISSIONS.has(p), false, `${p} must not be allowed`);
    }
  });

  test('the low-risk permissions are auto-granted without a prompt', () => {
    for (const p of ['fullscreen', 'pointerLock', 'midi', 'clipboard-sanitized-write']) {
      assert.ok(ALLOWED_PERMISSIONS.has(p), `${p} should be allowed`);
      assert.equal(PROMPTABLE_PERMISSIONS.has(p), false, `${p} should not prompt`);
    }
  });
});

describe('game-account permission narrowing', () => {
  test('the game gets no camera/mic, no location, and no protocol-handler access', () => {
    // A game has no legitimate use for any of these, and openExternal in
    // particular lets a page silently hand a URI to an installed app.
    assert.deepEqual(
      [...GAME_DENIED_PERMISSIONS].sort(),
      ['geolocation', 'media', 'openExternal']
    );
  });

  test('everything denied for the game is a permission the policy otherwise knows', () => {
    // Guards against a typo silently doing nothing: a name in the denial set
    // that isn't a real policy key would deny something that was never
    // grantable anyway, while the intended permission stayed allowed.
    for (const p of GAME_DENIED_PERMISSIONS) {
      assert.ok(ALLOWED_PERMISSIONS.has(p), `${p} is denied for games but is not a known permission`);
    }
  });

  test('notifications stay available to the game (it prompts like anywhere else)', () => {
    assert.equal(GAME_DENIED_PERMISSIONS.has('notifications'), false);
  });
});
