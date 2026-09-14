export function TiandituHelp() {
  return (
    <details className="map-source-hint">
      <summary>天地图 Key 申请与使用</summary>
      <p>
        到天地图开发平台登录并申请应用
        Key，按官方说明配置权限。申请后可在“添加地图”中填写自己的天地图图源地址。
      </p>
      <a
        href="https://lbs.tianditu.gov.cn/server/search2.html"
        target="_blank"
        rel="noreferrer"
      >
        打开天地图官方申请说明
      </a>
      <p>含 Key 的图源地址保存在本机；转发配置前请移除 Key。</p>
    </details>
  );
}
