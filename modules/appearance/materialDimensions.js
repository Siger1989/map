// The same bounded layout tokens are consumed by App CSS and preview controls.
export const MATERIAL_DIMENSIONS = Object.freeze([
  {key:'searchWidth',token:'--ui-search-width',label:'窗口宽度上限',value:300,min:240,max:360},
  {key:'searchPadding',token:'--ui-search-padding',label:'窗口内边距',value:10,min:4,max:20},
  {key:'searchGap',token:'--ui-search-gap',label:'条目间距',value:3,min:0,max:12},
  {key:'searchRowHeight',token:'--ui-search-row-height',label:'条目最小高度',value:32,min:28,max:64},
]);
