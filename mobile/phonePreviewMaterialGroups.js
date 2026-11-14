// These are editing groups, not a migration to a new colour palette.
export const MATERIAL_GROUPS = [
  {id:'window',label:'窗口与提示条',hint:'地图上的普通窗口和提示条；收藏图源快捷弹窗按窗口底板处理，收藏与普通窗口共用参数。',parts:[{id:'window',label:'外框底板',members:['panel','toast']}]},
  {id:'chrome',label:'地图工具栏',hint:'地图顶部栏、底部导航和右侧工具/锁定栏的底板。',parts:[{id:'chrome',label:'工具栏底板',members:['topbar','bottom','rail']}]},
  {id:'controls',label:'次级操作与输入',hint:'按实际对象分别调整次要按钮、输入/选项底板、轻按钮及返回/关闭底色；图源快捷弹窗图源行和管理按钮使用次要按钮。',parts:[{id:'button',label:'次要按钮',members:['button']},{id:'field',label:'输入/选项底板',members:['field']},{id:'subtle',label:'轻按钮/返回关闭',members:['subtle']}]},
  {id:'accent',label:'主按钮与选中状态',hint:'底栏记录/路线等的浅色选中块，选「选中底色」；橙色操作按钮选「主按钮底色」。',parts:[{id:'accent',label:'主按钮底色',members:['accent','switchOn']},{id:'selected',label:'选中底色（底栏/选项）',members:['selected']},{id:'accentText',label:'主按钮文字',members:['accentText']}]},
  {id:'text',label:'文字与图标',hint:'普通文字、辅助说明、图标、关闭符号及地图上的3D/2D入口；主按钮文字在「主按钮与选中状态」。',parts:[{id:'text',label:'文字',members:['ink','muted','close']}]},
  {id:'switch',label:'开关细节',hint:'关闭状态的底色与圆形滑块分开，避免调成同色后分不清开关状态。',parts:[{id:'switchOff',label:'关闭底色',members:['switchOff']},{id:'knob',label:'圆形滑块',members:['knob']}]},
  {id:'edges',label:'外框与内部线条',hint:'窗口外框描边和内容内部细分隔线分别调整；提示条不加装饰亮边。',parts:[{id:'edge',label:'窗口外框描边',members:['edge']},{id:'line',label:'内部细分隔线',members:['line']}]},
];

export const MATERIAL_RADIUS_RULES = Object.freeze({ outerToken:'--ui-radius-card', innerToken:'--ui-radius-control', inputToken:'--ui-radius-control' });

export const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));
// Older drafts may contain radiusInput, but inputs now follow the shared control radius.
export function sharedControlRadius(draft,fallback=10){
  const value=Number(draft?.radiusControl);
  return Number.isFinite(value)?clamp(value,0,24):fallback;
}
export function parseColor(value){
  const text=String(value||'').trim(),hex=text.match(/^#([\da-f]{3,8})$/i)?.[1];
  if(hex){
    if(![3,4,6,8].includes(hex.length))return null;
    const full=hex.length<=4?[...hex].map(c=>c+c).join(''):hex;
    return [...[0,2,4].map(i=>parseInt(full.slice(i,i+2),16)),full.length===8?parseInt(full.slice(6),16)/255:1];
  }
  const rgb=text.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i);
  return rgb?[...rgb.slice(1,4).map(v=>clamp(v,0,255)),rgb[4]===undefined?1:clamp(rgb[4],0,1)]:null;
}
export function rgbToHsl([red,green,blue]){
  const r=red/255,g=green/255,b=blue/255,max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min,l=(max+min)/2;
  let h=0,s=0;
  if(d){s=d/(1-Math.abs(2*l-1));h=max===r?60*(((g-b)/d)%6):max===g?60*((b-r)/d+2):60*((r-g)/d+4);}
  return [(h+360)%360,s*100,l*100];
}
export function hslToRgb(h,s,l){
  h=((h%360)+360)%360/360;s=clamp(s,0,100)/100;l=clamp(l,0,100)/100;
  const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs((h*6)%2-1)),m=l-c/2;
  const rgb=h<1/6?[c,x,0]:h<2/6?[x,c,0]:h<3/6?[0,c,x]:h<4/6?[0,x,c]:h<5/6?[x,0,c]:[c,0,x];
  return rgb.map(v=>(v+m)*255);
}
export const hexFromRgb=rgb=>'#'+rgb.map(v=>Math.round(clamp(v,0,255)).toString(16).padStart(2,'0')).join('');
export const rgbaValue=(rgb,transparency)=>`rgba(${rgb.map(v=>Number(Number(v).toFixed(3))).join(',')},${(100-clamp(transparency,0,100))/100})`;

// The user explicitly linked Favorites to the ordinary panel. The caller keeps
// the original v2 JSON in a separate backup before applying this normalization.
export function linkedPanelDraft(original){
  const next=structuredClone(original);
  delete next.favorites;
  return next;
}

export function editMaterialGroup(original,members,values,channel,value){
  const next=structuredClone(original);
  for(const id of members){
    const current=values[id];
    let rgb=current.slice(0,3),alpha=current[3];
    if(channel==='a')alpha=1-clamp(value,0,100)/100;
    else if(channel==='color'){rgb=value.slice(0,3);if(value.length===4)alpha=value[3];}
    else{
      const hsl=original[id]?.hsl ? [...original[id].hsl] : rgbToHsl(rgb);
      hsl[['h','s','l'].indexOf(channel)]=value;
      rgb=hslToRgb(...hsl);
      next[id]={color:hexFromRgb(rgb),rgb,transparency:Number(((1-alpha)*100).toFixed(4)),hsl};
      continue;
    }
    next[id]={color:hexFromRgb(rgb),rgb,transparency:Number(((1-alpha)*100).toFixed(4)),hsl:channel==='a'&&original[id]?.hsl?[...original[id].hsl]:rgbToHsl(rgb)};
  }
  return linkedPanelDraft(next);
}
