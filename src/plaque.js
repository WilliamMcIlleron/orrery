import * as THREE from "three";

/**
 * The banner a monument raises once you have lit it.
 *
 * The projects are the entire payload of this piece and until now they were a
 * pillar you touched and a link that appeared in the corner. You could finish
 * the whole thing without ever learning what Lumen *is*. A portfolio that
 * hides its portfolio is a demo.
 *
 * So a lit monument raises a banner carrying the project's name, its one line,
 * and its own colour, at a size you can read from across the valley.
 *
 * Drawn to a canvas and uploaded as a texture, which is the only way to get
 * real type into this scene without breaking the rule the whole project is
 * built on: there are no asset files anywhere, and adding a font would be the
 * first. A canvas uses whatever the reader's system already has.
 */

/** Rendered at this width; the height follows the aspect below. */
const TEX_W = 1024;
const TEX_H = 720;

/**
 * The plate occupies the top of the canvas; the rest is the stem.
 *
 * Drawn into the same texture rather than built as its own geometry, so the
 * stem billboards with the plate for free and can never end up pointing off
 * at an angle when you walk around the monument.
 */
const PLATE_BOTTOM = 486;

/** World size of the whole banner, plate and stem together. */
export const PLAQUE_W = 9;
export const PLAQUE_H = 6.33;

/*
 * The stack asks for the reader's own interface font before anything else.
 *
 * A named family we cannot ship would silently fall back to Times on some
 * machines and quietly wreck the one piece of typography in the scene.
 */
const FACE = `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Break `text` into at most `maxLines` lines that fit `maxW`, measuring with
 * the font already set on the context.
 */
function wrap(ctx, text, maxW, maxLines) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width <= maxW || !line) {
      line = next;
    } else {
      lines.push(line);
      line = w;
      if (lines.length === maxLines) break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines;
}

/**
 * Draw one banner and return it as a texture.
 *
 * @param {{label:string, blurb:string, accent:THREE.Color, hasLink:boolean}} spec
 */
export function plaqueTexture({ label, blurb, accent, hasLink }) {
  const c = document.createElement("canvas");
  c.width = TEX_W;
  c.height = TEX_H;
  const ctx = c.getContext("2d");

  const hex = `#${accent.getHexString()}`;
  const pad = 46;

  // A dark plate so the type holds against a bright horizon, with the
  // project's colour as a hairline rather than a fill — a solid slab of brand
  // colour would be the loudest thing on the planet.
  ctx.fillStyle = "rgba(8,10,16,0.82)";
  roundRect(ctx, pad, pad, TEX_W - pad * 2, PLATE_BOTTOM - pad, 26);
  ctx.fill();
  ctx.strokeStyle = hex;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.globalAlpha = 1;

  // A rule in the project's colour, top left, standing in for a mark.
  ctx.fillStyle = hex;
  roundRect(ctx, pad + 44, pad + 52, 74, 6, 3);
  ctx.fill();

  ctx.textBaseline = "top";
  ctx.fillStyle = "#f2f5fb";
  ctx.font = `600 92px ${FACE}`;
  ctx.fillText(label, pad + 44, pad + 92, TEX_W - pad * 2 - 88);

  ctx.fillStyle = "rgba(226,233,245,0.72)";
  ctx.font = `400 44px ${FACE}`;
  const lines = wrap(ctx, blurb, TEX_W - pad * 2 - 88, 2);
  lines.forEach((l, i) => ctx.fillText(l, pad + 44, pad + 214 + i * 58));

  if (hasLink) {
    ctx.fillStyle = hex;
    ctx.font = `600 34px ${FACE}`;
    ctx.fillText("OPEN PROJECT  →", pad + 44, PLATE_BOTTOM - 98);
  }

  /*
   * The stem.
   *
   * Without it the plate hangs above the obelisk with nothing holding it,
   * which reads as an overlay dropped on the scene rather than as something
   * the monument raised. Drawn into this canvas rather than built as its own
   * geometry so it billboards with the plate and can never end up pointing off
   * at an angle as you come round the monument.
   */
  ctx.fillStyle = hex;
  ctx.globalAlpha = 0.45;
  ctx.fillRect(TEX_W / 2 - 3, PLATE_BOTTOM - 8, 6, TEX_H - PLATE_BOTTOM + 8);
  ctx.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  // Read at a glancing angle from most of the planet, so it is worth the
  // anisotropy — without it the type smears into a grey band at distance.
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

/**
 * Build the banner mesh for one monument.
 *
 * Returns a mesh parked at the monument, invisible until `setPlaque` is given
 * something above zero.
 */
export function makePlaque(spec, at, up) {
  const tex = plaqueTexture(spec);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    opacity: 0,
    // Lit by nothing: it is a sign, and a sign that goes dark on the night
    // side of a planet is a sign nobody reads.
    fog: true,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(PLAQUE_W, PLAQUE_H), mat);
  mesh.visible = false;
  mesh.renderOrder = 3;
  // Taken out of the bloom pass rather than painted black — see _darken.
  mesh.userData.bloomSkip = true;
  mesh.position.copy(at);
  mesh.userData.up = up.clone();
  mesh.userData.at = at.clone();
  return mesh;
}
