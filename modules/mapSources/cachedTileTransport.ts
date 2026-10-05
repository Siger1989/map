type Store = { get(key: string): Promise<ArrayBuffer | undefined>; put(key: string, bytes: ArrayBuffer, ttlMs?: number): void; forget(key: string): void };
const MAX_BYTES = 8 * 1024 * 1024;

function imageMime(bytes: ArrayBuffer): string | undefined {
  const b = new Uint8Array(bytes);
  if (b.length >= 8 && [137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v)) return 'image/png';
  if (b.length >= 3 && b[0]===255 && b[1]===216 && b[2]===255) return 'image/jpeg';
  const ascii=(start:number,end:number)=>String.fromCharCode(...b.subarray(start,end));
  if(b.length>=12 && ascii(0,4)==='RIFF' && ascii(8,12)==='WEBP')return 'image/webp';
  if(b.length>=6 && ['GIF87a','GIF89a'].includes(ascii(0,6)))return 'image/gif';
  if(b.length>=16 && ascii(4,8)==='ftyp' && ['avif','avis'].includes(ascii(8,12)))return 'image/avif';
}

/** Cache only complete image bodies; never persist private provider URLs. */
export function createCachedTileFetcher(store: Store, fetcher: (url: string, signal: AbortSignal) => Promise<Response>) {
  const stats={hits:0,misses:0,networkRequests:0,stored:0};
  const remember=async(response:Response,key:string,signal:AbortSignal)=>{
    if(response.status!==200 || /no-store|no-cache|max-age\s*=\s*"?0(?:\D|$)/i.test(response.headers.get('cache-control')??''))return;
    if(Number(response.headers.get('content-length')??0)>MAX_BYTES)return;
    const clone=response.clone(),reader=clone.body?.getReader();
    if(!reader)return;
    const chunks:Uint8Array[]=[];let size=0;
    try{
      while(true){
        if(signal.aborted){void reader.cancel().catch(()=>{});return;}
        const {done,value}=await reader.read();if(done)break;
        size+=value.byteLength;
        if(size>MAX_BYTES){void reader.cancel().catch(()=>{});return;}
        chunks.push(value);
      }
      if(!size || signal.aborted)return;
      const bytes=new Uint8Array(size);let offset=0;
      for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
      const maxAge=/\bmax-age\s*=\s*"?(\d+)/i.exec(response.headers.get('cache-control')??'');
      const age=Number(response.headers.get('age')??0);
      const remainingTtl=maxAge?Math.max(0,Number(maxAge[1])-(Number.isFinite(age)?Math.max(0,age):0))*1000:undefined;
      if(remainingTtl===0)return;
      if(imageMime(bytes.buffer)){
        if(typeof createImageBitmap==='function'){
          const image=await createImageBitmap(new Blob([bytes]));image.close();
          if(signal.aborted)return;
        }
        store.put(key,bytes.buffer,remainingTtl);stats.stored++;
      }
    }catch{/* Failed/aborted bodies never enter the browser cache. */}
    finally{reader.releaseLock();}
  };
  return {
    snapshot:()=>({...stats}),
    async fetch(url:string,signal:AbortSignal):Promise<Response>{
      signal.throwIfAborted();
      let key:string|undefined;
      try{
        if(globalThis.crypto?.subtle){
          const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(url));
          key='raster-v1:'+Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,'0')).join('');
          const bytes=await store.get(key);
          signal.throwIfAborted();
          if(bytes){
            const mime=imageMime(bytes);
            if(mime){stats.hits++;return new Response(bytes,{headers:{'Content-Type':mime,'X-Shantu-Browse-Cache':'hit'}});}
            store.forget(key);
          }
        }
      }catch{signal.throwIfAborted();}
      signal.throwIfAborted();stats.misses++;stats.networkRequests++;
      const response=await fetcher(url,signal);
      if(key)void remember(response,key,signal).catch(()=>{});
      return response;
    },
  };
}
