import type { Recording } from './recording';
/** Wait for the native final snapshot before saving, and clear only after persistence succeeds. */
export async function finishRecording(options: {
  keep: boolean; read: () => Recording; send: (action: 'finish' | 'clear') => void;
  save: (record: Recording) => string | Promise<string>; wait?: () => Promise<void>; timeout?: number;
}) {
  const original=options.read();
  if(original.phase==='idle')throw Error('当前没有正在进行的记录');
  options.send('finish');
  const wait=options.wait ?? (()=>new Promise<void>(resolve=>setTimeout(resolve,100)));
  const until=Date.now()+(options.timeout ?? 12000);
  let final=options.read();
  while(final.id===original.id && final.phase!=='finished') {
    if(Date.now()>until)throw Error('结束尚未确认，记录已保留，请重试');
    await wait();final=options.read();
  }
  if(final.id!==original.id)throw Error('记录已变化，请检查当前记录');
  let saved:string|null=null;
  if(options.keep) {
    if(!final.segments.some(s=>s.length))throw Error('尚无有效轨迹点，无法保存；可取消并结束');
    saved=await options.save(final);
  }
  options.send('clear');
  const clearUntil=Date.now()+(options.timeout ?? 12000);
  while(options.read().phase!=='idle') {
    if(Date.now()>clearUntil)throw Error(saved?'轨迹已保存，收尾未确认，请重试':'结束收尾未确认，请重试');
    await wait();
  }
  return saved;
}
