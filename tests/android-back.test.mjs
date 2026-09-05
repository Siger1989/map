import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const java = readFileSync(
  new URL(
    '../mobile/android/src/com/guanyun/weather/MainActivity.java',
    import.meta.url,
  ),
  'utf8',
);
const source = JSON.parse(
  java.match(/evaluateJavascript\(("(?:\\.|[^"\\])*"), result/)[1],
);
function pressBack({ panel = false, editing = false, section = false } = {}) {
  const calls = [];
  const context = {
    KeyboardEvent: class {
      constructor(type, details) {
        this.type = type;
        Object.assign(this, details);
      }
    },
    document: {
      querySelector(selector) {
        const target = selector.includes('control-dock')
          ? panel
            ? 'panel'
            : null
          : section && selector.includes('data-section')
            ? 'section'
            : editing
              ? 'editing'
              : null;
        return target
          ? {
              dispatchEvent(event) {
                calls.push({ target, key: event.key, bubbles: event.bubbles });
              },
            }
          : null;
      },
    },
  };
  return { handled: runInNewContext(source, context), calls };
}
test('安卓返回先关闭浮窗，不因轨迹编辑状态跳过关闭', () => {
  const result = pressBack({ panel: true, editing: true });
  assert.equal(result.handled, true);
  assert.equal(result.calls[0].target, 'panel');
  assert.equal(result.calls[0].key, 'Escape');
});
test('安卓返回在选点或绘制状态通知应用退出该操作', () => {
  const result = pressBack({ editing: true });
  assert.equal(result.handled, true);
  assert.equal(result.calls[0].target, 'editing');
  assert.equal(result.calls[0].bubbles, true);
});
test('普通地图页未消费返回键，交回系统', () => {
  const result = pressBack();
  assert.equal(result.handled, false);
  assert.equal(result.calls.length, 0);
});
test('安卓返回优先退出全屏海拔剖面', () => {
  const result = pressBack({ section: true });
  assert.equal(result.handled, true);
  assert.equal(result.calls[0].target, 'section');
  assert.equal(result.calls[0].key, 'Escape');
});
