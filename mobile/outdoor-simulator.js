import { advanceFix, interpolateLoop, makeSimFix, playbackDistance, SIM_SPEEDS } from '../modules/position/simulation.ts';

const permitted = import.meta.env.DEV && location.port === '9286' && ['localhost','127.0.0.1','[::1]'].includes(location.hostname);
const shell = document.querySelector('#shell'), frame = document.querySelector('#map'), state = document.querySelector('#state');
if (!permitted) { document.body.innerHTML = '<main style="margin:10vh auto;max-width:620px;padding:24px;background:#1d3025;color:white;border-radius:10px;font:16px system-ui"><h1>模拟预览仅限本机开发服务</h1><p>请由根代理启动独立服务后打开 <b>http://127.0.0.1:9286/outdoor-simulator.html</b>。此工具不会连接9174真实预览。</p></main>'; }
else {
  const $ = id => document.getElementById(id), mode = $('mode'), speedInput = $('speed'), headingInput = $('heading');
  let fix = makeSimFix(104.066,30.659,0,0), running = false, lost = false, path = null, pathDistance = 0, last = 0, lastEmit = 0, connected = false;
  const emit = type => frame.contentWindow?.postMessage(type === 'simulation:lost' ? { type } : { type, fix }, location.origin);
  const show = () => { state.innerHTML = `状态：${lost?'模拟信号超时':running?'移动中':connected?'模拟定位已连接 · 暂停':'等待连接'}<br>坐标：${fix.latitude.toFixed(6)}, ${fix.longitude.toFixed(6)}<br>速度：${fix.speed.toFixed(1)} m/s　方向：${Math.round(fix.heading)}° ${['北','东北','东','东南','南','西南','西','西北'][Math.round(fix.heading/45)%8]}<br>精度：±${fix.accuracy.toFixed(0)} m`; };
  const setSpeed = () => { let value = mode.value === 'custom' ? Number(speedInput.value) : SIM_SPEEDS[mode.value]; if (!Number.isFinite(value) || value < 0 || value > 30) { speedInput.setCustomValidity('速度需在0到30 m/s之间'); speedInput.reportValidity(); return null; } speedInput.setCustomValidity(''); speedInput.value = String(value); fix = { ...fix, speed: running ? value : 0, timestamp: Date.now() }; return value; };
  const stop = () => { running = false; fix = { ...fix, speed: 0, timestamp: Date.now() }; last = performance.now(); lastEmit = last; emit('simulation:fix'); show(); };
  const go = () => { const speed=setSpeed();if(speed===null)return;lost=false;running=true;last=performance.now();fix={...fix,speed,timestamp:Date.now()};lastEmit=last;emit('simulation:fix');show(); };
  const syncInputs = () => { $('lng').value = fix.longitude; $('lat').value = fix.latitude; headingInput.value = String(Math.round(fix.heading)); };
  frame.src = '/simulation-frame.html?sim=1#16/30.659/104.066/0/0'; frame.addEventListener('load', () => { connected = true; emit(lost ? 'simulation:lost':'simulation:init'); show(); });
  window.addEventListener('message', event => { if(event.source!==frame.contentWindow||event.origin!==location.origin||event.data?.type!=='simulation:ready') return; connected=true; emit(lost?'simulation:lost':'simulation:init'); show(); });
  mode.addEventListener('change', () => { if(mode.value!=='custom') speedInput.value=String(SIM_SPEEDS[mode.value]); if(running) setSpeed(); }); speedInput.addEventListener('change',()=>{ mode.value='custom'; if(running)setSpeed(); });
  $('start').onclick=go; $('pause').onclick=stop;
  $('reset').onclick=()=>{ stop(); lost=false; path=null; pathDistance=0; fix=makeSimFix(104.066,30.659,0,0,5); syncInputs(); emit('simulation:fix'); show(); };
  $('setStart').onclick=()=>{ try { running=false;path=null;pathDistance=0;fix=makeSimFix(Number($('lng').value),Number($('lat').value),0,Number(headingInput.value),Number($('accuracy').value));emit('simulation:fix');show(); } catch(e) { alert(e.message); } };
  headingInput.onchange=()=>{ const heading=Number(headingInput.value);if(!Number.isInteger(heading)||heading<0||heading>359){headingInput.value=String(Math.round(fix.heading));headingInput.reportValidity();return}path=null;pathDistance=0;fix={...fix,heading,timestamp:Date.now()};emit('simulation:fix');show(); };
  $('turnLeft').onclick=()=>{ path=null; pathDistance=0; fix={...fix,heading:(fix.heading+345)%360,timestamp:Date.now()}; headingInput.value=String(Math.round(fix.heading)); emit('simulation:fix'); show(); };
  $('turnRight').onclick=()=>{ path=null; pathDistance=0; fix={...fix,heading:(fix.heading+15)%360,timestamp:Date.now()}; headingInput.value=String(Math.round(fix.heading)); emit('simulation:fix'); show(); };
  document.querySelectorAll('[data-dir]').forEach(b=>b.onclick=()=>{ path=null; pathDistance=0; fix={...fix,heading:Number(b.dataset.dir),timestamp:Date.now()}; headingInput.value=String(Math.round(fix.heading)); emit('simulation:fix'); show(); });
  $('step').onclick=()=>{ try { running=false;path=null;pathDistance=0;fix=advanceFix(fix,5,fix.heading,0,Date.now()); fix.speed=0; syncInputs(); emit('simulation:fix'); show(); } catch(e){alert(e.message)} };
  const startPath = points => { const speed=setSpeed(); if(speed===null)return; path=points;pathDistance=0;running=true;last=performance.now();lastEmit=last;lost=false;fix={...fix,speed,timestamp:Date.now()};emit('simulation:fix');show(); };
  $('loopStart').onclick=()=>startPath([[fix.longitude,fix.latitude],[fix.longitude+0.0009,fix.latitude],[fix.longitude+0.0009,fix.latitude+0.0007],[fix.longitude,fix.latitude+0.0007],[fix.longitude,fix.latitude]]);
  $('outback').onclick=()=>startPath([[fix.longitude,fix.latitude],[fix.longitude+0.001,fix.latitude+0.0004],[fix.longitude,fix.latitude]]);
  $('lost').onclick=()=>{stop();lost=true;emit('simulation:lost');show()}; $('restore').onclick=()=>{lost=false;fix={...fix,timestamp:Date.now()};lastEmit=performance.now();emit('simulation:fix');show()};
  $('collapse').onclick=()=>{ $('console').classList.add('collapsed'); $('show').classList.remove('collapsed'); };
  $('show').onclick=()=>{ $('console').classList.remove('collapsed'); $('show').classList.add('collapsed'); };
  frame.title='模拟定位地图预览 · 非真机';
  if(innerWidth<=800)$('console').classList.add('collapsed');
  const fit=()=>{const scale=Math.min(1,Math.max(0.2,(document.querySelector('.framewrap').clientWidth-16)/404),(window.innerHeight-76)/871);const phone=document.querySelector('.phone');phone.style.width=(390*scale+14)+'px';phone.style.height=(857*scale+14)+'px';frame.style.width='390px';frame.style.height='857px';frame.style.left='7px';frame.style.top='7px';frame.style.transform='scale('+scale+')'};
  $('showTop').onclick=()=>$('console').classList.remove('collapsed'); $('collapse').onclick=()=>$('console').classList.add('collapsed'); addEventListener('resize',fit);fit(); show();
  const tick=now=>{ const elapsed=Math.max(0,now-last); last=now; if(running&&!lost){const speed=setSpeed(); if(speed!==null){const before=pathDistance;pathDistance=playbackDistance(pathDistance,speed,elapsed,true,1000);const dist=pathDistance-before; try { if(path){const p=interpolateLoop(path,pathDistance);fix=makeSimFix(p.point[0],p.point[1],speed,p.heading,fix.accuracy,Date.now())} else fix=advanceFix(fix,dist,fix.heading,speed,Date.now()); }catch(e){stop();console.error(e)} }} if(!lost&&now-lastEmit>=1000){fix={...fix,speed:running?fix.speed:0,timestamp:Date.now()};emit('simulation:fix');show();lastEmit=now;} requestAnimationFrame(tick);}; requestAnimationFrame(tick);
}

