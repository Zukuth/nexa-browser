const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { classifyCrash } = require('../../electron/crash-classifier');

describe('classifyCrash', () => {
  test('renderer crashed (no type) is category Renderer, critical severity', () => {
    const result = classifyCrash({ reason: 'crashed' });
    assert.equal(result.category, 'Renderer');
    assert.equal(result.severity, 'critical');
    assert.equal(result.shouldDisableGpu, false);
  });

  test('renderer clean-exit is info severity, not critical', () => {
    const result = classifyCrash({ reason: 'clean-exit' });
    assert.equal(result.severity, 'info');
  });

  test('renderer oom is critical', () => {
    assert.equal(classifyCrash({ reason: 'oom' }).severity, 'critical');
  });

  test('renderer killed is critical', () => {
    assert.equal(classifyCrash({ reason: 'killed' }).severity, 'critical');
  });

  test('renderer abnormal-exit is critical', () => {
    assert.equal(classifyCrash({ reason: 'abnormal-exit' }).severity, 'critical');
  });

  test('renderer launch-failed is critical', () => {
    assert.equal(classifyCrash({ reason: 'launch-failed' }).severity, 'critical');
  });

  test('renderer integrity-failure is critical', () => {
    assert.equal(classifyCrash({ reason: 'integrity-failure' }).severity, 'critical');
  });

  test('an unrecognized reason falls back to warning severity, not critical or thrown', () => {
    const result = classifyCrash({ reason: 'something-new-electron-added' });
    assert.equal(result.severity, 'warning');
  });

  test('GPU crashed flags shouldDisableGpu true', () => {
    const result = classifyCrash({ reason: 'crashed', type: 'GPU' });
    assert.equal(result.category, 'GPU');
    assert.equal(result.shouldDisableGpu, true);
  });

  test('GPU clean-exit does NOT flag shouldDisableGpu (a graceful GPU process exit is not a crash-loop signal)', () => {
    const result = classifyCrash({ reason: 'clean-exit', type: 'GPU' });
    assert.equal(result.shouldDisableGpu, false);
  });

  test('Network Service crash is its own category, not conflated with Renderer or GPU', () => {
    const result = classifyCrash({ reason: 'crashed', type: 'Network Service' });
    assert.equal(result.category, 'Network Service');
    assert.equal(result.shouldDisableGpu, false);
  });

  test('Utility process crash is its own category', () => {
    const result = classifyCrash({ reason: 'crashed', type: 'Utility' });
    assert.equal(result.category, 'Utility');
  });

  test('missing details object entirely does not throw, returns a safe/unknown classification', () => {
    assert.doesNotThrow(() => classifyCrash());
    const result = classifyCrash();
    assert.equal(result.category, 'Renderer');
    assert.equal(result.reason, 'unknown');
    assert.equal(result.severity, 'warning');
  });
});
