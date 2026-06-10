export class Input {
  // Pass an AbortSignal to scope all listeners to a single play session —
  // aborting it (e.g. when quitting to the main menu) removes them all so a
  // stale Input instance from a previous session can't interfere.
  constructor(signal) {
    this.keys = {};
    this.mouseButtons = {};
    this.mouseDelta = { x: 0, y: 0 };
    this.scroll = 0;
    this._pointerLocked = false;
    this._pendingClick = false;
    this._rightClick = false;
    this._consumedKeys = new Set();
    window.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      this.keys[e.code] = true;
      this.keys[e.key.toLowerCase()] = true;
    }, { signal });
    window.addEventListener('keyup', e => {
      this.keys[e.code] = false;
      this.keys[e.key.toLowerCase()] = false;
    }, { signal });
    window.addEventListener('mousedown', e => {
      this.mouseButtons[e.button] = true;
      if (e.button === 0) this._pendingClick = true;
      if (e.button === 2) this._rightClick = true;
    }, { signal });
    window.addEventListener('mouseup', e => { this.mouseButtons[e.button] = false; }, { signal });
    window.addEventListener('mousemove', e => {
      if (this._pointerLocked) {
        this.mouseDelta.x += e.movementX;
        this.mouseDelta.y += e.movementY;
      }
    }, { signal });
    window.addEventListener('wheel', e => { this.scroll += e.deltaY; }, { passive: true, signal });
    document.addEventListener('pointerlockchange', () => {
      this._pointerLocked = !!document.pointerLockElement;
    }, { signal });
  }

  isDown(code) { return !!this.keys[code]; }

  // Returns true once per physical keydown, then false until key is released and pressed again
  consumeKey(code) {
    if (this.keys[code] && !this._consumedKeys.has(code)) {
      this._consumedKeys.add(code);
      return true;
    }
    if (!this.keys[code]) this._consumedKeys.delete(code);
    return false;
  }
  isMouseDown(btn = 0) { return !!this.mouseButtons[btn]; }

  consumeMouseDelta() {
    const d = { x: this.mouseDelta.x, y: this.mouseDelta.y };
    this.mouseDelta.x = 0;
    this.mouseDelta.y = 0;
    return d;
  }

  consumeScroll() {
    const s = this.scroll;
    this.scroll = 0;
    return s;
  }

  consumeClick() {
    const c = this._pendingClick;
    this._pendingClick = false;
    return c;
  }

  consumeRightClick() {
    const c = this._rightClick;
    this._rightClick = false;
    return c;
  }

  requestPointerLock(canvas) {
    canvas.requestPointerLock();
  }

  get pointerLocked() { return this._pointerLocked; }
}
