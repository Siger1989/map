import type { Map, MapMouseEvent, MapTouchEvent } from 'maplibre-gl';
import type { ScreenPoint } from './drawing';
export type DrawingInput =
  | { type: 'start' | 'move'; point: ScreenPoint }
  | { type: 'end'; reason: 'release' | 'navigation' | 'interrupt' }
  | { type: 'cancel' };

/** Keep drawing work to one latest touch or mouse sample per rendered frame. */
export class FrameCoalescedDrawingInput {
  private pending: DrawingInput | null = null;
  private frame: number | null = null;
  private emit: (input: DrawingInput) => void;
  private requestFrame: (callback: FrameRequestCallback) => number;
  private cancelFrame: (frame: number) => void;
  constructor(
    emit: (input: DrawingInput) => void,
    requestFrame: (callback: FrameRequestCallback) => number,
    cancelFrame: (frame: number) => void,
  ) {
    this.emit = emit;
    this.requestFrame = requestFrame;
    this.cancelFrame = cancelFrame;
  }
  input(input: DrawingInput) {
    if (input.type === 'start') this.discard();
    if (input.type === 'move') {
      this.pending = input;
      if (this.frame === null) {
        this.frame = this.requestFrame(() => {
          this.frame = null;
          this.flush();
        });
      }
      return;
    }
    if (input.type === 'cancel' || (input.type === 'end' && input.reason !== 'release')) {
      this.discard();
    } else if (input.type === 'end') {
      this.flush();
    }
    this.emit(input);
  }
  discard() {
    if (this.frame !== null) this.cancelFrame(this.frame);
    this.frame = null;
    this.pending = null;
  }
  private flush() {
    const pending = this.pending;
    this.pending = null;
    if (this.frame !== null) this.cancelFrame(this.frame);
    this.frame = null;
    if (pending) this.emit(pending);
  }
}
type Contact = { id: number; point: ScreenPoint };
/** A second finger preempts ink immediately, until every finger is lifted. */
export class DrawingTouchSession {
  private phase: 'idle' | 'drawing' | 'navigation' | 'waiting' = 'idle';
  private pointer: number | null = null;
  private emit: (input: DrawingInput) => void;
  constructor(emit: (input: DrawingInput) => void) { this.emit = emit; }
  update(type: 'start' | 'move' | 'end' | 'cancel', contacts: Contact[]) {
    if (type === 'cancel') { this.reset(true); return false; }
    if (contacts.length >= 2) {
      if (this.phase === 'drawing') this.emit({ type: 'cancel' });
      this.phase = 'navigation'; this.pointer = null; return true;
    }
    if (!contacts.length) { this.reset(); return false; }
    if (this.phase === 'navigation') this.phase = 'waiting';
    if (this.phase === 'waiting') return false;
    const contact = contacts[0];
    if (type === 'start' && this.phase === 'idle') {
      this.phase = 'drawing'; this.pointer = contact.id;
      this.emit({ type: 'start', point: contact.point });
    } else if (type === 'move' && this.phase === 'drawing' && this.pointer === contact.id) {
      this.emit({ type: 'move', point: contact.point });
    }
    return false;
  }
  interrupt() {
    if (this.phase === 'drawing') {
      this.emit({ type: 'end', reason: 'interrupt' }); this.phase = 'waiting';
    }
  }
  reset(cancel = false, reason: 'release' | 'interrupt' = 'release') {
    if (this.phase === 'drawing') this.emit(cancel ? { type: 'cancel' } : { type: 'end', reason });
    this.phase = 'idle'; this.pointer = null;
  }
}

/** Public MapLibre events arbitrate ink versus its real native two-finger handlers. */
export class DrawingGestureBridge {
  private map: Map;
  private touch: DrawingTouchSession;
  private enabled = false;
  private mouseDown = false;
  private touchCount = 0;
  private lastTouchAt = 0;
  private panWasEnabled = true;
  private doubleClickWasEnabled = true;
  private ownerWindow: Window;
  private inputQueue: FrameCoalescedDrawingInput;
  constructor(map: Map, emit: (input: DrawingInput) => void) {
    this.map = map;
    this.ownerWindow = map.getCanvasContainer().ownerDocument.defaultView!;
    this.inputQueue = new FrameCoalescedDrawingInput(
      emit,
      (callback) => this.ownerWindow.requestAnimationFrame(callback),
      (frame) => this.ownerWindow.cancelAnimationFrame(frame),
    );
    this.touch = new DrawingTouchSession((input) => this.inputQueue.input(input));
    map.on('touchstart', this.touchStart);
    map.on('touchmove', this.touchMove);
    map.on('touchend', this.touchEnd);
    map.on('touchcancel', this.touchCancel);
    map.on('mousedown', this.mouseStart);
    map.on('mousemove', this.mouseMove);
    map.on('movestart', this.cameraMove);
    this.ownerWindow.addEventListener('mouseup', this.mouseEnd, true);
    this.ownerWindow.addEventListener('blur', this.blur);
  }
  configure(enabled: boolean) {
    if (this.enabled === enabled) return;
    if (enabled) {
      this.panWasEnabled = this.map.dragPan.isEnabled();
      this.doubleClickWasEnabled = this.map.doubleClickZoom.isEnabled();
      this.map.doubleClickZoom.disable();
    } else {
      this.inputQueue.discard();
      this.touch.reset(false, 'interrupt');
      this.finishMouse('interrupt');
      this.touchCount = 0;
      this.pan(this.panWasEnabled);
      if (this.doubleClickWasEnabled) this.map.doubleClickZoom.enable();
    }
    this.enabled = enabled;
    this.map
      .getCanvasContainer()
      .classList.toggle('track-input-active', enabled);
  }
  private pan(enabled: boolean) {
    if (this.map.dragPan.isEnabled() !== enabled) {
      if (enabled) this.map.dragPan.enable();
      else this.map.dragPan.disable();
    }
  }
  private contacts(e: MapTouchEvent): Contact[] {
    const container = this.map.getCanvasContainer(),
      canvas = this.map.getCanvas(),
      rect = canvas.getBoundingClientRect();
    if (
      !rect.width ||
      !rect.height ||
      !canvas.clientWidth ||
      !canvas.clientHeight
    )
      return [];
    return Array.from(e.originalEvent.touches)
      .filter((t) => container.contains(t.target as Node))
      .map((t) => ({
        id: t.identifier,
        point: {
          x: ((t.clientX - rect.left) * canvas.clientWidth) / rect.width,
          y: ((t.clientY - rect.top) * canvas.clientHeight) / rect.height,
        },
      }));
  }
  private onTouch(type: 'start' | 'move' | 'end' | 'cancel', e: MapTouchEvent) {
    if (!this.enabled) return;
    this.lastTouchAt = Date.now();
    const contacts = type === 'cancel' ? [] : this.contacts(e);
    this.touchCount = contacts.length;
    if (type === 'start' && contacts.length === 1) this.map.stop();
    const navigation = this.touch.update(type, contacts);
    // Disable only single-finger panning. Never prevent the map touchstart:
    // MapLibre resets ALL touch recognizers when that event is prevented.
    // Pinch/rotate/pitch must observe both fingers even when they land apart.
    this.pan(this.panWasEnabled && (navigation || contacts.length === 0));
  }
  private touchStart = (e: MapTouchEvent) => this.onTouch('start', e);
  private touchMove = (e: MapTouchEvent) => this.onTouch('move', e);
  private touchEnd = (e: MapTouchEvent) => this.onTouch('end', e);
  private touchCancel = (e: MapTouchEvent) => this.onTouch('cancel', e);
  private mouseStart = (e: MapMouseEvent) => {
    if (
      !this.enabled ||
      this.touchCount ||
      Date.now() - this.lastTouchAt < 800 ||
      e.originalEvent.button !== 0
    )
      return;
    e.preventDefault();
    this.map.stop();
    this.mouseDown = true;
    this.inputQueue.input({ type: 'start', point: e.point });
  };
  private mouseMove = (e: MapMouseEvent) => {
    if (this.enabled && this.mouseDown)
      this.inputQueue.input({ type: 'move', point: e.point });
  };
  private finishMouse(reason: 'release' | 'interrupt') {
    if (this.mouseDown) {
      this.mouseDown = false;
      this.inputQueue.input({ type: 'end', reason });
    }
  }
  private mouseEnd = () => this.finishMouse('release');
  private cameraMove = () => {
    if (this.enabled) {
      this.inputQueue.discard();
      this.touch.interrupt();
      this.finishMouse('interrupt');
    }
  };
  private blur = () => {
    this.inputQueue.discard();
    this.touch.reset(false, 'interrupt');
    this.finishMouse('interrupt');
    this.touchCount = 0;
    if (this.enabled) this.pan(this.panWasEnabled);
  };
  dispose() {
    this.inputQueue.discard();
    this.configure(false);
    this.map.off('touchstart', this.touchStart);
    this.map.off('touchmove', this.touchMove);
    this.map.off('touchend', this.touchEnd);
    this.map.off('touchcancel', this.touchCancel);
    this.map.off('mousedown', this.mouseStart);
    this.map.off('mousemove', this.mouseMove);
    this.map.off('movestart', this.cameraMove);
    this.ownerWindow.removeEventListener('mouseup', this.mouseEnd, true);
    this.ownerWindow.removeEventListener('blur', this.blur);
  }
}
