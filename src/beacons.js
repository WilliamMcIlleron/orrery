import * as THREE from "three";
import { seesOverHorizon } from "./geometry.js";

const _p = new THREE.Vector3();

/**
 * The ending.
 *
 * Once dawn breaks, every lit monument grows a permanent world-anchored label
 * — not just the one you happen to be standing next to. They track their
 * pillars as you roll and disappear when the pillar itself goes over the
 * horizon, so the planet ends the piece covered in its own contents.
 *
 * This is the part that does the commercial job. Everything before it is a
 * toy; this is four links, placed where the person who enjoyed the toy is
 * already looking, and reachable from anywhere rather than only by returning
 * to each pillar in turn.
 *
 * DOM rather than 3D text, deliberately: no font file (a hard constraint of
 * the project), real anchors that are keyboard-reachable and legible to a
 * screen reader, and text that stays sharp at any distance.
 */
export class Beacons {
  constructor(container, camera, monuments) {
    this.container = container;
    this.camera = camera;
    this.items = [];
    this.active = false;
    /** The beacon currently holding keyboard focus, if any. */
    this.focused = null;
    /**
     * A monument whose label the proximity marker is currently showing.
     *
     * Set from the frame loop. Its beacon hides, so a pillar you are standing
     * at never carries two labels at once.
     */
    this.suppress = null;

    for (const m of monuments) {
      const el = document.createElement("a");
      el.className = "beacon";
      el.target = "_blank";
      el.rel = "noopener noreferrer";
      el.href = m.href ?? "#";
      el.style.color = `#${m.colour.toString(16).padStart(6, "0")}`;
      el.innerHTML =
        `<span class="bc-dot"></span>` +
        `<span class="bc-text"><span class="bc-name"></span>` +
        `<span class="bc-blurb"></span></span>`;
      el.querySelector(".bc-name").textContent = m.label;
      el.querySelector(".bc-blurb").textContent = m.blurb;
      /*
       * Keyboard focus pins the label.
       *
       * These track their pillars in 3D, so most of them are off screen or
       * behind the planet at any moment — and tabbing to a link you cannot see
       * is worse than not being able to tab to it at all. When one takes
       * focus it stops tracking and parks somewhere legible, so a keyboard
       * user can walk all four and open any of them without ever moving the
       * marble.
       */
      el.addEventListener("focus", () => {
        this.focused = el;
        el.classList.add("pinned");
      });
      el.addEventListener("blur", () => {
        if (this.focused === el) this.focused = null;
        el.classList.remove("pinned");
      });

      container.appendChild(el);
      this.items.push({ m, el });
    }
  }

  /** Reveal, staggered so they arrive as a sequence rather than a wall. */
  reveal() {
    if (this.active) return;
    this.active = true;
    this.items.forEach((it, i) => {
      setTimeout(() => it.el.classList.add("on"), 140 * i);
    });
  }

  update() {
    if (!this.active) return;

    for (const { m, el } of this.items) {
      if (m === this.suppress && el !== this.focused) {
        el.style.opacity = "0";
        el.style.pointerEvents = "none";
        continue;
      }

      // A pinned label is being read. Leave it where it is.
      if (el === this.focused) {
        el.style.opacity = "1";
        el.style.pointerEvents = "auto";
        continue;
      }

      // Same exact horizon test the wayfinder uses. Projection alone would
      // happily place a label for a pillar buried under a hemisphere of rock.
      if (!seesOverHorizon(m.pos, this.camera.position)) {
        el.style.opacity = "0";
        el.style.pointerEvents = "none";
        continue;
      }

      _p.copy(m.pos).project(this.camera);
      if (_p.z > 1) {
        el.style.opacity = "0";
        el.style.pointerEvents = "none";
        continue;
      }

      const x = (_p.x * 0.5 + 0.5) * innerWidth;
      const y = (-_p.y * 0.5 + 0.5) * innerHeight;
      el.style.transform = `translate(-50%, -100%) translate(${x}px, ${y - 14}px)`;

      // Fade at the screen edge rather than clipping. A label half off the
      // side reads as a bug; one fading out reads as distance.
      const edge = Math.min(
        1,
        Math.min(x, innerWidth - x) / 90,
        Math.min(y, innerHeight - y) / 90,
      );
      el.style.opacity = String(Math.max(0, edge));
      el.style.pointerEvents = edge > 0.6 ? "auto" : "none";
    }
  }
}
