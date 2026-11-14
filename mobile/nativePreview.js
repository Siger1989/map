import { installPhonePreviewMaterial } from './phonePreviewMaterial.js';
import { MATERIAL_SCHEMA, MATERIAL_TOKEN_NAMES, validateMaterial } from '../modules/appearance/materialRuntime.js';
const base='/native-preview-api',screen=document.querySelector('#screen'),host=document.querySelector('#parameter-host');
const message=document.querySelector('#material-status'),error=document.querySelector('#error');
let token='',paused=true,capturing=false,timer,objectUrl='',controller,supported=false,revision=0,effective={},userEdit=false,applyTimer,applying=false,pending=null,generation=0;
const fail=text=>{error.textContent=text;error.hidden=!text;};
async function api(path,body,retry=true){
  const response=await fetch(base+path,body?{method:'POST',headers:{'Content-Type':'application/json','X-Preview-Token':token},body:JSON.stringify(body)}:{cache:'no-store'});
  if(response.status===403&&body&&retry){const state=await api('/state');token=state.token;return api(path,body,false);}
  const value=await response.json();if(!response.ok)throw Error(value.error||'连接失败');return value;
}
async function capture(){
  if(capturing)return;capturing=true;clearTimeout(timer);
  try{
    const response=await fetch(base+'/frame.png?t='+Date.now(),{cache:'no-store'});
    if(!response.ok)throw Error('画面读取失败；屏幕上可能是上次截图。');
    const next=URL.createObjectURL(await response.blob());
    await new Promise((resolve,reject)=>{screen.onload=resolve;screen.onerror=reject;screen.src=next;});
    if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=next;
    document.querySelector('#status').textContent=`${screen.naturalWidth}×${screen.naturalHeight} 原始PNG · ${new Date().toLocaleTimeString()} · 低频刷新非App帧率 · 拖动松开后执行`;
    fail('');
  }catch(e){fail(e.message||'截图无法显示');}
  finally{capturing=false;if(!paused&&!document.hidden)timer=setTimeout(capture,1200);}
}
async function flush(){
  if(applying||!pending||!supported)return;
  applying=true;const payload=pending;pending=null;const current=generation;
  try{
    const material=validateMaterial({schema:MATERIAL_SCHEMA,revision:revision+1,tokens:payload});
    const result=await api('/material',{action:'material-apply',material});
    if(!result.ok)throw Error(result.error||'App未应用参数');
    if(current!==generation)return;
    revision=result.material.revision;effective=result.material.tokens;
    message.textContent=`App已生效 · 参数版本 ${revision} · 临时调色，导出后可用于后续交付`;
    document.querySelector('#export').disabled=false;capture();
  }catch(e){message.textContent=e.message;}
  finally{applying=false;if(pending)flush();}
}
async function connect(){
  generation++;pending=null;clearTimeout(applyTimer);supported=false;userEdit=false;
  controller?.destroy();controller=null;document.querySelector('#export').disabled=true;
  const sidebar=document.querySelector('#preview-material');
  sidebar.className='phone-preview-material';
  sidebar.innerHTML='<h2 style="font-size:15px">安卓调色尚未接通</h2><p>此页仅用于检查安卓截图，不能用于实时调色或连续拖图。</p><p>当前安装版本需要更新开发组件才能接收共用参数。</p><a href="/phone-preview.html" style="color:inherit;text-decoration:underline">返回可操作的网页调色</a><p>网页效果与手机效果仍需分别验证。</p>';
  try{
    const state=await api('/state');token=state.token;
    document.querySelector('#identity').textContent=`专用模拟器 ${state.device} · ${state.appPackage||'com.shantu.oldengine'} · 已安装 ${state.appVersion} · 画面以当前前台应用为准`;
    supported=state.material.ok&&state.material.supported;
    if(!supported){
      message.textContent='当前APK/助手未接入热调色。截图检查默认手动刷新；原配色保留。';
      fail('');capture();return;
    }
    const initial=supported?state.material.material:await api('/baseline');
    revision=initial.revision;effective=initial.tokens;
    message.textContent=supported?'已读取App实际参数；调整后等待App确认':'203原配色已保留。当前APK/助手未接入热调色，以下仅展示保存基线；调色控件暂不可用。';
    await new Promise(resolve=>{host.onload=resolve;host.srcdoc='<!doctype html><html data-ui-theme="light"><head></head><body></body></html>';});
    for(const [key,value] of Object.entries(effective))host.contentDocument.documentElement.style.setProperty(key,value);
    controller=installPhonePreviewMaterial({frame:host,remote:true,storagePrefix:`native.${Date.now()}.`,onTokensChange:()=>{
      if(!userEdit||!supported)return;
      // Send a full snapshot, so restoring a removed draft override also restores
      // that property on the device instead of leaving its last applied value.
      const computed=host.contentWindow.getComputedStyle(host.contentDocument.documentElement);
      pending=Object.fromEntries(MATERIAL_TOKEN_NAMES.map(name=>[name,computed.getPropertyValue(name).trim()]).filter(([,value])=>value));
      message.textContent='参数待同步到App…';clearTimeout(applyTimer);applyTimer=setTimeout(flush,150);
    }});
    document.querySelector('.phone-preview-material-note').textContent=supported?'App实际参数 · 临时调色':'203保存基线 · 未连接调色';
    document.querySelectorAll('#preview-material input,#preview-material select,#preview-material button').forEach(node=>{if(!node.classList.contains('phone-preview-material-toggle'))node.disabled=!supported;});
    document.querySelector('#export').disabled=!supported;
    fail('');capture();
  }catch(e){message.textContent='尚未连接安卓预览服务。';fail(e.message);}
}
const panel=document.querySelector('#preview-material');
for(const event of ['input','change','click'])panel.addEventListener(event,()=>{userEdit=true;},true);
document.querySelector('#pause').onclick=()=>{paused=!paused;document.querySelector('#pause').textContent=paused?'开始低频刷新':'暂停刷新';if(paused)clearTimeout(timer);else capture();};
document.querySelector('#refresh').onclick=capture;
document.querySelector('#retry').onclick=connect;
async function input(command){try{const result=await api('/input',command);if(!result.ok)throw Error(result.error);capture();}catch(e){fail(e.message);}}
document.querySelector('#back').onclick=()=>input({action:'back'});
document.querySelector('#launch').onclick=()=>input({action:'launch'});
function point(event){const r=screen.getBoundingClientRect();return{x:Math.max(0,Math.min(screen.naturalWidth-1,Math.round((event.clientX-r.left)*screen.naturalWidth/r.width))),y:Math.max(0,Math.min(screen.naturalHeight-1,Math.round((event.clientY-r.top)*screen.naturalHeight/r.height))) };}
let down=null;
screen.onpointerdown=event=>{if(!screen.naturalWidth)return;event.preventDefault();screen.setPointerCapture(event.pointerId);down={...point(event),at:Date.now()};};
screen.onpointerup=event=>{if(!down)return;const end=point(event),start=down;down=null;input(Math.hypot(end.x-start.x,end.y-start.y)<12?{action:'tap',x:start.x,y:start.y}:{action:'swipe',x:start.x,y:start.y,x2:end.x,y2:end.y,duration:Date.now()-start.at});};
screen.onpointercancel=()=>{down=null;};
document.querySelector('#export').onclick=()=>{const blob=new Blob([JSON.stringify({schema:MATERIAL_SCHEMA,revision,tokens:effective},null,2)],{type:'application/json'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='shantu-material.json';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);};
document.addEventListener('visibilitychange',()=>{clearTimeout(timer);if(!document.hidden&&!paused)capture();});
connect();
