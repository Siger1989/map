import { useEffect, useRef, useState } from 'react';
import { Camera, Share2, Upload, X } from 'lucide-react';
import { SmartInput, SmartTextarea } from '../input/SmartText';
import type { VisiblePhoto } from '../photos/storage';
import { MAX_ATTRIBUTES } from './attributes';
import { AnnotationIcon, MarkerCoordinates } from './AnnotationFields';
import { MARKER_ICONS, markerIcon, type MarkerIconId } from './icons';
import type { Annotation } from './data';
import type { AnnotationsState } from './useAnnotations';
import './pinEditor.css';

const COLORS = ['#f2b45f', '#ef5652', '#5fdf79', '#598fff', '#a379de', '#ffffff'];

export function PinEditor({ state, item, photos, onClose, onShare, onAdjust, onCapture, onImport, onPhoto, cameraStatus, cameraBusy, cameraRetry, onCameraRetry }: {
  state: AnnotationsState;
  item: Annotation;
  photos: VisiblePhoto[];
  onClose: () => void;
  onShare: (item: Annotation) => void;
  onAdjust: () => void;
  onCapture: (item: Annotation) => void;
  onImport: (item: Annotation) => void;
  onPhoto: (id: string) => void;
  cameraStatus?: string;
  cameraBusy?: boolean;
  cameraRetry?: boolean;
  onCameraRetry?: () => void;
}) {
  const [confirm, setConfirm] = useState<'leave' | 'delete' | null>(null);
  const [picker, setPicker] = useState<'coordinates' | 'icon' | 'color' | null>(null);
  const editor = useRef<HTMLElement>(null);
  useEffect(() => { state.beginEdit(item.id); }, [item.id]);
  useEffect(() => {
    let frame = 0;
    const keepFocusedAttributeVisible = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const list = editor.current?.querySelector<HTMLElement>('.pin-attribute-list');
        const input = document.activeElement;
        if (!list || !(input instanceof HTMLElement) || !list.contains(input)) return;
        const row = input.closest<HTMLElement>('.pin-attribute');
        if (!row) return;
        const viewport = list.getBoundingClientRect();
        const active = row.getBoundingClientRect();
        if (active.bottom > viewport.bottom) list.scrollTop += active.bottom - viewport.bottom;
        else if (active.top < viewport.top) list.scrollTop -= viewport.top - active.top;
      });
    };
    const node = editor.current;
    node?.addEventListener('focusin', keepFocusedAttributeVisible);
    window.addEventListener('resize', keepFocusedAttributeVisible);
    window.visualViewport?.addEventListener('resize', keepFocusedAttributeVisible);
    return () => {
      cancelAnimationFrame(frame);
      node?.removeEventListener('focusin', keepFocusedAttributeVisible);
      window.removeEventListener('resize', keepFocusedAttributeVisible);
      window.visualViewport?.removeEventListener('resize', keepFocusedAttributeVisible);
    };
  }, []);
  const change = (patch: Partial<Annotation>) => {
    const ok = state.update(item.id, patch);
    if (ok && patch.coordinates) void state.refreshElevation(item.id, patch.coordinates);
    return ok;
  };
  const commit = () => {
    if (!state.saveEdit()) return false;
    state.rememberAttributes(item.id);
    // Continue with a fresh base so later direct saves retain conflict protection.
    state.beginEdit(item.id);
    return true;
  };
  const changeAndSave = (patch: Partial<Annotation>, composing = false) => {
    if (!change(patch)) return false;
    // Do not commit an incomplete IME composition: it can replace the focused node.
    return composing ? true : commit();
  };
  const isComposing = (event: { nativeEvent: Event }) =>
    (event.nativeEvent as InputEvent).isComposing === true;
  const save = () => {
    return commit();
  };
  const leave = () => {
    if (state.selectionRequest) { state.resolveSelection(false); setConfirm(null); return; }
    if (state.dirty) setConfirm('leave');
    else { state.cancelEdit(); onClose(); }
  };
  const finishLeave = (keep: boolean) => {
    if (keep ? !save() : false) return;
    if (!keep) state.cancelEdit();
    setConfirm(null);
    if (state.selectionRequest) state.resolveSelection(true);
    else onClose();
  };
  const saveForPhoto = (action: (saved: Annotation) => void) => {
    if (!save()) return;
    action(item);
    state.beginEdit(item.id);
  };
  const attributes = item.attributes ?? [];
  return <section ref={editor} className="pin-editor" aria-label="编辑标记" onKeyDown={event => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); leave(); }
  }}>
    <header className="pin-editor-header">
      <button aria-label="返回地图" onClick={leave}>← 返回</button>
      <strong>编辑标记</strong>
      <button disabled={!!(item.trackAnchor || item.sectionAnchor)} title={item.trackAnchor || item.sectionAnchor ? '已绑定路线或剖面，请到对应编辑中移动' : '切换到地图，调整标记位置'} onClick={onAdjust}>调整</button>
      <button className="pin-danger" onClick={() => setConfirm('delete')}>删除</button>
      <button className="pin-save" onClick={() => { if (save()) onShare(item); }}><Share2 size={15}/>分享</button>
    </header>
    {picker ? <div className="pin-picker">
      <button className="pin-picker-back" onClick={() => setPicker(null)}>← 返回编辑</button>
      {picker === 'coordinates' ? <MarkerCoordinates item={item} base={state.edit?.base ?? item} change={changeAndSave} reading={state.reading} refresh={() => void state.refreshElevation(item.id, item.coordinates)} /> : null}
      {picker === 'icon' ? <div className="pin-icon-grid" aria-label="选择标记图案">{(Object.keys(MARKER_ICONS) as MarkerIconId[]).map(icon => <button key={icon} aria-label={`图案 ${MARKER_ICONS[icon].name}`} aria-pressed={(item.icon ?? 'pin') === icon} onClick={() => { if (changeAndSave({ icon })) setPicker(null); }}><AnnotationIcon item={{ icon }} size={21}/><small>{MARKER_ICONS[icon].name}</small></button>)}</div> : null}
      {picker === 'color' ? <div className="pin-color-grid" aria-label="选择标记颜色">{COLORS.map(color => <button key={color} aria-label={`选择颜色 ${color}`} aria-pressed={item.color.toLowerCase() === color} onClick={() => { if (changeAndSave({ color })) setPicker(null); }}><i style={{ background: color }}/></button>)}<label>自定义颜色<input type="color" aria-label="自定义标记颜色" value={item.color} onChange={event => changeAndSave({ color: event.target.value })}/></label></div> : null}
    </div> : <>
    <div className="pin-editor-main">
      <label className="pin-field"><span>名称</span><SmartInput aria-label="标记名称" maxLength={60} value={item.name} onChange={event => changeAndSave({ name: event.target.value }, isComposing(event))} onCompositionEnd={() => save()} onBlur={() => save()} /></label>
      <label className="pin-field"><span>备注</span><SmartTextarea aria-label="标记备注" rows={1} maxLength={500} value={item.note} placeholder="可填写位置说明" onChange={event => changeAndSave({ note: event.target.value }, isComposing(event))} onCompositionEnd={() => save()} onBlur={() => save()} /></label>
      <div className="pin-coordinate-row">
        <button className="pin-coordinate-value" aria-label="编辑标记坐标" onClick={() => setPicker('coordinates')}><span>坐标</span><b>{item.coordinates[0].toFixed(6)}, {item.coordinates[1].toFixed(6)} · WGS84</b></button>
        <button aria-label="分享完整标记信息" title="分享完整信息" onClick={() => { if (save()) onShare(item); }}><Share2 size={17}/></button>
      </div>
      <div className="pin-style-row">
        <button aria-label="选择标记图案" onClick={() => setPicker('icon')}><span>图案</span><AnnotationIcon item={item} size={18}/><b>{markerIcon(item.icon).name}</b><span>⌄</span></button>
        <button aria-label="选择标记颜色" onClick={() => setPicker('color')}><span>颜色</span><i style={{ background: item.color }}/><b>{COLORS.includes(item.color.toLowerCase()) ? '预设' : '自定'}</b><span>⌄</span></button>
      </div>
      <div className="pin-photo-row">
        <button disabled={cameraBusy} onClick={() => saveForPhoto(onCapture)}><Camera size={15}/>拍照</button>
        <button disabled={cameraBusy} onClick={() => saveForPhoto(onImport)}><Upload size={15}/>导入照片</button>
        {photos.map(photo => <button key={photo.id} className="pin-photo-thumb" aria-label={`查看照片 ${photo.name}`} onClick={() => saveForPhoto(() => onPhoto(photo.id))}><img src={photo.url} alt={photo.title || photo.name}/></button>)}
      </div>
    </div>
    <div className="pin-attribute-head"><strong>自定义条目</strong><button disabled={attributes.length >= MAX_ATTRIBUTES} onClick={() => changeAndSave({ attributes: [...attributes, { name: '', value: '' }] })}>＋ 添加条目</button></div>
    <div className="pin-attribute-list" aria-label="自定义条目列表">
      {attributes.map((field, index) => <div className="pin-attribute" key={index}>
        <input aria-label={`条目 ${index + 1} 名称`} placeholder="名称" maxLength={60} value={field.name} onChange={event => changeAndSave({ attributes: attributes.map((value, n) => n === index ? { ...value, name: event.target.value } : value) }, isComposing(event))} onCompositionEnd={() => save()} onBlur={() => save()}/>
        <textarea aria-label={`条目 ${index + 1} 内容`} placeholder="内容" rows={1} maxLength={2000} value={field.value} onChange={event => changeAndSave({ attributes: attributes.map((value, n) => n === index ? { ...value, value: event.target.value } : value) }, isComposing(event))} onCompositionEnd={() => save()} onBlur={() => save()}/>
        <button aria-label={`删除条目 ${index + 1}`} onClick={() => changeAndSave({ attributes: attributes.filter((_, n) => n !== index) })}><X size={14}/></button>
      </div>)}
    </div>
    </>}
    {state.error && <p role="alert" className="pin-status">{state.error}</p>}
    {cameraStatus && <p role="status" className="pin-status">{cameraStatus}{cameraRetry && <button onClick={onCameraRetry}>重试保存</button>}</p>}
    {(confirm || state.selectionRequest) && <div className="pin-confirm" role="alertdialog" aria-modal="true" aria-label={confirm === 'delete' ? '确认删除标记' : '保存标记修改'}>
      <strong>{confirm === 'delete' ? `删除“${item.name || '未命名'}”？` : '保存这次修改？'}</strong>
      <p>{confirm === 'delete' ? '仅删除这个标记；照片原文件保留。' : '保存后生效，放弃将恢复编辑前的内容。'}</p>
      <div>{confirm === 'delete' ? <><button className="pin-danger" onClick={() => { if (state.remove(item.id)) onClose(); }}>确认删除</button><button onClick={() => setConfirm(null)}>取消</button></> : <><button className="pin-save" onClick={() => finishLeave(true)}>保存</button><button onClick={() => finishLeave(false)}>放弃</button><button onClick={() => { setConfirm(null); state.resolveSelection(false); }}>继续编辑</button></>}</div>
    </div>}
  </section>;
}
