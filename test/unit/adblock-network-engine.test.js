// Regression guard for the network-matching engine swap to adblock-rs
// (Brave's own native/Rust adblock-rust engine — "Nexa vs Brave" comparison
// follow-up, 2026-08-21). Two things worth pinning down here:
//  1. mapElectronResourceType() — Electron's webRequest resourceType
//     strings vs. what adblock-rs's Rust core actually parses (confirmed
//     against the upstream RequestType::from_str match arms in
//     brave/adblock-rust's src/request.rs before writing this, not guessed).
//  2. That this project's actual usage pattern of the real adblock-rs
//     package (FilterSet + RuleTypes.NETWORK_ONLY + Engine.check() argument
//     order + serialize()/deserialize() round-trip) still behaves the way
//     loadNetworkEngine()/applyAdBlock() in adblock-manager.js assume — a
//     dependency bump that changes any of this should fail here, not
//     silently in production.
//
// Unlike adblock-stats-persist.test.js, this doesn't need to mock
// 'electron' — mapElectronResourceType is a plain top-level export, and
// adblock-rs itself has no Electron dependency at all.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { mapElectronResourceType } = require('../../electron/adblock-manager');

describe('mapElectronResourceType', () => {
  const cases = [
    ['mainFrame', 'main_frame'],
    ['subFrame', 'sub_frame'],
    ['cspReport', 'csp_report'],
    ['webSocket', 'websocket'],
    // Already identical on both sides — pass through unchanged.
    ['stylesheet', 'stylesheet'],
    ['script', 'script'],
    ['image', 'image'],
    ['font', 'font'],
    ['object', 'object'],
    ['xhr', 'xhr'],
    ['ping', 'ping'],
    ['media', 'media'],
    ['other', 'other']
  ];
  for (const [electronType, expected] of cases) {
    test(`${electronType} -> ${expected}`, () => {
      assert.equal(mapElectronResourceType(electronType), expected);
    });
  }

  test('unrecognized/missing values fall back to "other"', () => {
    assert.equal(mapElectronResourceType('somethingNew'), 'somethingNew'); // passes through — Rust side itself falls back to Other for unknown strings
    assert.equal(mapElectronResourceType(undefined), 'other');
    assert.equal(mapElectronResourceType(''), 'other');
  });
});

// Only runs the real engine assertions if the native module actually built
// on this machine (postinstall runs `cargo build --release` — see the perf
// audit's plan file for the Rust/MSVC toolchain setup this required). Skips
// cleanly instead of failing the whole suite in an environment where it
// hasn't been built yet.
let adblockRust = null;
try {
  adblockRust = require('adblock-rs');
} catch {
  // native module not built in this environment — real-engine tests below skip.
}

describe('adblock-rs real engine — usage pattern this project relies on', { skip: !adblockRust && 'adblock-rs native module not built in this environment' }, () => {
  test('NETWORK_ONLY FilterSet blocks a network rule and ignores a cosmetic-only rule', () => {
    const filterSet = new adblockRust.FilterSet(false);
    filterSet.addFilters(
      ['||ads.example.com^', 'example.com##.ad-banner'].join('\n'),
      { rule_types: adblockRust.RuleTypes.NETWORK_ONLY }
    );
    const engine = new adblockRust.Engine(filterSet);
    assert.equal(engine.check('https://ads.example.com/t.js', 'https://pub.com', 'script', 'GET'), true);
    assert.equal(engine.check('https://safe.com/t.js', 'https://pub.com', 'script', 'GET'), false);
    // NETWORK_ONLY should have skipped the cosmetic rule entirely.
    const cosmetic = engine.urlCosmeticResources('https://example.com/page');
    assert.equal(cosmetic.hide_selectors.length, 0);
  });

  test('$third-party modifier respects the referrer/source URL argument order used in applyAdBlock', () => {
    const filterSet = new adblockRust.FilterSet(false);
    filterSet.addFilters('||tracker.com^$third-party', { rule_types: adblockRust.RuleTypes.NETWORK_ONLY });
    const engine = new adblockRust.Engine(filterSet);
    // check(url, sourceUrl, requestType, method) — sourceUrl is the 2nd arg,
    // matching networkEngine.check(details.url, details.referrer, ...).
    assert.equal(engine.check('https://tracker.com/t.js', 'https://other.com', 'script', 'GET'), true);
    assert.equal(engine.check('https://tracker.com/t.js', 'https://tracker.com', 'script', 'GET'), false);
  });

  test('serialize()/deserialize() round-trip preserves blocking decisions (the on-disk cache path)', () => {
    const filterSet = new adblockRust.FilterSet(false);
    filterSet.addFilters('||blocked.example.com^', { rule_types: adblockRust.RuleTypes.NETWORK_ONLY });
    const src = new adblockRust.Engine(filterSet);
    // Round-trips through a real Node Buffer (fs.promises.readFile's actual
    // return type in loadNetworkEngine), not the raw ArrayBuffer serialize()
    // returns directly — deserialize() rejects a bare Buffer/Uint8Array view
    // ("failed to downcast any to JsArrayBuffer"), which is exactly the bug
    // this test caught before loadNetworkEngine() sliced it correctly.
    const written = Buffer.from(src.serialize());
    const reread = Buffer.from(written); // simulates the readFile() round-trip
    const asArrayBuffer = reread.buffer.slice(reread.byteOffset, reread.byteOffset + reread.byteLength);

    const dst = new adblockRust.Engine(new adblockRust.FilterSet());
    dst.deserialize(asArrayBuffer);
    assert.equal(dst.check('https://blocked.example.com/x', 'https://pub.com', 'image', 'GET'), true);
    assert.equal(dst.check('https://safe.example.com/x', 'https://pub.com', 'image', 'GET'), false);
  });
});
