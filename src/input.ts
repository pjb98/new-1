import * as THREE from "three";

/**
 * Keyboard + mouse input. Tracks held keys, edge-triggered presses, fire state,
 * and projects the pointer onto the ground plane (y=0) to get a world aim point.
 */
export class Input {
  private held = new Set<string>();
  private pressedThisFrame = new Set<string>();
  private clickedThisFrame = false;
  firing = false;

  readonly pointer = new THREE.Vector2(); // normalized device coords
  readonly aimPoint = new THREE.Vector3(); // world-space point on ground

  // ---- touch (set by TouchControls) ----
  /** Left-stick movement (x = right, y = forward/+ up). Zero = no touch move. */
  readonly moveVec = new THREE.Vector2();
  /** Right-stick aim direction in world XZ (x = world X, y = world Z), or null
   *  when the aim stick isn't engaged. Non-null also means "fire". */
  touchAim: THREE.Vector2 | null = null;

  private ray = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  constructor(private dom: HTMLElement) {
    addEventListener("keydown", this.onKeyDown);
    addEventListener("keyup", this.onKeyUp);
    dom.addEventListener("pointermove", this.onPointerMove);
    dom.addEventListener("pointerdown", this.onPointerDown);
    addEventListener("pointerup", this.onPointerUp);
    // Avoid the right-click menu / drag-select getting in the way.
    dom.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const k = e.code;
    if (!this.held.has(k)) this.pressedThisFrame.add(k);
    this.held.add(k);
  };
  private onKeyUp = (e: KeyboardEvent) => this.held.delete(e.code);

  private onPointerMove = (e: PointerEvent) => {
    const r = this.dom.getBoundingClientRect();
    this.pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  };
  private onPointerDown = (e: PointerEvent) => {
    if (e.button === 0) {
      this.firing = true;
      this.clickedThisFrame = true;
    }
  };

  /** True on the frame the left button was pressed (for semi-auto weapons). */
  clicked(): boolean {
    return this.clickedThisFrame;
  }
  private onPointerUp = (e: PointerEvent) => {
    if (e.button === 0) this.firing = false;
  };

  /** WASD (or the touch left-stick) as a 2D direction (x = right, y = forward). */
  moveAxis(out: THREE.Vector2): THREE.Vector2 {
    // Touch stick takes priority when engaged (allows analog/partial speed).
    if (this.moveVec.lengthSq() > 0.0004) {
      out.copy(this.moveVec);
      if (out.lengthSq() > 1) out.normalize();
      return out;
    }
    let x = 0;
    let y = 0;
    if (this.held.has("KeyW") || this.held.has("ArrowUp")) y += 1;
    if (this.held.has("KeyS") || this.held.has("ArrowDown")) y -= 1;
    if (this.held.has("KeyA") || this.held.has("ArrowLeft")) x -= 1;
    if (this.held.has("KeyD") || this.held.has("ArrowRight")) x += 1;
    out.set(x, y);
    if (out.lengthSq() > 1) out.normalize();
    return out;
  }

  pressed(code: string): boolean {
    return this.pressedThisFrame.has(code);
  }

  /** True while `code` is currently held (for chords like Ctrl+Z). */
  down(code: string): boolean {
    return this.held.has(code);
  }

  /** Inject a one-frame "key press" (used by on-screen touch buttons). */
  injectPress(code: string) {
    this.pressedThisFrame.add(code);
  }

  /** Recompute the ground aim point from the current pointer + camera. */
  updateAim(camera: THREE.Camera) {
    this.ray.setFromCamera(this.pointer, camera);
    this.ray.ray.intersectPlane(this.groundPlane, this.aimPoint);
  }

  /** Call at the very end of each frame to clear edge-triggered state. */
  endFrame() {
    this.pressedThisFrame.clear();
    this.clickedThisFrame = false;
  }
}
