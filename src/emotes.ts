import type { EmoteId } from "./voxelChar";

/**
 * Island social toolkit — the emote wheel + preset quick-chat, plus the small
 * on-screen "Express" button so touch players get the same access as desktop.
 *
 * Self-contained DOM (built into a passed root, like Hud.setPrompt) so it doesn't
 * need bespoke index.html markup. The owner (main.ts) wires two callbacks:
 *   onEmote(id)  → broadcast + play the emote on self
 *   onChat(text) → broadcast + show a speech bubble on self
 * and is told when the menu opens/closes via onOpenChange (drives the peer "…"
 * typing bubble through presence).
 */

export interface EmoteDef {
  id: EmoteId;
  icon: string; // emoji shown in the wheel
  label: string;
}

/** The four committed emotes (matches VoxelChar.emote ids). */
export const EMOTES: EmoteDef[] = [
  { id: "wave", icon: "👋", label: "Wave" },
  { id: "dance", icon: "💃", label: "Dance" },
  { id: "sit", icon: "🪑", label: "Sit" },
  { id: "cheer", icon: "🎉", label: "Cheer" },
];

/** Preset safe phrases — fixed list, no free text (avoids moderation). */
export const QUICK_CHAT: string[] = ["Hi!", "GG!", "Follow me!", "Need a 4th!", "Nice house!", "❤"];

export interface EmoteMenuCallbacks {
  onEmote: (id: EmoteId) => void;
  onChat: (text: string) => void;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Radial emote wheel + quick-chat strip. Open with `toggle()` (bound to the "T"
 * key in main) or by tapping the on-screen Express button. Selecting an item
 * fires the callback and closes the menu.
 */
export class EmoteMenu {
  private wrap: HTMLElement;
  private wheel: HTMLElement;
  private button: HTMLElement;
  private open = false;

  constructor(root: HTMLElement, private cbs: EmoteMenuCallbacks) {
    // on-screen toggle button (touch + desktop); hidden unless island mode
    this.button = document.createElement("button");
    this.button.className = "emote-fab";
    this.button.textContent = "😀";
    this.button.title = "Express (T)";
    this.button.style.display = "none";
    this.button.addEventListener("click", (e) => {
      e.preventDefault();
      this.toggle();
    });
    root.appendChild(this.button);

    // the radial overlay (emotes in a ring + a quick-chat strip below)
    this.wrap = document.createElement("div");
    this.wrap.className = "emote-overlay";
    this.wrap.style.display = "none";
    // tapping the backdrop closes the menu
    this.wrap.addEventListener("pointerdown", (e) => {
      if (e.target === this.wrap) this.close();
    });

    this.wheel = document.createElement("div");
    this.wheel.className = "emote-wheel";
    const n = EMOTES.length;
    const R = 96; // wheel radius in px
    EMOTES.forEach((em, i) => {
      const b = document.createElement("button");
      b.className = "emote-slot";
      b.type = "button";
      b.innerHTML = `<span class="emo-ico">${em.icon}</span><span class="emo-lbl">${em.label}</span>`;
      // lay the slots out evenly around a circle (start at the top)
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
      b.style.left = `calc(50% + ${Math.cos(a) * R}px)`;
      b.style.top = `calc(50% + ${Math.sin(a) * R}px)`;
      b.addEventListener("click", (e) => {
        e.preventDefault();
        this.cbs.onEmote(em.id);
        this.close();
      });
      this.wheel.appendChild(b);
    });
    this.wrap.appendChild(this.wheel);

    const chat = document.createElement("div");
    chat.className = "quick-chat";
    for (const phrase of QUICK_CHAT) {
      const b = document.createElement("button");
      b.className = "qc-btn";
      b.type = "button";
      b.textContent = phrase;
      b.addEventListener("click", (e) => {
        e.preventDefault();
        this.cbs.onChat(phrase);
        this.close();
      });
      chat.appendChild(b);
    }
    this.wrap.appendChild(chat);
    root.appendChild(this.wrap);
  }

  /** Show/hide the on-screen Express button (only meaningful in island mode). */
  setAvailable(on: boolean) {
    this.button.style.display = on ? "flex" : "none";
    if (!on) this.close();
  }

  /** Whether the menu is currently open (peers show a "…" bubble while it is). */
  get isOpen(): boolean {
    return this.open;
  }

  toggle() {
    this.open ? this.close() : this.show();
  }

  show() {
    if (this.open) return;
    this.open = true;
    this.wrap.style.display = "flex";
    this.cbs.onOpenChange?.(true);
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.wrap.style.display = "none";
    this.cbs.onOpenChange?.(false);
  }
}
