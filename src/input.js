/**
 * Input, normalised to a single 2D vector in the range -1 to 1.
 *
 * Keyboard and touch feed the same vector, so nothing downstream needs to know
 * or care which one is being used. The virtual stick appears wherever the
 * finger lands rather than in a fixed corner — a fixed stick means looking
 * down at your thumb, which on a piece someone plays for forty seconds is
 * forty seconds of not looking at the thing you built.
 */

const STICK_RADIUS = 54;

/**
 * Radians of view rotation per pixel dragged.
 *
 * Tuned so a drag across a phone screen turns you about a hundred and eighty
 * degrees — far enough to look behind you in one gesture, which is the thing
 * you actually want on a planet you can see a third of.
 */
const LOOK_SENS = 0.0055;
/** Radians per second for the keyboard equivalent. */
const LOOK_KEY_RATE = 1.5;

/**
 * Is this keypress aimed at a control rather than at the world?
 *
 * Buttons and links have keyboard behaviour of their own, and the game's key
 * handlers run at window level where they would otherwise win.
 */
export function isControlTarget(t) {
  return !!(t && t.closest && t.closest('button, a[href], input, select, textarea, [contenteditable], [role="button"]'));
}

export class Input {
  constructor(target, stickEl) {
    this.keys = new Set();
    this.touch = { active: false, id: -1, ox: 0, oy: 0, x: 0, y: 0 };
    this.onFirstUse = null;
    this._used = false;

    /** Accumulated free-look movement, drained by takeLook each frame. */
    this._look = { yaw: 0, pitch: 0 };
    /** The pointer currently doing the looking, if any. */
    this._lookId = null;

    this.stickEl = stickEl;
    this.baseEl = stickEl?.querySelector(".base") ?? null;
    this.knobEl = stickEl?.querySelector(".knob") ?? null;

    addEventListener(
      "keydown",
      (e) => {
        // Not while a control has focus. Space activates a focused button, and
        // swallowing it globally means a keyboard user can tab to the palette
        // and then find that pressing it jumps the marble instead — the piece
        // claims to be keyboard playable, so the claim has to hold for the
        // chrome as well as for the world.
        if (isControlTarget(e.target)) return;
        if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) {
          e.preventDefault();
        }
        this.keys.add(e.key.toLowerCase());
        this._markUsed();
      },
      { passive: false },
    );
    addEventListener("keyup", (e) => this.keys.delete(e.key.toLowerCase()));
    // A held key with the window unfocused would otherwise stick forever.
    addEventListener("blur", () => this.keys.clear());

    target.addEventListener("pointerdown", (e) => this._down(e, target));
    target.addEventListener("pointermove", (e) => this._move(e));
    target.addEventListener("pointerup", (e) => this._up(e));
    target.addEventListener("pointercancel", (e) => this._up(e));
    // Right-drag is the look control on a mouse, so the menu has to go. Only
    // on the canvas — right-clicking the chrome still behaves normally.
    target.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  /**
   * Read and clear the free-look movement since the last frame.
   *
   * Deltas rather than an absolute angle, because the camera owns the angle
   * and the clamping that goes with it. Input's job is to say how much the
   * player asked for.
   *
   * @param {number} dt seconds, for the keyboard rate
   * @returns {{yaw: number, pitch: number}} radians
   */
  takeLook(dt = 0) {
    const k = this.keys;
    let yaw = this._look.yaw;
    let pitch = this._look.pitch;
    if (k.has("q")) yaw -= LOOK_KEY_RATE * dt;
    if (k.has("e")) yaw += LOOK_KEY_RATE * dt;
    if (k.has("r")) pitch += LOOK_KEY_RATE * 0.6 * dt;
    if (k.has("f")) pitch -= LOOK_KEY_RATE * 0.6 * dt;
    this._look.yaw = 0;
    this._look.pitch = 0;
    return { yaw, pitch };
  }

  _markUsed() {
    if (this._used) return;
    this._used = true;
    this.onFirstUse?.();
  }

  _down(e, target) {
    /*
     * Who gets this pointer.
     *
     * On a mouse the right button looks and the left steers, which is the
     * convention and leaves the existing control untouched. On a touch screen
     * the first finger steers and a second one looks — also the convention,
     * and it means the gesture is available without a mode or a button.
     */
    const wantsLook =
      (e.pointerType === "mouse" && (e.button === 2 || e.shiftKey)) ||
      (e.pointerType !== "mouse" && this.touch.active);

    if (wantsLook && this._lookId === null) {
      this._lookId = e.pointerId;
      this._lx = e.clientX;
      this._ly = e.clientY;
      target.setPointerCapture(e.pointerId);
      this._markUsed();
      return;
    }
    if (e.pointerType === "mouse" && e.button !== 0) return;

    if (this.touch.active) return;
    const t = this.touch;
    t.active = true;
    t.id = e.pointerId;
    t.ox = e.clientX;
    t.oy = e.clientY;
    t.x = 0;
    t.y = 0;
    if (this.baseEl) {
      this.baseEl.style.left = this.knobEl.style.left = `${t.ox}px`;
      this.baseEl.style.top = this.knobEl.style.top = `${t.oy}px`;
      this.stickEl.style.opacity = "1";
    }
    target.setPointerCapture(e.pointerId);
    this._markUsed();
  }

  _move(e) {
    if (e.pointerId === this._lookId) {
      // Screen-down drags the view down, which is the direct mapping — you are
      // pushing the world, not the camera. Inverting it is a preference nobody
      // has asked for yet.
      this._look.yaw += (e.clientX - this._lx) * LOOK_SENS;
      this._look.pitch += (e.clientY - this._ly) * LOOK_SENS;
      this._lx = e.clientX;
      this._ly = e.clientY;
      return;
    }
    const t = this.touch;
    if (!t.active || e.pointerId !== t.id) return;
    let dx = e.clientX - t.ox;
    let dy = e.clientY - t.oy;
    const len = Math.hypot(dx, dy);
    if (len > STICK_RADIUS) {
      dx *= STICK_RADIUS / len;
      dy *= STICK_RADIUS / len;
    }
    t.x = dx / STICK_RADIUS;
    t.y = dy / STICK_RADIUS;
    if (this.knobEl) {
      this.knobEl.style.left = `${t.ox + dx}px`;
      this.knobEl.style.top = `${t.oy + dy}px`;
    }
  }

  _up(e) {
    if (e.pointerId === this._lookId) {
      this._lookId = null;
      return;
    }
    const t = this.touch;
    if (!t.active || e.pointerId !== t.id) return;
    t.active = false;
    t.x = t.y = 0;
    if (this.stickEl) this.stickEl.style.opacity = "0";
  }

  /** @returns {{x: number, y: number}} clamped to the unit disc. */
  read() {
    let x = 0;
    let y = 0;
    const k = this.keys;
    if (k.has("a") || k.has("arrowleft")) x -= 1;
    if (k.has("d") || k.has("arrowright")) x += 1;
    if (k.has("w") || k.has("arrowup")) y -= 1;
    if (k.has("s") || k.has("arrowdown")) y += 1;

    // Clamp twice: once so diagonal keys are not faster than straight ones,
    // once more after adding touch so the two cannot sum past full tilt.
    let l = Math.hypot(x, y);
    if (l > 1) {
      x /= l;
      y /= l;
    }
    if (this.touch.active) {
      x += this.touch.x;
      y += this.touch.y;
    }
    l = Math.hypot(x, y);
    if (l > 1) {
      x /= l;
      y /= l;
    }
    return { x, y };
  }
}
