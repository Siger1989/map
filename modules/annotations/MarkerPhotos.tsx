import type { VisiblePhoto } from '../photos/storage';
export function MarkerPhotos({photos,onOpen}:{photos:VisiblePhoto[];onOpen:(id:string)=>void}) {
  if(!photos.length)return <p className="marker-photos-empty">尚未拍照，可从一级菜单拍摄。</p>;
  return <div className="marker-photos" aria-label="这个标记点的照片">{photos.map(photo=><button key={photo.id} onClick={()=>onOpen(photo.id)} aria-label={`查看标记照片 ${new Date(photo.time).toLocaleString('zh-CN')}`}><img src={photo.url} alt={photo.title||photo.name} /><small>{new Date(photo.time).toLocaleDateString('zh-CN')}</small></button>)}</div>;
}
