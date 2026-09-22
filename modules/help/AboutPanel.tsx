import {
  APP_VERSION,
  APP_VERSION_CODE,
  PRODUCT_NAME,
  PRODUCT_DESCRIPTION,
} from '../../config/product';
import { TUTORIALS } from './tutorials';
import { LayoutSettings } from '../uiLayout/LayoutSettings';
import './help.css';
import { useState } from 'react';
import { AppearanceSettings } from '../appearance/AppearanceSettings';

/** Product hub. Add future settings as separate sections without coupling to map tools. */
export function AboutPanel() {
  const [personalizing,setPersonalizing] = useState(false);
  if (personalizing) return <AppearanceSettings onBack={()=>setPersonalizing(false)}/>;
  return (
    <section className="about-panel" aria-label="山兔版本与使用教程">
      <header>
        <img
          src="/brand/shantu-logo.png"
          alt="山兔头像"
          width={42}
          height={42}
        />
        <div>
          <strong>{PRODUCT_NAME}</strong>
          <p>{PRODUCT_DESCRIPTION}</p>
        </div>
      </header>
      <button className="appearance-entry" onClick={()=>setPersonalizing(true)}>个性化 <span>配色风格 · 恢复默认 ›</span></button>
      <LayoutSettings />
      <dl>
        <dt>当前版本</dt>
        <dd>{APP_VERSION}</dd>
        <dt>构建号</dt>
        <dd>{APP_VERSION_CODE}</dd>
        <dt>更新日期</dt>
        <dd>2026-09-10</dd>
      </dl>
      <h3>使用教程</h3>
      <div className="help-topics">
        {TUTORIALS.map((topic) => (
          <details key={topic.id}>
            <summary>
              <strong>{topic.title}</strong>
              <small>{topic.summary}</small>
            </summary>
            <ol>
              {topic.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            {'note' in topic && <p>{topic.note}</p>}
          </details>
        ))}
      </div>
      <details className="about-platforms">
        <summary>版本说明与支持范围</summary>
        <p>
          当前为测试版。Android
          安装包与网页版复用业务功能；手机触控、系统保存与权限需要在设备上验证。
        </p>
        <p>
          HarmonyOS 6.1
          原生安装包尚未交付。地形覆盖、精度及署名以地图数据来源为准。
        </p>
      </details>
    </section>
  );
}
