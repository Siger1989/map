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
function pressBack({
  panel = false,
  editing = false,
  section = false,
  photo = false,
  quickAdd = false,
  modal = false,
  sectionList = false,
} = {}) {
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
        const target =
          selector === '.route-dialog'
            ? modal
              ? 'modal'
              : null
            : selector === '.section-list'
              ? sectionList
                ? 'sectionList'
                : null
              : selector.includes('trip-photo-viewer')
                ? photo
                  ? 'photo'
                  : null
                : selector.includes('quick-add')
                  ? quickAdd
                    ? 'quickAdd'
                    : null
                  : selector.includes('control-dock')
                    ? panel
                      ? 'panel'
                      : null
                    : section && selector.includes('data-section')
                      ? 'section'
                      : editing && selector.includes('observatory')
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
test('安卓返回先关闭地图添加卡片，不退出应用或底层编辑', () => {
  const result = pressBack({ quickAdd: true, panel: true, editing: true });
  assert.equal(result.handled, true);
  assert.equal(result.calls[0].target, 'quickAdd');
  assert.equal(result.calls[0].key, 'Escape');
});
test('安卓返回优先退出全屏海拔剖面', () => {
  const result = pressBack({ section: true });
  assert.equal(result.handled, true);
  assert.equal(result.calls[0].target, 'section');
  assert.equal(result.calls[0].key, 'Escape');
});

test('安卓返回关闭照片预览，保留底下的编辑状态', () => {
  const result = pressBack({ photo: true, editing: true });
  assert.equal(result.handled, true);
  assert.equal(result.calls[0].target, 'photo');
});

test('安卓返回优先关闭路线对话框或多剖面列表', () => {
  assert.equal(
    pressBack({ modal: true, sectionList: true, panel: true }).calls[0].target,
    'modal',
  );
  assert.equal(
    pressBack({ sectionList: true, panel: true }).calls[0].target,
    'sectionList',
  );
});
