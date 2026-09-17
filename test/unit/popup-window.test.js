// createAnchoredPopup() builds the small frameless windows used by the
// permission prompt and the extension toolbar popup, and places them
// relative to the main window. electron is mocked so the construction
// options and the final position can be inspected directly.
const { test, describe, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');

let created = [];
class FakeWindow {
  constructor(options) {
    this.options = options;
    this.position = null;
    created.push(this);
  }
  setPosition(x, y) {
    this.position = [x, y];
  }
}

mock.module('electron', { exports: { BrowserWindow: FakeWindow } });

const { createAnchoredPopup } = require('../../electron/popup-window');

function mainWindow(bounds, { destroyed = false } = {}) {
  return { getBounds: () => bounds, isDestroyed: () => destroyed };
}

beforeEach(() => {
  created = [];
});

describe('createAnchoredPopup()', () => {
  test('creates a frameless, fixed-size, always-on-top window off the taskbar', () => {
    const popup = createAnchoredPopup(() => null, { width: 380, height: 150 });
    assert.equal(created.length, 1);
    assert.deepEqual(popup.options, {
      width: 380,
      height: 150,
      resizable: false,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true
    });
  });

  test('windowOptions are added and can override the defaults', () => {
    const popup = createAnchoredPopup(() => null, {
      width: 100,
      height: 50,
      windowOptions: {
        backgroundColor: '#000',
        alwaysOnTop: false,
        webPreferences: { sandbox: true }
      }
    });
    assert.equal(popup.options.backgroundColor, '#000');
    assert.equal(popup.options.alwaysOnTop, false);
    assert.deepEqual(popup.options.webPreferences, { sandbox: true });
    assert.equal(popup.options.frame, false);
  });

  test('top-center (the default) centers horizontally, 90px below the main window top', () => {
    const popup = createAnchoredPopup(
      () => mainWindow({ x: 100, y: 50, width: 1280, height: 800 }),
      { width: 380, height: 150 }
    );
    assert.deepEqual(popup.position, [100 + (1280 - 380) / 2, 50 + 90]);
  });

  test('top-right sits 20px in from the right edge', () => {
    const popup = createAnchoredPopup(() => mainWindow({ x: 0, y: 0, width: 1000, height: 700 }), {
      width: 300,
      height: 400,
      anchor: 'top-right'
    });
    assert.deepEqual(popup.position, [1000 - 300 - 20, 90]);
  });

  test('offsetY moves it vertically and fractional coordinates are rounded', () => {
    const popup = createAnchoredPopup(
      () => mainWindow({ x: 10.4, y: 20.6, width: 501, height: 400 }),
      {
        width: 200,
        height: 100,
        offsetY: 40
      }
    );
    assert.deepEqual(popup.position, [Math.round(10.4 + (501 - 200) / 2), Math.round(20.6 + 40)]);
    assert.ok(popup.position.every(Number.isInteger));
  });

  test('works on a secondary monitor with negative coordinates', () => {
    const popup = createAnchoredPopup(
      () => mainWindow({ x: -1920, y: -200, width: 1920, height: 1080 }),
      { width: 380, height: 150 }
    );
    assert.deepEqual(popup.position, [-1920 + (1920 - 380) / 2, -200 + 90]);
  });

  test('without a main window the popup is created but not positioned', () => {
    const popup = createAnchoredPopup(() => null, { width: 380, height: 150 });
    assert.equal(popup.position, null);
  });

  test('a destroyed main window is never read', () => {
    const destroyed = {
      isDestroyed: () => true,
      getBounds: () => {
        throw new Error('Object has been destroyed');
      }
    };
    const popup = createAnchoredPopup(() => destroyed, { width: 380, height: 150 });
    assert.equal(popup.position, null);
  });

  test('the main window is looked up when the popup is created, not earlier', () => {
    let current = null;
    const getMainWindow = () => current;
    assert.equal(createAnchoredPopup(getMainWindow, { width: 10, height: 10 }).position, null);
    current = mainWindow({ x: 0, y: 0, width: 110, height: 100 });
    assert.deepEqual(
      createAnchoredPopup(getMainWindow, { width: 10, height: 10 }).position,
      [50, 90]
    );
  });
});
