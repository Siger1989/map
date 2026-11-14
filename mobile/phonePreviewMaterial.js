import { MATERIAL_GROUPS, MATERIAL_RADIUS_RULES, clamp, sharedControlRadius, parseColor, rgbToHsl, hslToRgb, hexFromRgb, rgbaValue, linkedPanelDraft, editMaterialGroup } from './phonePreviewMaterialGroups.js';
import { installMaterialTargets } from './phonePreviewMaterialTargets.js';
import { selectedMaterialInk } from './phonePreviewMaterialContrast.js';
import { MATERIAL_DIMENSIONS } from '../modules/appearance/materialDimensions.js';

const MATERIALS = [
  { id:'glass', label:'整体玻璃底', tokens:['--ui-glass-surface'], base:null },
  { id:'panel', label:'普通窗口', tokens:['--ui-material-panel'], base:'--ui-glass-surface' },
  { id:'favorites', label:'收藏夹底板', tokens:['--ui-material-favorites'], base:'--ui-glass-surface' },
  { id:'topbar', label:'顶部栏', tokens:['--ui-material-topbar'], base:'--ui-glass-surface' },
  { id:'bottom', label:'底部导航', tokens:['--ui-material-bottom'], base:'--ui-glass-surface' },
  { id:'rail', label:'右侧工具/锁定', tokens:['--ui-material-rail'], base:'--ui-glass-surface' },
  { id:'toast', label:'提示条', tokens:['--ui-material-toast'], base:'--ui-glass-surface' },
  { id:'button', label:'次要按钮', tokens:['--ui-button','--ui-raised'], base:'--ui-button' },
  { id:'subtle', label:'轻按钮/关闭返回', tokens:['--ui-control-subtle'], base:null },
  { id:'close', label:'关闭图标', tokens:['--ui-close'], base:null },
  { id:'field', label:'输入/选项底板', tokens:['--ui-field'], base:null },
  { id:'selected', label:'选中底板', tokens:['--ui-selected','--ui-active'], base:null },
  { id:'accent', label:'主按钮/强调色', tokens:['--ui-accent'], base:null },
  { id:'accentText', label:'主按钮文字', tokens:['--ui-on-accent'], base:null },
  { id:'ink', label:'正文/图标', tokens:['--ui-ink','--ui-glass-ink','--ui-button-ink'], base:null },
  { id:'muted', label:'辅助文字', tokens:['--ui-muted','--ui-glass-muted'], base:null },
  { id:'line', label:'分隔线', tokens:['--ui-line','--ui-glass-line'], base:'--ui-glass-line' },
  { id:'edge', label:'窗口边缘', tokens:['--ui-glass-border'], base:null },
  { id:'switchOn', label:'开关开启', tokens:['--ui-switch-on'], base:null },
  { id:'switchOff', label:'开关关闭', tokens:['--ui-switch-off'], base:null },
  { id:'knob', label:'开关滑块', tokens:['--ui-on-switch','--ui-on-switch-off'], base:'--ui-on-switch' },
];

function parseDraft(raw) {
  try { const value=JSON.parse(raw);return value&&typeof value==='object'&&!Array.isArray(value)?value:{}; } catch { return {}; }
}

export function installPhonePreviewMaterial({ frame, onLayoutChange = () => {}, onTokensChange = () => {}, remote = false, storagePrefix = '' }) {
  const LEGACY_KEY = `${storagePrefix}shantu.phonePreviewMaterial.transparency`;
  const DRAFT_KEY = `${storagePrefix}shantu.phonePreviewMaterial.draft.v2`;
  const BACKUP_KEY = `${storagePrefix}shantu.phonePreviewMaterial.before-grouping.v1`;
  const BASELINE_KEY = `${storagePrefix}shantu.phonePreviewMaterial.group-baseline.v1`;
  const panel=document.querySelector('#preview-material');
  panel.className='phone-preview-material';
  panel.innerHTML=`
    <header class="phone-preview-material-header"><div><strong>材质调色</strong><span class="phone-preview-material-note">${remote?'App参数预览':'网页调色 · 非安卓实际画面'}</span></div><button class="phone-preview-material-toggle" type="button" aria-expanded="true">收起</button></header>
    <div class="phone-preview-material-editor">
      ${remote?'':'<section class="phone-preview-context"><strong data-context-title>当前界面</strong><p class="phone-preview-material-guide">打开右侧菜单，这里列出它的内容；选一项查看对应位置。</p><div class="phone-preview-context-items" aria-label="当前界面包含的内容"></div><p class="phone-preview-context-scope" role="status">颜色、圆角为同类控件共用参数。</p></section>'}
      <details class="phone-preview-manual-groups"><summary>按全局类别选择</summary><label class="phone-preview-material-select-label">调整哪一类<select class="phone-preview-material-select"></select></label>
      <div class="phone-preview-material-parts" role="group" aria-label="调节部位" hidden></div>
      <p class="phone-preview-material-hint"></p></details>
      <div class="phone-preview-material-current" aria-live="polite"></div>
      ${remote?'':'<div class="phone-preview-material-targets"><button type="button" data-action="pick" aria-pressed="false">点界面选取</button><label><input type="checkbox" data-action="highlight" checked>标出范围</label></div>'}
      <p class="phone-preview-material-guide">${remote?'此预览通过上方分类调整参数。只修改当前属性，其余颜色和透明度保留。':'蓝色虚线只标出调整范围。只修改当前拖动的属性，其余深浅和透明度保留。'}</p>
      <div class="phone-preview-material-colors"><input class="phone-preview-material-color" type="color" aria-label="选择颜色"><input class="phone-preview-material-hex" type="text" inputmode="text" maxlength="9" aria-label="十六进制颜色" spellcheck="false"></div>
      <div class="phone-preview-material-sliders">
        <label>色相 <output data-value="h">0°</output><input type="range" data-channel="h" aria-label="色相" min="0" max="360" value="0"></label>
        <label>饱和度 <output data-value="s">0%</output><input type="range" data-channel="s" aria-label="饱和度" min="0" max="100" value="0"></label>
        <label>明度 <output data-value="l">0%</output><input type="range" data-channel="l" aria-label="明度" min="0" max="100" value="0"></label>
        <label>透明度 <output data-value="a">0%</output><input type="range" data-channel="a" aria-label="透明度" min="0" max="100" value="0"></label>
      </div>
      <details class="phone-preview-material-details" data-layout-details hidden open><summary>尺寸与留白 · 搜索窗口</summary><p class="phone-preview-material-guide">地点/路线搜索窗口共用。宽度受可用屏幕限制；高度随内容变化，超出后滚动。</p>
        ${MATERIAL_DIMENSIONS.map(item=>`<label>${item.label} <output data-value="${item.key}">${item.value}px</output><input type="range" data-channel="${item.key}" aria-label="搜索${item.label}" min="${item.min}" max="${item.max}" value="${item.value}"></label>`).join('')}
        <button type="button" data-action="restore-layout">还原搜索尺寸</button>
      </details>
      <details class="phone-preview-material-details"><summary>外框、内部圆角与阴影</summary><p class="phone-preview-material-guide">外框圆角独立调整；普通按钮、搜索输入和历史条目共用同一内部圆角。</p>
        <fieldset><legend>窗口与工具栏 · 外框</legend>
        <label>外框圆角 <output data-value="radiusCard">18px</output><input type="range" data-channel="radiusCard" aria-label="窗口与工具栏外框圆角" min="0" max="32" value="18"></label>
        <label>边缘宽度 <output data-value="edgeWidth">1px</output><input type="range" data-channel="edgeWidth" aria-label="边缘宽度" min="0" max="4" step="0.5" value="1"></label>
        <button type="button" data-action="edit-edge">调整边缘颜色</button></fieldset>
        <fieldset><legend>组件内部 · 按钮与输入</legend>
        <label>按钮/输入/历史圆角 <output data-value="radiusControl">10px</output><input type="range" data-channel="radiusControl" aria-label="按钮、输入与历史条目的内部圆角" min="0" max="24" value="10"></label>
        <label class="phone-preview-material-fixed">按钮、输入与历史条目 <output data-value="radiusInput">10px · 共用</output></label></fieldset>
        <fieldset><legend>表面效果 · 磨砂与阴影</legend>
        <label>磨砂模糊 <output data-value="blur">22px</output><input type="range" data-channel="blur" aria-label="磨砂模糊" min="0" max="40" value="22"></label>
        <label>阴影强度 <output data-value="shadow">14%</output><input type="range" data-channel="shadow" aria-label="阴影强度" min="0" max="100" value="14"></label>
        <label>阴影模糊 <output data-value="shadowBlur">24px</output><input type="range" data-channel="shadowBlur" aria-label="阴影模糊" min="0" max="48" value="24"></label>
        <label>阴影偏移 <output data-value="shadowOffset">8px</output><input type="range" data-channel="shadowOffset" aria-label="阴影偏移" min="0" max="24" value="8"></label>
        </fieldset>
      </details>
      <div class="phone-preview-material-actions"><button type="button" data-action="restore-item">还原本组</button><button type="button" data-action="restore-all">还原进入时的一版</button><button type="button" data-action="copy">复制参数</button></div>
      <output class="phone-preview-material-message" aria-live="polite"></output>
    </div>`;
  const select=panel.querySelector('select');
  const colorPicker=panel.querySelector('input[type="color"]');
  const hexInput=panel.querySelector('.phone-preview-material-hex');
  const currentLabel=panel.querySelector('.phone-preview-material-current');
  const toggle=panel.querySelector('.phone-preview-material-toggle');
  const message=panel.querySelector('.phone-preview-material-message');
  const sliderMap=Object.fromEntries([...panel.querySelectorAll('[data-channel]')].map((node)=>[node.dataset.channel,node]));
  const defaults={blur:22,shadow:14,shadowBlur:24,shadowOffset:8,radiusCard:18,radiusControl:10,edgeWidth:1,...Object.fromEntries(MATERIAL_DIMENSIONS.map(item=>[item.key,item.value]))};
  const detailChannels=['blur','shadow','shadowBlur','shadowOffset','radiusCard','radiusControl','edgeWidth',...MATERIAL_DIMENSIONS.map(item=>item.key)];
  let contextItems=[],selectedObject=null;
  const contextList=panel.querySelector('.phone-preview-context-items');
  const scopeNote=panel.querySelector('.phone-preview-context-scope');
  function showSelection(item,forceHighlight=true){
    if(!item)return;
    selectedObject=item.id;
    const group=MATERIAL_GROUPS.find(entry=>entry.parts.some(part=>part.id===item.partId));
    if(!group)return;
    select.value=group.id;partId=item.partId;renderParts();syncEditor();
    targets.selectObject(item.id);if(forceHighlight){highlightToggle.checked=true;targets.setVisible(true);}
    for(const button of contextList.querySelectorAll('button'))button.setAttribute('aria-pressed',String(button.dataset.objectId===String(item.id)));
    scopeNote.textContent=`已定位：${item.label}。下方颜色与圆角影响所有同类控件；蓝框只标出当前选中的对象。`;
  }
  let draft={},baselineDraft=null;
  try{
    const raw=sessionStorage.getItem(DRAFT_KEY);
    // Keep the exact previous payload before linking Favorites or editing groups.
    if(sessionStorage.getItem(BACKUP_KEY)===null)sessionStorage.setItem(BACKUP_KEY,JSON.stringify({raw,legacy:sessionStorage.getItem(LEGACY_KEY)}));
    draft=linkedPanelDraft(parseDraft(raw));
    const saved=sessionStorage.getItem(BASELINE_KEY);
    if(saved!==null)baselineDraft=linkedPanelDraft(parseDraft(saved));
  }catch{ /* In-memory editing still works if session storage is disabled. */ }
  let partId='window';
  const partButtons=panel.querySelector('.phone-preview-material-parts');
  const pickButton=panel.querySelector('[data-action="pick"]');
  const highlightToggle=panel.querySelector('[data-action="highlight"]');
  const cancelPickFromController=(event)=>{if(!remote&&event.key==='Escape'&&pickButton.getAttribute('aria-pressed')==='true'){event.preventDefault();targets.setPicking(false);pickButton.setAttribute('aria-pressed','false');pickButton.textContent='点界面选取';}};
  if(!remote)document.addEventListener('keydown',cancelPickFromController);
  const activeGroup=()=>MATERIAL_GROUPS.find(group=>group.id===select.value)||MATERIAL_GROUPS[0];
  const activePart=()=>activeGroup().parts.find(part=>part.id===partId)||activeGroup().parts[0];
  const targets=installMaterialTargets({frame,onContext:context=>{
    if(remote)return;
    contextItems=context.items;
    panel.querySelector('[data-context-title]').textContent=`当前界面 · ${context.title}`;
    panel.querySelector('[data-layout-details]').hidden=!context.search;
    const focusedId=contextList.contains(document.activeElement)?document.activeElement.dataset.objectId:null;
    contextList.replaceChildren();
    for(const item of contextItems){const button=document.createElement('button');button.type='button';button.dataset.objectId=String(item.id);button.textContent=item.label;button.setAttribute('aria-pressed',String(item.id===selectedObject));contextList.append(button);}
    if(focusedId)contextList.querySelector(`[data-object-id="${focusedId}"]`)?.focus({preventScroll:true});
    if(!contextItems.some(item=>item.id===selectedObject)){selectedObject=null;scopeNote.textContent='选左侧条目，右侧显示名称与蓝框。颜色、圆角仍为同类共用。';if(contextItems[0])showSelection(contextItems[0],false);}
  },onPick:(id,objectId)=>{
    pickButton.setAttribute('aria-pressed','false');pickButton.textContent='点界面选取';
    if(!id)return;
    const group=MATERIAL_GROUPS.find(entry=>entry.parts.some(part=>part.id===id));
    if(!group)return;
    select.value=group.id;partId=id;renderParts();syncEditor();
    if(objectId){const item=contextItems.find(entry=>entry.id===objectId);if(item)showSelection(item);}
    panel.setAttribute('aria-expanded','true');toggle.setAttribute('aria-expanded','true');toggle.textContent='收起';
    highlightToggle.checked=true;targets.setVisible(true);if(!objectId)targets.setTarget(id);
    panel.querySelector('.phone-preview-material-editor').scrollTop=0;panel.scrollTop=0;
    onLayoutChange();
  }});
  let injectedStyle=null,observer=null,boundDocument=null,recommendations={},legacyTransparency=null,editorRgb=[0,0,0],editorHsl=[0,0,0],detailRecommendations={...defaults};

  for(const group of MATERIAL_GROUPS){const option=document.createElement('option');option.value=group.id;option.textContent=group.label;select.append(option);}
  try { const legacy=sessionStorage.getItem(LEGACY_KEY);if(legacy!==null&&Number.isFinite(Number(legacy)))legacyTransparency=clamp(Number(legacy),0,100); } catch { /* Session storage can be unavailable. */ }

  function renderParts(){
    const group=activeGroup();partButtons.replaceChildren();partButtons.hidden=group.parts.length===1;
    for(const part of group.parts){const button=document.createElement('button');button.type='button';button.dataset.part=part.id;button.textContent=part.label;button.setAttribute('aria-pressed',String(part.id===activePart().id));partButtons.append(button);}
    panel.querySelector('.phone-preview-material-hint').textContent=group.hint;
  }
  function ensureBaseline(root){
    if(!root.style.getPropertyValue('--ui-glass-surface'))return;
    if(baselineDraft===null){baselineDraft=structuredClone(draft);try{sessionStorage.setItem(BASELINE_KEY,JSON.stringify(baselineDraft));}catch{}}
    persist();
  }
  function rootValue(root,token) { return root.style.getPropertyValue(token).trim(); }
  function effectiveRaw(material,root,computed) {
    const override=draft[material.id];
    if(override?.color)return rgbaValue(override.rgb||parseColor(override.color)?.slice(0,3)||[0,0,0],override.transparency??0);
    for(const token of material.tokens){const value=rootValue(root,token);if(value)return value;}
    if(material.base){const base=rootValue(root,material.base);if(base)return base;}
    const token=material.tokens[0];return computed.getPropertyValue(token).trim()|| (material.base?computed.getPropertyValue(material.base).trim():'');
  }
  function updateRecommendations(root,computed) {
    for(const material of MATERIALS){
      const raw=rootValue(root,material.tokens[0])|| (material.base?rootValue(root,material.base):'')||computed.getPropertyValue(material.tokens[0]).trim()|| (material.base?computed.getPropertyValue(material.base).trim():'');
      const parsed=parseColor(raw);
      if(parsed)recommendations[material.id]=parsed;
    }
    const filterValues=[rootValue(root,'--ui-glass-filter'),computed.getPropertyValue('--ui-glass-filter').trim()];
    const blur=filterValues.map((value)=>value.match(/blur\(\s*([\d.]+)px\s*\)/i)).find(Boolean);if(blur)detailRecommendations.blur=Number(blur[1]);
    const shadowValues=[rootValue(root,'--ui-glass-shadow'),computed.getPropertyValue('--ui-glass-shadow').trim()];
    const shadowAlpha=shadowValues.map((value)=>value.match(/rgba?\([^)]*[,/]\s*([\d.]+)\s*\)/i)).find(Boolean);if(shadowAlpha)detailRecommendations.shadow=Math.round(Number(shadowAlpha[1])*100);
    const shadowGeometry=shadowValues.map((value)=>value.match(/(?:^|\s)(-?[\d.]+)(?:px)?\s+(-?[\d.]+)px\s+(-?[\d.]+)px/i)).find(Boolean);
    if(shadowGeometry){detailRecommendations.shadowOffset=Number(shadowGeometry[2]);detailRecommendations.shadowBlur=Number(shadowGeometry[3]);}
    const readLength=(name,fallback)=>{for(const value of [rootValue(root,name),computed.getPropertyValue(name).trim()]){const match=value.match(/^(-?[\d.]+)px$/);if(match)return Number(match[1]);}return fallback;};
    detailRecommendations.radiusCard=readLength(MATERIAL_RADIUS_RULES.outerToken,detailRecommendations.radiusCard);
    detailRecommendations.radiusControl=readLength(MATERIAL_RADIUS_RULES.innerToken,detailRecommendations.radiusControl);
    detailRecommendations.radiusInput=detailRecommendations.radiusControl;
    detailRecommendations.edgeWidth=readLength('--ui-glass-edge-width',detailRecommendations.edgeWidth);
    for(const item of MATERIAL_DIMENSIONS)detailRecommendations[item.key]=readLength(item.token,item.value);
    if(legacyTransparency!==null&&recommendations.glass&&!draft.glass){draft.glass={color:`#${recommendations.glass.slice(0,3).map((v)=>Math.round(v).toString(16).padStart(2,'0')).join('')}`,rgb:recommendations.glass.slice(0,3),transparency:legacyTransparency};legacyTransparency=null;persist();try{sessionStorage.removeItem(LEGACY_KEY);}catch{}}
  }
  function materialValue(id,root,computed) {
    if(id==='favorites')return materialValue('panel',root,computed);
    const item=MATERIALS.find((entry)=>entry.id===id);
    const override=draft[id];
    if(override?.color){const rgb=override.rgb||parseColor(override.color)?.slice(0,3)||[0,0,0];return [...rgb,1-(override.transparency??0)/100];}
    if(item.base==='--ui-glass-surface'&&draft.glass?.color){const rgb=draft.glass.rgb||parseColor(draft.glass.color)?.slice(0,3);if(rgb)return [...rgb,1-(draft.glass.transparency??0)/100];}
    const raw=effectiveRaw(item,root,computed);
    return parseColor(raw)||recommendations[id]||recommendations[item.base?.replace('--ui-','')]||[0,0,0,1];
  }
  function syncEditor() {
    const root=boundDocument?.documentElement;if(!root)return;
    const computed=boundDocument.defaultView.getComputedStyle(root);
    const part=activePart(),id=part.members[0];
    const value=materialValue(id,root,computed);
    editorRgb=value.slice(0,3);editorHsl=draft[id]?.hsl ? [...draft[id].hsl] : rgbToHsl(editorRgb);
    const [h,s,l]=editorHsl.map(Math.round);const transparency=Math.round((1-value[3])*100);
    sliderMap.h.value=h;sliderMap.s.value=s;sliderMap.l.value=l;sliderMap.a.value=transparency;
    panel.querySelector('[data-value="h"]').textContent=`${h}°`;
    panel.querySelector('[data-value="s"]').textContent=`${s}%`;
    panel.querySelector('[data-value="l"]').textContent=`${l}%`;
    panel.querySelector('[data-value="a"]').textContent=`${transparency}%`;
    sliderMap.h.setAttribute('aria-valuetext',`${h}度`);sliderMap.s.setAttribute('aria-valuetext',`${s}%`);sliderMap.l.setAttribute('aria-valuetext',`${l}%`);sliderMap.a.setAttribute('aria-valuetext',`${transparency}%`);
    const hex='#'+editorRgb.map((part)=>Math.round(part).toString(16).padStart(2,'0')).join('');colorPicker.value=hex;hexInput.value=hex;
    currentLabel.textContent=`正在调整：${activeGroup().label}${activeGroup().parts.length>1?' · '+part.label:''}`;
    targets.setTarget(part.id);
    if(selectedObject&&contextItems.some(item=>item.id===selectedObject&&item.partId===part.id))targets.selectObject(selectedObject);
  }
  function persist() { try { sessionStorage.setItem(DRAFT_KEY,JSON.stringify(draft)); } catch { /* The active preview still works in memory. */ } }
  function composeStyle() {
    if(!boundDocument||!injectedStyle)return;
    const root=boundDocument.documentElement,computed=boundDocument.defaultView.getComputedStyle(root),rules=[];
    for(const item of MATERIALS){
      if(item.id==='favorites')continue;
      const override=draft[item.id];
      if(!override?.color)continue;
      const parsed=parseColor(override.color);if(!parsed)continue;
      const color=rgbaValue(override.rgb||parsed.slice(0,3),override.transparency??Math.round((1-parsed[3])*100));
      for(const token of item.tokens)rules.push(`${token}:${color}!important`);
    }
    const glass=draft.glass;
    if(glass?.color){const rgb=glass.rgb||parseColor(glass.color)?.slice(0,3);if(rgb){
      const transparency=glass.transparency??0;
      for(const item of MATERIALS.filter((entry)=>entry.base==='--ui-glass-surface'&&entry.id!=='glass'))if(!draft[item.id])for(const token of item.tokens)rules.push(`${token}:${rgbaValue(rgb,transparency)}!important`);
    }}
    rules.push('--ui-material-favorites:var(--ui-material-panel,var(--ui-glass-surface))!important');
    const selectedInk=selectedMaterialInk(...['selected','panel','ink','accentText'].map(id=>materialValue(id,root,computed)));
    rules.push(`--ui-selected-ink:${selectedInk}!important`,`--ui-active-ink:${selectedInk}!important`);
    if(draft.blur!==undefined)rules.push(`--ui-glass-filter:blur(${clamp(draft.blur,0,40)}px) saturate(125%)!important`);
    if(['shadow','shadowBlur','shadowOffset'].some((key)=>draft[key]!==undefined)){
      const strength=clamp(draft.shadow??detailRecommendations.shadow,0,100)/100;
      const offset=clamp(draft.shadowOffset??detailRecommendations.shadowOffset,0,24);
      const blur=clamp(draft.shadowBlur??detailRecommendations.shadowBlur,0,48);
      rules.push(`--ui-glass-shadow:0 ${offset}px ${blur}px rgba(0,0,0,${strength})!important`);
    }
    if(draft.radiusCard!==undefined)rules.push(`${MATERIAL_RADIUS_RULES.outerToken}:${clamp(draft.radiusCard,0,32)}px!important`);
    if(draft.radiusControl!==undefined)rules.push(`${MATERIAL_RADIUS_RULES.innerToken}:${clamp(draft.radiusControl,0,24)}px!important`);
    if(draft.edgeWidth!==undefined)rules.push(`--ui-glass-edge-width:${clamp(draft.edgeWidth,0,4)}px!important`);
    for(const item of MATERIAL_DIMENSIONS)if(draft[item.key]!==undefined)rules.push(`${item.token}:${clamp(draft[item.key],item.min,item.max)}px!important`);
    injectedStyle.textContent=`html[data-ui-theme]{${rules.join(';')}}`;
    boundDocument.defaultView.dispatchEvent(new boundDocument.defaultView.Event('shantu-material-change'));
    const tokens={};
    for(const rule of rules){const colon=rule.indexOf(':');if(colon<1)continue;const name=rule.slice(0,colon).trim();if(name.startsWith('--'))tokens[name]=rule.slice(colon+1).replace(/!important\s*$/,'').trim();}
    try{onTokensChange({tokens,draft:structuredClone(draft)});}catch{/* Parent listeners cannot interrupt the local preview. */}
  }
  function commitGroup(channel,value){
    if(!boundDocument)return;
    const root=boundDocument.documentElement,computed=boundDocument.defaultView.getComputedStyle(root);
    const members=activePart().members,values=Object.fromEntries(members.map(id=>[id,materialValue(id,root,computed)]));
    draft=editMaterialGroup(draft,members,values,channel,value);
    persist();composeStyle();syncEditor();
  }
  function updateDetailControls() {
    for(const channel of detailChannels){
      const value=draft[channel]??detailRecommendations[channel],unit=channel==='shadow'?'%':'px';
      sliderMap[channel].value=value;panel.querySelector(`[data-value="${channel}"]`).textContent=`${value}${unit}`;
      sliderMap[channel].setAttribute('aria-valuetext',channel==='shadow'?`${value}%`:`${value}像素`);
    }
    panel.querySelector('[data-value="radiusInput"]').textContent=`${sharedControlRadius(draft,detailRecommendations.radiusControl)}px · 共用`;
  }
  function bindFrameDocument() {
    observer?.disconnect();injectedStyle?.remove();const doc=frame.contentDocument;if(!doc?.documentElement)return;
    boundDocument=doc;injectedStyle=doc.createElement('style');injectedStyle.dataset.phonePreviewMaterial='temporary';doc.head?.append(injectedStyle);
    updateRecommendations(doc.documentElement,doc.defaultView.getComputedStyle(doc.documentElement));ensureBaseline(doc.documentElement);
    observer=new doc.defaultView.MutationObserver((records)=>{
      if(records.some((record)=>record.target===doc.documentElement&&(record.attributeName==='style'||record.attributeName==='data-ui-theme'))){
        injectedStyle.textContent='';
        updateRecommendations(doc.documentElement,doc.defaultView.getComputedStyle(doc.documentElement));ensureBaseline(doc.documentElement);composeStyle();syncEditor();updateDetailControls();
      }
    });
    observer.observe(doc.documentElement,{attributes:true,attributeFilter:['style','data-ui-theme']});composeStyle();syncEditor();updateDetailControls();
  }

  contextList?.addEventListener('click',event=>{const button=event.target.closest('button[data-object-id]');if(button)showSelection(contextItems.find(item=>String(item.id)===button.dataset.objectId));});
  select.addEventListener('change',()=>{selectedObject=null;for(const button of contextList?.querySelectorAll('button')||[])button.setAttribute('aria-pressed','false');if(scopeNote)scopeNote.textContent='当前使用手动分类，蓝框标出同类对象。';partId=activeGroup().parts[0].id;renderParts();syncEditor();});
  partButtons.addEventListener('click',(event)=>{const button=event.target.closest('button[data-part]');if(!button)return;selectedObject=null;for(const node of contextList?.querySelectorAll('button')||[])node.setAttribute('aria-pressed','false');if(scopeNote)scopeNote.textContent='当前使用手动分类，蓝框标出同类对象。';partId=button.dataset.part;renderParts();syncEditor();});
  if(!remote){
    highlightToggle.addEventListener('change',()=>targets.setVisible(highlightToggle.checked));
    pickButton.addEventListener('click',()=>{const picking=pickButton.getAttribute('aria-pressed')!=='true';pickButton.setAttribute('aria-pressed',String(picking));pickButton.textContent=picking?'点击界面选取 · Esc取消':'点界面选取';targets.setPicking(picking);});
  }
  for(const channel of ['h','s','l','a'])sliderMap[channel].addEventListener('input',()=>commitGroup(channel,Number(sliderMap[channel].value)));
  colorPicker.addEventListener('input',()=>commitGroup('color',parseColor(colorPicker.value).slice(0,3)));
  hexInput.addEventListener('change',()=>{
    const raw=hexInput.value.trim(),parsed=parseColor(raw);if(!parsed){hexInput.setAttribute('aria-invalid','true');return;}
    hexInput.removeAttribute('aria-invalid');const hasAlpha=[5,9].includes(raw.length);
    commitGroup('color',hasAlpha?parsed:parsed.slice(0,3));
  });
  for(const channel of detailChannels)sliderMap[channel].addEventListener('input',()=>{
    draft[channel]=Number(sliderMap[channel].value);const unit=channel==='shadow'?'%':'px';
    panel.querySelector(`[data-value="${channel}"]`).textContent=`${draft[channel]}${unit}`;
    sliderMap[channel].setAttribute('aria-valuetext',channel==='shadow'?`${draft[channel]}%`:`${draft[channel]}像素`);
    persist();composeStyle();
  });
  panel.querySelector('[data-action="restore-layout"]').addEventListener('click',()=>{
    for(const item of MATERIAL_DIMENSIONS){if(baselineDraft&&Object.hasOwn(baselineDraft,item.key))draft[item.key]=baselineDraft[item.key];else delete draft[item.key];}
    persist();composeStyle();updateDetailControls();message.textContent='已还原搜索尺寸，颜色与圆角保留';
  });
  panel.querySelector('[data-action="edit-edge"]').addEventListener('click',()=>{select.value='edges';partId='edge';renderParts();syncEditor();panel.querySelector('.phone-preview-material-editor').scrollTop=0;panel.scrollTop=0;});
  panel.querySelector('[data-action="restore-item"]').addEventListener('click',()=>{
    if(baselineDraft===null)return;
    for(const id of activePart().members){if(Object.hasOwn(baselineDraft,id))draft[id]=structuredClone(baselineDraft[id]);else delete draft[id];}
    draft=linkedPanelDraft(draft);persist();composeStyle();syncEditor();message.textContent='已还原本组，其他组保持不变';
  });
  panel.querySelector('[data-action="restore-all"]').addEventListener('click',()=>{
    if(baselineDraft===null)return;
    draft=structuredClone(baselineDraft);persist();composeStyle();syncEditor();updateDetailControls();message.textContent='已还原进入新版控制器时的参数；收藏仍与窗口同步';
  });
  panel.querySelector('[data-action="copy"]').addEventListener('click',async()=>{const theme=boundDocument?.documentElement;if(!theme){message.textContent='预览主题尚未载入';return;}const computed=boundDocument.defaultView.getComputedStyle(theme);const resolved=Object.fromEntries(MATERIALS.map((item)=>{const value=materialValue(item.id,theme,computed);return[item.id,{color:'#'+value.slice(0,3).map((part)=>Math.round(part).toString(16).padStart(2,'0')).join(''),rgb:value.slice(0,3),transparency:Math.round((1-value[3])*100),source:draft[item.id]?.color?'override':(item.base==='--ui-glass-surface'&&draft.glass?.color?'follow-glass':'theme')}];}));const detailValues=Object.fromEntries([...Object.keys(defaults)].map((key)=>[key,draft[key]??detailRecommendations[key]]));detailValues.radiusInput=sharedControlRadius(draft,detailRecommendations.radiusControl);const payload={schema:'shantu.preview-material.grouped.v3',bindings:{favorites:'panel'},theme:{name:theme.dataset.uiTheme||null,mode:theme.dataset.uiTheme||null,baseColors:Object.fromEntries(Object.entries(recommendations).map(([key,value])=>[key,'#'+value.slice(0,3).map((part)=>Math.round(part).toString(16).padStart(2,'0')).join('')]))},details:detailValues,materials:resolved,draft};const text=JSON.stringify(payload,null,2);try{await navigator.clipboard.writeText(text);message.textContent='已复制临时调色参数';}catch{message.textContent=text;}});
  toggle.addEventListener('click',()=>{const expanded=panel.getAttribute('aria-expanded')!=='true';panel.setAttribute('aria-expanded',String(expanded));toggle.setAttribute('aria-expanded',String(expanded));toggle.textContent=expanded?'收起':'展开';targets.setVisible(!remote&&expanded&&highlightToggle.checked);if(!expanded&&!remote){targets.setPicking(false);pickButton.setAttribute('aria-pressed','false');pickButton.textContent='点界面选取';}onLayoutChange();});
  const narrow=matchMedia('(max-width: 700px)').matches;panel.setAttribute('aria-expanded',String(!narrow));toggle.setAttribute('aria-expanded',String(!narrow));toggle.textContent=narrow?'展开':'收起';renderParts();targets.setTarget(activePart().id);targets.setVisible(!remote&&!narrow);
  frame.addEventListener('load',bindFrameDocument);if(frame.contentDocument?.readyState==='complete')bindFrameDocument();
  const resizeObserver=new ResizeObserver(()=>onLayoutChange());resizeObserver.observe(panel);onLayoutChange();
  return {getHeight:()=>panel.getBoundingClientRect().height,getTransparency:()=>draft.glass?.transparency??(recommendations.glass?Math.round((1-recommendations.glass[3])*100):0),getDraft:()=>structuredClone(draft),destroy(){if(!remote)document.removeEventListener('keydown',cancelPickFromController);targets.destroy();observer?.disconnect();resizeObserver.disconnect();frame.removeEventListener('load',bindFrameDocument);injectedStyle?.remove();}};
}
