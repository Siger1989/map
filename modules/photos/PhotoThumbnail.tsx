import { useEffect, useRef, useState, type ImgHTMLAttributes } from 'react';
import { readPhotoPreview } from './storage';
/** Observe the actual scroll viewport; metadata lists do not read image blobs. */
export function PhotoThumbnail({
  id,
  src,
  ...props
}: ImgHTMLAttributes<HTMLImageElement> & { id: string }) {
  const image = useRef<HTMLImageElement>(null),
    [url, setUrl] = useState('');
  useEffect(() => {
    if (src) return;
    let active = true,
      owned = '',
      loading = false;
    const load = () => {
      if (loading) return;
      loading = true;
      void readPhotoPreview(id)
        .then((blob) => {
          if (active) {
            owned = URL.createObjectURL(blob);
            setUrl(owned);
          }
        })
        .catch(() => {});
    };
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        observer.disconnect();
        load();
      }
    });
    if (image.current) observer.observe(image.current);
    return () => {
      active = false;
      observer.disconnect();
      if (owned) URL.revokeObjectURL(owned);
    };
  }, [id, src]);
  return (
    <img {...props} ref={image} loading="lazy" src={src || url || undefined} />
  );
}
