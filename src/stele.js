import * as THREE from "three";
import { groundRadius } from "./geometry.js";

/**
 * The leaderboard, as a thing standing on the ground.
 *
 * A scoreboard drawn over the top of the screen would be a different
 * application wearing this one's clothes. The times belong to the planet, so
 * they are cut into a stone that stands near where you land, which means you
 * read them by driving up to them and you see them before your first run as
 * well as after it.
 *
 * Inscribed on both faces, because a stone with a back is a stone half the
 * people who find it will walk round and learn nothing from.
 */

const TEX = 900;
/*
 * The inscription has to fit the face it is cut into, and the face is not the
 * scale factor.
 *
 * A four-segment cylinder turned an eighth has its flat sides at cos(45) of
 * the radius, so a scale of 3.4 in x gives a face 2 * 0.707 * 3.4 = 4.81 wide,
 * not 6.8. The first version used a 5.4 plane on a 4.38 face and hung the gold
 * border out past the stone on both sides, then sank it at z = 0.33 when the
 * face sits at 0.438 — so the stone swallowed its own inscription.
 */
const FACE_W = 4.4;
const FACE_H = 4.4;

/**
 * Clear of the face at every height.
 *
 * The stone tapers, so its surface is further out at the bottom than the top —
 * with the plane at 0.46 the widening base came forward past it and ate the
 * lower half of the board. The taper is gentler now (1 to 1.05 rather than
 * 1.12, which puts the widest face at 0.46) and this sits clear of all of it.
 */
const FACE_Z = 0.5;

const FONT = `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;

/** How many rows fit before the type gets too small to read at a roll-past. */
export const BOARD_ROWS = 8;

function fmt(secs) {
  return `${(Math.round(secs * 10) / 10).toFixed(1)}s`;
}

/**
 * Draw the inscription.
 *
 * @param {Array<{name:string, place:string, secs:number, crystals:number}>} rows
 */
function inscribe(ctx, rows, accentHex, subtitle) {
  ctx.clearRect(0, 0, TEX, TEX);

  ctx.fillStyle = "rgba(6,8,13,0.9)";
  ctx.fillRect(0, 0, TEX, TEX);

  ctx.strokeStyle = accentHex;
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = 4;
  ctx.strokeRect(26, 26, TEX - 52, TEX - 52);
  ctx.globalAlpha = 1;

  ctx.textBaseline = "top";
  ctx.fillStyle = accentHex;
  ctx.font = `600 46px ${FONT}`;
  ctx.fillText("FASTEST", 68, 74);

  ctx.fillStyle = "rgba(215,224,240,0.5)";
  ctx.font = `400 26px ${FONT}`;
  ctx.fillText(subtitle, 68, 134);

  ctx.globalAlpha = 0.3;
  ctx.fillStyle = accentHex;
  ctx.fillRect(68, 186, TEX - 136, 3);
  ctx.globalAlpha = 1;

  if (!rows.length) {
    ctx.fillStyle = "rgba(215,224,240,0.42)";
    ctx.font = `400 30px ${FONT}`;
    ctx.fillText("no times cut yet", 68, 250);
    ctx.fillText("finish a run and", 68, 296);
    ctx.fillText("yours goes here", 68, 342);
    return;
  }

  const top = 224;
  const step = 76;
  rows.slice(0, BOARD_ROWS).forEach((r, i) => {
    const y = top + i * step;

    ctx.fillStyle = "rgba(215,224,240,0.34)";
    ctx.font = `600 28px ${FONT}`;
    ctx.fillText(String(i + 1).padStart(2, "0"), 68, y + 8);

    ctx.fillStyle = i === 0 ? accentHex : "rgba(233,239,250,0.92)";
    ctx.font = `600 38px ${FONT}`;
    ctx.fillText(r.name, 136, y);

    if (r.place) {
      ctx.fillStyle = "rgba(215,224,240,0.42)";
      ctx.font = `400 24px ${FONT}`;
      ctx.fillText(r.place, 138, y + 42);
    }

    // Times right-aligned, so the column reads as a column.
    ctx.textAlign = "right";
    ctx.fillStyle = i === 0 ? accentHex : "rgba(233,239,250,0.8)";
    ctx.font = `600 36px ${FONT}`;
    ctx.fillText(fmt(r.secs), TEX - 68, y + 4);
    ctx.textAlign = "left";
  });
}

/**
 * Build the stone and return it with a way to re-cut the inscription.
 *
 * @param {THREE.Vector3} dir unit direction to stand it on
 */
export function makeStele(scene, dir, accent, rockMat, capsules) {
  const up = dir.clone().normalize();
  const base = up.clone().multiplyScalar(groundRadius(up));
  const group = new THREE.Group();

  const H = 7.2;
  /*
   * A four-sided tapered prism, squashed flat.
   *
   * Cylinder with four segments gives a prism whose faces sit at 45 degrees to
   * the axes, so it is turned an eighth before scaling — otherwise the "flat
   * face" is an edge and the inscription hangs off a corner.
   */
  const slab = new THREE.CylinderGeometry(1, 1.05, 1, 4, 1);
  slab.rotateY(Math.PI / 4);
  slab.scale(3.4, H, 0.62);
  slab.translate(0, H * 0.5 - 0.55, 0);
  const stone = new THREE.Mesh(slab, rockMat);
  stone.castShadow = true;
  stone.receiveShadow = true;
  group.add(stone);

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = TEX;
  const ctx = canvas.getContext("2d");
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;

  const faceMat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    // Sat proud of the stone by a hair; without the offset the two surfaces
    // fight for the same depth and the inscription flickers as you circle it.
    depthWrite: false,
  });
  faceMat.polygonOffset = true;
  faceMat.polygonOffsetFactor = -2;

  const faces = [];
  for (const s of [1, -1]) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(FACE_W, FACE_H), faceMat);
    f.position.set(0, H * 0.58, s * FACE_Z);
    if (s < 0) f.rotation.y = Math.PI;
    // Taken out of the bloom darken pass for the same reason the project
    // banners are: an opaque black stand-in would blot out what is behind it.
    f.userData.bloomSkip = true;
    group.add(f);
    faces.push(f);
  }

  // Stand it up: the group's own Y has to become the planet's up here.
  group.position.copy(base);
  group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
  scene.add(group);

  // Collidable, or you roll straight through the one solid object in the piece
  // that is trying to look solid.
  capsules.push({
    a: base.clone(),
    b: base.clone().addScaledVector(up, H * 0.92),
    r: 1.75,
    kind: "stone",
    minImpact: 0.35,
  });

  const accentHex = `#${new THREE.Color(accent).getHexString()}`;
  let subtitle = "";

  function refresh(rows, note) {
    if (note !== undefined) subtitle = note;
    inscribe(ctx, rows ?? [], accentHex, subtitle);
    tex.needsUpdate = true;
  }

  refresh([], "");
  return { group, refresh, position: base.clone().addScaledVector(up, H * 0.6) };
}
