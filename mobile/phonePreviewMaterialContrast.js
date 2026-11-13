const over=(front,back)=>front.slice(0,3).map((v,i)=>v*front[3]+back[i]*(1-front[3]));
const luminance=rgb=>rgb.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};

// Reuse the user's foreground when readable. Otherwise prefer their primary
// button text, then a light/dark fallback, without changing either saved colour.
export function selectedMaterialInk(selected,surface,foreground,primaryText){
  const backgrounds=[[0,0,0],[255,255,255]].map(map=>over(selected,over(surface,map)));
  const choices=[foreground,primaryText,[16,36,60,1],[255,255,255,1]];
  const score=color=>Math.min(...backgrounds.map(bg=>contrast(over(color,bg),bg)));
  const readable=choices.find(color=>score(color)>=4.5);
  const chosen=readable||choices.reduce((best,color)=>score(color)>score(best)?color:best);
  return `rgba(${chosen.join(',')})`;
}
