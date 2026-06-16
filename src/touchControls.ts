import * as THREE from "three";
import { Input } from "./input";

/** True only on touch-primary devices (phones/tablets) — NOT touch-capable
 *  laptops/monitors, which have a mouse and must keep desktop mouse aiming. */
export function isTouchDevice(): boolean {
  if (typeof matchMedia !== "function") return "ontouchstart" in window;
  return matchMedia("(pointer: coarse)").matches && matchMedia("(hover: none)").matches;
}

const RADIUS = 56; // px travel of a stick knob
const AIM_DEADZONE = 0.22; // fraction of radius before the aim stick fires

/**
 * On-screen twin-stick controls for touch devices. Left half of the screen is a
 * floating movement stick; right half is a floating aim-and-fire stick. A small
 * cluster of action buttons (interact / reload / swap) and a pause button feed
 * synthetic key presses into Input. Hidden unless the game says it's active.
 */
export class TouchControls {
  private root: HTMLElement;
  private moveStick: HTMLElement;
  private moveKnob: HTMLElement;
  private aimStick: HTMLElement;
  private aimKnob: HTMLElement;

  private moveId = -1;
  private aimId = -1;
  private aimEnabled = true; // off in non-combat modes (lobby / Tower Defense)
  private moveOrigin = new THREE.Vector2();
  private aimOrigin = new THREE.Vector2();

  constructor(private input: Input) {
    this.root = document.createElement("div");
    this.root.id = "touch";
    this.root.innerHTML = `
      <div class="tstick" id="t-move"><div class="tknob"></div></div>
      <div class="tstick" id="t-aim"><div class="tknob"></div></div>
      <div class="tbtns">
        <button class="tbtn act" data-k="KeyE" aria-label="Interact">E</button>
        <button class="tbtn combat" data-k="KeyR" aria-label="Reload">R</button>
        <button class="tbtn combat" data-k="KeyQ" aria-label="Swap">Q</button>
        <button class="tbtn nuke combat" data-k="KeyF" aria-label="Nuke">☢</button>
      </div>
      <button class="tbtn pause" data-k="KeyP" aria-label="Pause">II</button>
    `;
    document.getElementById("app")!.appendChild(this.root);

    this.moveStick = this.root.querySelector("#t-move") as HTMLElement;
    this.moveKnob = this.moveStick.querySelector(".tknob") as HTMLElement;
    this.aimStick = this.root.querySelector("#t-aim") as HTMLElement;
    this.aimKnob = this.aimStick.querySelector(".tknob") as HTMLElement;

    // Action buttons inject a one-frame key press; stopPropagation so a tap on a
    // button doesn't also start a stick.
    this.root.querySelectorAll<HTMLButtonElement>(".tbtn").forEach((btn) => {
      const press = (e: Event) => {
        e.stopPropagation();
        e.preventDefault();
        this.input.injectPress(btn.dataset.k!);
        btn.classList.add("on");
      };
      btn.addEventListener("pointerdown", press);
      btn.addEventListener("pointerup", () => btn.classList.remove("on"));
      btn.addEventListener("pointercancel", () => btn.classList.remove("on"));
    });

    this.root.addEventListener("pointerdown", this.onDown);
    this.root.addEventListener("pointermove", this.onMove);
    this.root.addEventListener("pointerup", this.onUp);
    this.root.addEventListener("pointercancel", this.onUp);
    this.setActive(false);
  }

  setActive(on: boolean) {
    this.root.style.display = on ? "block" : "none";
    if (!on) this.reset();
  }

  /** Show the combat-only buttons (Reload / Swap / Nuke). Off in the lobby and
   *  other non-shooting modes, leaving just E (interact) + the emote button. */
  setCombatButtons(on: boolean) {
    this.root.querySelectorAll<HTMLElement>(".tbtn.combat").forEach((b) => {
      b.style.display = on ? "" : "none";
    });
  }

  /** Enable the right-hand AIM/fire stick. Off in non-shooting modes (lobby,
   *  Tower Defense) so a stray right-side drag doesn't pop a useless aim stick. */
  setAimEnabled(on: boolean) {
    this.aimEnabled = on;
    if (!on) {
      this.aimId = -1;
      this.input.touchAim = null;
      this.aimStick.classList.remove("show");
    }
  }

  private reset() {
    this.moveId = this.aimId = -1;
    this.input.moveVec.set(0, 0);
    this.input.touchAim = null;
    this.moveStick.classList.remove("show");
    this.aimStick.classList.remove("show");
  }

  private onDown = (e: PointerEvent) => {
    e.preventDefault();
    const leftHalf = e.clientX < window.innerWidth / 2;
    if (leftHalf && this.moveId === -1) {
      this.moveId = e.pointerId;
      this.moveOrigin.set(e.clientX, e.clientY);
      this.placeStick(this.moveStick, e.clientX, e.clientY);
      this.moveKnob.style.transform = "translate(-50%, -50%)";
    } else if (!leftHalf && this.aimId === -1 && this.aimEnabled) {
      this.aimId = e.pointerId;
      this.aimOrigin.set(e.clientX, e.clientY);
      this.placeStick(this.aimStick, e.clientX, e.clientY);
      this.aimKnob.style.transform = "translate(-50%, -50%)";
    }
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  private onMove = (e: PointerEvent) => {
    if (e.pointerId === this.moveId) {
      const dx = e.clientX - this.moveOrigin.x;
      const dy = e.clientY - this.moveOrigin.y;
      const { cx, cy, mag } = this.clamp(dx, dy);
      this.moveKnob.style.transform = `translate(calc(-50% + ${cx}px), calc(-50% + ${cy}px))`;
      // screen-up (dy<0) = forward (+y); screen-right = +x
      this.input.moveVec.set(cx / RADIUS, -cy / RADIUS);
      void mag;
    } else if (e.pointerId === this.aimId) {
      const dx = e.clientX - this.aimOrigin.x;
      const dy = e.clientY - this.aimOrigin.y;
      const { cx, cy, mag } = this.clamp(dx, dy);
      this.aimKnob.style.transform = `translate(calc(-50% + ${cx}px), calc(-50% + ${cy}px))`;
      if (mag > AIM_DEADZONE) {
        const len = Math.hypot(cx, cy) || 1;
        // map to world XZ: screen-up = -Z (forward), screen-right = +X
        if (!this.input.touchAim) this.input.touchAim = new THREE.Vector2();
        this.input.touchAim.set(cx / len, cy / len);
      } else {
        this.input.touchAim = null; // inside deadzone = aim/idle, no fire
      }
    }
  };

  private onUp = (e: PointerEvent) => {
    if (e.pointerId === this.moveId) {
      this.moveId = -1;
      this.input.moveVec.set(0, 0);
      this.moveStick.classList.remove("show");
    } else if (e.pointerId === this.aimId) {
      this.aimId = -1;
      this.input.touchAim = null;
      this.aimStick.classList.remove("show");
    }
  };

  private clamp(dx: number, dy: number): { cx: number; cy: number; mag: number } {
    const d = Math.hypot(dx, dy);
    const m = Math.min(d, RADIUS);
    const a = Math.atan2(dy, dx);
    return { cx: Math.cos(a) * m, cy: Math.sin(a) * m, mag: m / RADIUS };
  }

  private placeStick(el: HTMLElement, x: number, y: number) {
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.classList.add("show");
  }
}
