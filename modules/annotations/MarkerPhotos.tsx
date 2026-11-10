import type { VisiblePhoto } from '../photos/storage';
import { photoTimeLabel } from '../photos/association';
export function MarkerPhotos({photos,pendingPhoto,onOpen}:{photos:VisiblePhoto[];pendingPhoto?:{url:string;name:string;status:string};onOpen:(id:string)=>void}) {
  if(!photos.length && !pendingPhoto)return <p className="marker-photos-empty">尚未拍照，可从一级菜单拍摄。</p>;
  return <div className="marker-photos" aria-label="这个标记点的照片">{pendingPhoto && <div className="marker-photo-pending" role="status"><img src={pendingPhoto.url} alt={pendingPhoto.name}/><small>{pendingPhoto.status}</small></div>}{photos.map(photo=><button key={photo.id} onClick={()=>onOpen(photo.id)} aria-label={`查看标记照片 ${photoTimeLabel(photo)}`}><img src={photo.url} alt={photo.title||photo.name} /><small>{photoTimeLabel(photo, true)}</small></button>)}</div>;
}
