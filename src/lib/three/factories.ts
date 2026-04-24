// three/factories.ts — прикладная библиотека/утилиты.

import * as THREE from 'three';

/* ─── helpers ─────────────────────────────────────────────────────────── */

function safeS(size: number) {
  return Number.isFinite(size) && size > 0 ? size : 0.01;
}

function bodyMat(color: number, emissive: number) {
  return new THREE.MeshPhongMaterial({ color, emissive, shininess: 70, specular: 0x2f3b62 });
}

const darkMat  = () => new THREE.MeshPhongMaterial({ color: 0x222222, emissive: 0x111111, shininess: 40 });
const metalMat = () => new THREE.MeshPhongMaterial({ color: 0x888888, emissive: 0x222222, shininess: 90, specular: 0x999999 });
const ledGreen = () => new THREE.MeshPhongMaterial({ color: 0x00ff88, emissive: 0x00ff88, shininess: 100 });
const ledRed   = () => new THREE.MeshPhongMaterial({ color: 0xff2200, emissive: 0xff2200, shininess: 100 });
const ledAmber = () => new THREE.MeshPhongMaterial({ color: 0xffaa00, emissive: 0xffaa00, shininess: 100 });
const ledBlue  = () => new THREE.MeshPhongMaterial({ color: 0x2299ff, emissive: 0x2299ff, shininess: 100 });
const screenMat = () => new THREE.MeshPhongMaterial({ color: 0x00ddff, emissive: 0x00aacc, shininess: 60, transparent: true, opacity: 0.85 });

/* ─── SATELLITE ───────────────────────────────────────────────────────── */

export function createSatelliteObject(size: number, color: number, emissive: number): THREE.Object3D {
  const s = safeS(size);
  try {
    const g = new THREE.Group();
    const mat = bodyMat(color, emissive);

    const bodyLen = s * 0.9;
    const rTop = s * 0.22;
    const rBot = s * 0.16;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(rBot, rTop, bodyLen, 10), mat);
    g.add(body);

    const cap = new THREE.Mesh(new THREE.ConeGeometry(s * 0.17, s * 0.25, 10), mat);
    cap.position.y = bodyLen * 0.5 + s * 0.12;
    cap.rotation.x = Math.PI;
    g.add(cap);

    const panelMat = new THREE.MeshStandardMaterial({
      color: 0x9fe7ff, emissive, roughness: 0.35, metalness: 0.05, envMapIntensity: 0,
    });
    const panelGeo = new THREE.BoxGeometry(s * 1.1, s * 0.04, s * 0.55);
    for (const dx of [-1, 1]) {
      const p = new THREE.Mesh(panelGeo, panelMat);
      p.position.x = dx * rTop * 2.3;
      g.add(p);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(s * 1.12, s * 0.01, s * 0.57), metalMat());
      frame.position.x = dx * rTop * 2.3;
      g.add(frame);
    }

    const ant = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.03, s * 0.03, s * 1.2, 8), mat);
    ant.position.y = -bodyLen * 0.15;
    g.add(ant);

    const tip = new THREE.Mesh(new THREE.SphereGeometry(s * 0.06, 10, 10), mat);
    tip.position.y = ant.position.y - s * 0.66;
    g.add(tip);

    const dish = new THREE.Mesh(
      new THREE.SphereGeometry(s * 0.15, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      metalMat(),
    );
    dish.position.y = bodyLen * 0.5 + s * 0.3;
    dish.rotation.x = Math.PI;
    g.add(dish);

    const dishPole = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.015, s * 0.015, s * 0.12, 6), metalMat());
    dishPole.position.y = bodyLen * 0.5 + s * 0.36;
    g.add(dishPole);

    return g;
  } catch {
    return new THREE.Mesh(new THREE.SphereGeometry(s, 14, 14), bodyMat(color, emissive));
  }
}

/* ─── SERVER ──────────────────────────────────────────────────────────── */

export function createServerObject(size: number, color: number, emissive: number): THREE.Object3D {
  const s = safeS(size);
  const g = new THREE.Group();
  const mat = bodyMat(color, emissive);

  const body = new THREE.Mesh(new THREE.BoxGeometry(s * 0.7, s * 1.0, s * 0.5), mat);
  g.add(body);

  const base = new THREE.Mesh(new THREE.BoxGeometry(s * 0.8, s * 0.08, s * 0.6), mat);
  base.position.y = -s * 0.54;
  g.add(base);

  for (const dx of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(s * 0.02, s * 1.0, s * 0.02), metalMat());
    rail.position.set(dx * s * 0.36, 0, s * 0.24);
    g.add(rail);
    const railBack = new THREE.Mesh(new THREE.BoxGeometry(s * 0.02, s * 1.0, s * 0.02), metalMat());
    railBack.position.set(dx * s * 0.36, 0, -s * 0.24);
    g.add(railBack);
  }

  for (let i = 0; i < 6; i++) {
    const bay = new THREE.Mesh(new THREE.BoxGeometry(s * 0.08, s * 0.04, s * 0.01), darkMat());
    bay.position.set(-s * 0.2 + i * s * 0.08, s * 0.1, s * 0.26);
    g.add(bay);
    const indicator = new THREE.Mesh(new THREE.SphereGeometry(s * 0.015, 6, 6), i % 2 === 0 ? ledGreen() : ledAmber());
    indicator.position.set(-s * 0.2 + i * s * 0.08, s * 0.14, s * 0.26);
    g.add(indicator);
  }

  const display = new THREE.Mesh(new THREE.BoxGeometry(s * 0.3, s * 0.08, s * 0.01), screenMat());
  display.position.set(0, s * 0.32, s * 0.26);
  g.add(display);

  const fan = new THREE.Mesh(new THREE.TorusGeometry(s * 0.1, s * 0.02, 8, 16), metalMat());
  fan.position.set(0, 0, -s * 0.26);
  g.add(fan);
  const fanHub = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.03, s * 0.03, s * 0.02, 8), metalMat());
  fanHub.position.set(0, 0, -s * 0.26);
  fanHub.rotation.x = Math.PI / 2;
  g.add(fanHub);

  const psu = new THREE.Mesh(new THREE.BoxGeometry(s * 0.25, s * 0.12, s * 0.15), darkMat());
  psu.position.set(s * 0.2, -s * 0.38, -s * 0.1);
  g.add(psu);

  const led = new THREE.Mesh(new THREE.SphereGeometry(s * 0.025, 8, 8), ledGreen());
  led.position.set(s * 0.3, s * 0.42, s * 0.26);
  g.add(led);

  return g;
}

/* ─── BASE STATION ────────────────────────────────────────────────────── */

export function createBaseStationObject(size: number, color: number, emissive: number): THREE.Object3D {
  const s = safeS(size);
  const g = new THREE.Group();
  const mat = bodyMat(color, emissive);
  const pMat = new THREE.MeshPhongMaterial({ color: 0xcccccc, emissive: 0x333333, shininess: 50 });

  const tower = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.06, s * 0.1, s * 1.4, 8), mat);
  g.add(tower);

  const top = new THREE.Mesh(new THREE.ConeGeometry(s * 0.18, s * 0.3, 8), mat);
  top.position.y = s * 0.85;
  g.add(top);

  const angles = [-1, 0, 1];
  angles.forEach((dx, idx) => {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(s * 0.35, s * 0.15, s * 0.04), pMat);
    const angle = ((idx / angles.length) * Math.PI * 2) - Math.PI / 2;
    panel.position.set(Math.cos(angle) * s * 0.25, s * 0.45, Math.sin(angle) * s * 0.15);
    panel.rotation.y = angle;
    panel.rotation.z = dx * 0.15;
    g.add(panel);
  });

  const conduit = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.025, s * 0.025, s * 1.2, 6), metalMat());
  conduit.position.set(s * 0.12, -s * 0.1, 0);
  g.add(conduit);

  const cabinet = new THREE.Mesh(new THREE.BoxGeometry(s * 0.4, s * 0.35, s * 0.3), mat);
  cabinet.position.y = -s * 0.87;
  g.add(cabinet);

  const cabinetDoor = new THREE.Mesh(new THREE.BoxGeometry(s * 0.38, s * 0.33, s * 0.01), darkMat());
  cabinetDoor.position.set(0, -s * 0.87, s * 0.16);
  g.add(cabinetDoor);

  const cabinetLed = new THREE.Mesh(new THREE.SphereGeometry(s * 0.02, 6, 6), ledGreen());
  cabinetLed.position.set(s * 0.14, -s * 0.78, s * 0.17);
  g.add(cabinetLed);

  const warning = new THREE.Mesh(new THREE.SphereGeometry(s * 0.06, 8, 8), ledRed());
  warning.position.y = s * 1.05;
  g.add(warning);

  const baseFlange = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.18, s * 0.18, s * 0.04, 8), metalMat());
  baseFlange.position.y = -s * 1.05;
  g.add(baseFlange);

  for (const dz of [-1, 1]) {
    const brace = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.015, s * 0.015, s * 0.5, 6), metalMat());
    brace.position.set(0, -s * 0.45, dz * s * 0.08);
    brace.rotation.z = dz * 0.3;
    g.add(brace);
  }

  return g;
}

/* ─── SWITCH ──────────────────────────────────────────────────────────── */

export function createSwitchObject(size: number, color: number, emissive: number): THREE.Object3D {
  const s = safeS(size);
  const g = new THREE.Group();
  const mat = bodyMat(color, emissive);

  const body = new THREE.Mesh(new THREE.BoxGeometry(s * 1.0, s * 0.25, s * 0.6), mat);
  g.add(body);

  for (const dx of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.BoxGeometry(s * 0.12, s * 0.25, s * 0.04), metalMat());
    ear.position.set(dx * s * 0.56, 0, 0);
    g.add(ear);
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.02, s * 0.02, s * 0.05, 6), darkMat());
    hole.position.set(dx * s * 0.56, s * 0.06, 0);
    hole.rotation.z = Math.PI / 2;
    g.add(hole);
    const hole2 = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.02, s * 0.02, s * 0.05, 6), darkMat());
    hole2.position.set(dx * s * 0.56, -s * 0.06, 0);
    hole2.rotation.z = Math.PI / 2;
    g.add(hole2);
  }

  const portMat = darkMat();
  for (let i = 0; i < 8; i++) {
    const px = -s * 0.35 + i * s * 0.1;
    const port = new THREE.Mesh(new THREE.BoxGeometry(s * 0.07, s * 0.055, s * 0.05), portMat);
    port.position.set(px, -s * 0.02, s * 0.33);
    g.add(port);
    const led = new THREE.Mesh(new THREE.SphereGeometry(s * 0.015, 6, 6), i < 6 ? ledGreen() : ledAmber());
    led.position.set(px, s * 0.05, s * 0.33);
    g.add(led);
  }

  const powerPort = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.04, s * 0.04, s * 0.04, 8), darkMat());
  powerPort.position.set(s * 0.35, 0, -s * 0.33);
  powerPort.rotation.x = Math.PI / 2;
  g.add(powerPort);

  const uplinkPort = new THREE.Mesh(new THREE.BoxGeometry(s * 0.09, s * 0.07, s * 0.05), new THREE.MeshPhongMaterial({ color: 0x444488, emissive: 0x222244 }));
  uplinkPort.position.set(-s * 0.35, 0, -s * 0.33);
  g.add(uplinkPort);

  const label = new THREE.Mesh(new THREE.BoxGeometry(s * 0.3, s * 0.04, s * 0.01), screenMat());
  label.position.set(0, s * 0.1, s * 0.31);
  g.add(label);

  const powerLed = new THREE.Mesh(new THREE.SphereGeometry(s * 0.02, 6, 6), ledGreen());
  powerLed.position.set(s * 0.42, s * 0.08, s * 0.31);
  g.add(powerLed);

  return g;
}

/* ─── MULTIPLEXER ─────────────────────────────────────────────────────── */

export function createMultiplexerObject(size: number, color: number, emissive: number): THREE.Object3D {
  const s = safeS(size);
  const g = new THREE.Group();
  const mat = bodyMat(color, emissive);

  const body = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.3, s * 0.3, s * 0.7, 12), mat);
  g.add(body);

  const ringMat = new THREE.MeshPhongMaterial({ color: 0xffffff, emissive: 0x444466, shininess: 90 });
  for (const dy of [-0.2, 0, 0.2]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(s * 0.35, s * 0.03, 8, 20), ringMat);
    ring.position.y = s * dy;
    ring.rotation.x = Math.PI / 2;
    g.add(ring);
  }

  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2;
    const connector = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.04, s * 0.04, s * 0.1, 6), metalMat());
    connector.position.set(Math.cos(angle) * s * 0.3, s * 0.4, Math.sin(angle) * s * 0.3);
    g.add(connector);
  }

  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2 + 0.5;
    const out = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.04, s * 0.04, s * 0.1, 6), metalMat());
    out.position.set(Math.cos(angle) * s * 0.3, -s * 0.4, Math.sin(angle) * s * 0.3);
    g.add(out);
  }

  const display = new THREE.Mesh(new THREE.BoxGeometry(s * 0.2, s * 0.1, s * 0.01), screenMat());
  display.position.set(0, 0, s * 0.31);
  g.add(display);

  const flange = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.38, s * 0.38, s * 0.03, 12), metalMat());
  flange.position.y = -s * 0.36;
  g.add(flange);

  const topCap = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.28, s * 0.3, s * 0.04, 12), mat);
  topCap.position.y = s * 0.37;
  g.add(topCap);

  return g;
}

/* ─── PROVIDER ────────────────────────────────────────────────────────── */

export function createProviderObject(size: number, color: number, emissive: number): THREE.Object3D {
  const s = safeS(size);
  const g = new THREE.Group();
  const mat = bodyMat(color, emissive);

  const building = new THREE.Mesh(new THREE.BoxGeometry(s * 0.6, s * 0.5, s * 0.5), mat);
  building.position.y = -s * 0.25;
  g.add(building);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(s * 0.65, s * 0.04, s * 0.55), metalMat());
  roof.position.y = s * 0.02;
  g.add(roof);

  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(s * 0.08, s * 0.08, s * 0.01), screenMat());
      win.position.set(-s * 0.15 + c * s * 0.15, -s * 0.15 + r * s * 0.12, s * 0.26);
      g.add(win);
    }
  }

  const sphere = new THREE.Mesh(new THREE.SphereGeometry(s * 0.2, 14, 14), mat);
  sphere.position.y = s * 0.25;
  g.add(sphere);

  const ringMat = new THREE.MeshPhongMaterial({ color: 0xffffff, emissive: 0x556699, shininess: 90, transparent: true, opacity: 0.7 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(s * 0.3, s * 0.025, 8, 24), ringMat);
  ring.position.y = s * 0.25;
  ring.rotation.x = Math.PI / 2;
  g.add(ring);

  const dishBase = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.04, s * 0.04, s * 0.08, 6), metalMat());
  dishBase.position.set(s * 0.2, s * 0.06, -s * 0.15);
  g.add(dishBase);
  const dish = new THREE.Mesh(
    new THREE.SphereGeometry(s * 0.1, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    metalMat(),
  );
  dish.position.set(s * 0.2, s * 0.12, -s * 0.15);
  dish.rotation.x = -Math.PI / 4;
  g.add(dish);

  for (let i = 0; i < 3; i++) {
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.015, s * 0.015, s * 0.2, 6), metalMat());
    ant.position.set(-s * 0.15 + i * s * 0.15, s * 0.14, -s * 0.2);
    g.add(ant);
    const antTip = new THREE.Mesh(new THREE.SphereGeometry(s * 0.025, 6, 6), ledBlue());
    antTip.position.set(-s * 0.15 + i * s * 0.15, s * 0.25, -s * 0.2);
    g.add(antTip);
  }

  const door = new THREE.Mesh(new THREE.BoxGeometry(s * 0.12, s * 0.22, s * 0.01), darkMat());
  door.position.set(0, -s * 0.38, s * 0.26);
  g.add(door);

  return g;
}

/* ─── REGENERATOR ─────────────────────────────────────────────────────── */

export function createRegeneratorObject(size: number, color: number, emissive: number): THREE.Object3D {
  const s = safeS(size);
  const g = new THREE.Group();
  const mat = bodyMat(color, emissive);

  const rack = new THREE.Mesh(new THREE.BoxGeometry(s * 0.7, s * 0.9, s * 0.45), mat);
  g.add(rack);

  const ampModule = new THREE.Mesh(new THREE.BoxGeometry(s * 0.5, s * 0.2, s * 0.3), new THREE.MeshPhongMaterial({ color: 0x44aacc, emissive: 0x113344, shininess: 60 }));
  ampModule.position.y = s * 0.1;
  g.add(ampModule);

  for (const dx of [-1, 1]) {
    const port = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.04, s * 0.04, s * 0.12, 8), metalMat());
    port.position.set(dx * s * 0.4, s * 0.1, 0);
    port.rotation.z = Math.PI / 2;
    g.add(port);
    const portRing = new THREE.Mesh(new THREE.TorusGeometry(s * 0.05, s * 0.01, 6, 12), metalMat());
    portRing.position.set(dx * s * 0.42, s * 0.1, 0);
    portRing.rotation.y = Math.PI / 2;
    g.add(portRing);
  }

  const ledColors = [ledGreen(), ledAmber(), ledGreen(), ledBlue()];
  for (let i = 0; i < 4; i++) {
    const led = new THREE.Mesh(new THREE.SphereGeometry(s * 0.025, 6, 6), ledColors[i]);
    led.position.set(-s * 0.15 + i * s * 0.1, s * 0.35, s * 0.24);
    g.add(led);
  }

  for (let i = 0; i < 6; i++) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(s * 0.5, s * 0.01, s * 0.01), metalMat());
    slat.position.set(0, -s * 0.15 + i * s * 0.05, s * 0.24);
    g.add(slat);
  }

  for (const dx of [-1, 1]) {
    const bracket = new THREE.Mesh(new THREE.BoxGeometry(s * 0.04, s * 0.6, s * 0.08), metalMat());
    bracket.position.set(dx * s * 0.38, 0, -s * 0.18);
    g.add(bracket);
    const bracketFlange = new THREE.Mesh(new THREE.BoxGeometry(s * 0.08, s * 0.6, s * 0.02), metalMat());
    bracketFlange.position.set(dx * s * 0.4, 0, -s * 0.23);
    g.add(bracketFlange);
  }

  const faceplate = new THREE.Mesh(new THREE.BoxGeometry(s * 0.64, s * 0.04, s * 0.01), darkMat());
  faceplate.position.set(0, s * 0.43, s * 0.24);
  g.add(faceplate);

  const heatSink = new THREE.Mesh(new THREE.BoxGeometry(s * 0.3, s * 0.15, s * 0.05), metalMat());
  heatSink.position.set(0, -s * 0.25, -s * 0.25);
  g.add(heatSink);

  return g;
}

/* ─── MODEM ───────────────────────────────────────────────────────────── */

export function createModemObject(size: number, color: number, emissive: number): THREE.Object3D {
  const s = safeS(size);
  const g = new THREE.Group();
  const mat = bodyMat(color, emissive);

  const body = new THREE.Mesh(new THREE.BoxGeometry(s * 0.8, s * 0.18, s * 0.5), mat);
  g.add(body);

  const topCurve = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.25, s * 0.25, s * 0.8, 12, 1, false, 0, Math.PI), mat);
  topCurve.position.y = s * 0.09;
  topCurve.rotation.z = Math.PI / 2;
  topCurve.rotation.x = -Math.PI / 2;
  topCurve.scale.y = 0.3;
  g.add(topCurve);

  for (const dx of [-1, 1]) {
    const antBase = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.03, s * 0.035, s * 0.06, 6), metalMat());
    antBase.position.set(dx * s * 0.25, s * 0.14, -s * 0.15);
    g.add(antBase);
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.015, s * 0.02, s * 0.45, 6), metalMat());
    ant.position.set(dx * s * 0.25, s * 0.4, -s * 0.15);
    ant.rotation.z = dx * 0.2;
    g.add(ant);
    const antTip = new THREE.Mesh(new THREE.SphereGeometry(s * 0.03, 8, 8), metalMat());
    antTip.position.set(dx * s * 0.25 + dx * s * 0.09, s * 0.62, -s * 0.15);
    g.add(antTip);
  }

  const statusLeds = [ledGreen(), ledGreen(), ledAmber(), ledBlue(), ledRed()];
  for (let i = 0; i < 5; i++) {
    const led = new THREE.Mesh(new THREE.SphereGeometry(s * 0.02, 6, 6), statusLeds[i]);
    led.position.set(-s * 0.2 + i * s * 0.1, s * 0.05, s * 0.26);
    g.add(led);
  }

  for (let i = 0; i < 4; i++) {
    const ethPort = new THREE.Mesh(new THREE.BoxGeometry(s * 0.06, s * 0.05, s * 0.04), darkMat());
    ethPort.position.set(-s * 0.2 + i * s * 0.12, -s * 0.02, -s * 0.27);
    g.add(ethPort);
  }

  const powerConn = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.025, s * 0.025, s * 0.04, 8), darkMat());
  powerConn.position.set(s * 0.32, -s * 0.02, -s * 0.27);
  powerConn.rotation.x = Math.PI / 2;
  g.add(powerConn);

  const ventGrille = new THREE.Mesh(new THREE.BoxGeometry(s * 0.25, s * 0.01, s * 0.2), metalMat());
  ventGrille.position.y = s * 0.15;
  g.add(ventGrille);

  for (let i = 0; i < 4; i++) {
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.025, s * 0.025, s * 0.02, 6), darkMat());
    foot.position.set((i < 2 ? -1 : 1) * s * 0.3, -s * 0.1, (i % 2 === 0 ? -1 : 1) * s * 0.18);
    g.add(foot);
  }

  return g;
}

/* ─── EQUIPMENT (generic rack) ────────────────────────────────────────── */

export function createEquipmentObject(size: number, color: number, emissive: number): THREE.Object3D {
  const s = safeS(size);
  const g = new THREE.Group();
  const mat = bodyMat(color, emissive);

  const frame = new THREE.Mesh(new THREE.BoxGeometry(s * 0.6, s * 1.2, s * 0.5), mat);
  g.add(frame);

  for (const dx of [-1, 1]) {
    for (const dz of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(s * 0.03, s * 1.2, s * 0.03), metalMat());
      rail.position.set(dx * s * 0.29, 0, dz * s * 0.24);
      g.add(rail);
    }
  }

  for (let i = 0; i < 3; i++) {
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(s * 0.52, s * 0.22, s * 0.4), new THREE.MeshPhongMaterial({
      color: 0x445566, emissive: 0x112233, shininess: 50,
    }));
    shelf.position.y = -s * 0.3 + i * s * 0.35;
    g.add(shelf);

    const faceplate = new THREE.Mesh(new THREE.BoxGeometry(s * 0.52, s * 0.2, s * 0.01), darkMat());
    faceplate.position.set(0, -s * 0.3 + i * s * 0.35, s * 0.21);
    g.add(faceplate);

    for (let j = 0; j < 3; j++) {
      const led = new THREE.Mesh(new THREE.SphereGeometry(s * 0.015, 6, 6), j === 0 ? ledGreen() : j === 1 ? ledAmber() : ledBlue());
      led.position.set(-s * 0.15 + j * s * 0.12, -s * 0.22 + i * s * 0.35, s * 0.26);
      g.add(led);
    }
  }

  const cablePanel = new THREE.Mesh(new THREE.BoxGeometry(s * 0.06, s * 1.1, s * 0.35), metalMat());
  cablePanel.position.set(s * 0.34, 0, 0);
  g.add(cablePanel);

  const psu = new THREE.Mesh(new THREE.BoxGeometry(s * 0.5, s * 0.15, s * 0.35), darkMat());
  psu.position.y = -s * 0.52;
  g.add(psu);
  const psuLed = new THREE.Mesh(new THREE.SphereGeometry(s * 0.02, 6, 6), ledGreen());
  psuLed.position.set(-s * 0.18, -s * 0.44, s * 0.26);
  g.add(psuLed);

  for (let i = 0; i < 4; i++) {
    const ventSlot = new THREE.Mesh(new THREE.BoxGeometry(s * 0.4, s * 0.01, s * 0.01), metalMat());
    ventSlot.position.set(0, s * 0.5 + i * s * 0.03, s * 0.26);
    g.add(ventSlot);
  }

  return g;
}

/* ─── MESH RELAY ──────────────────────────────────────────────────────── */

export function createMeshRelayObject(size: number, color: number, emissive: number): THREE.Object3D {
  const s = safeS(size);
  const g = new THREE.Group();
  const mat = bodyMat(color, emissive);

  const core = new THREE.Mesh(new THREE.OctahedronGeometry(s * 0.25, 0), mat);
  g.add(core);

  const ringMat = new THREE.MeshPhongMaterial({ color: 0x00e5ff, emissive: 0x004455, transparent: true, opacity: 0.6 });
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(s * (0.35 + i * 0.1), s * 0.015, 8, 20), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = s * (i - 1) * 0.12;
    g.add(ring);
  }

  for (const dx of [-1, 1]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(s * 0.25, s * 0.15, s * 0.03), metalMat());
    panel.position.set(dx * s * 0.35, s * 0.1, 0);
    panel.rotation.y = dx * 0.4;
    panel.rotation.z = dx * -0.2;
    g.add(panel);
    const panelFace = new THREE.Mesh(new THREE.BoxGeometry(s * 0.2, s * 0.1, s * 0.01), darkMat());
    panelFace.position.set(dx * s * 0.35, s * 0.1, dx * 0.01 * s);
    panelFace.rotation.y = dx * 0.4;
    panelFace.rotation.z = dx * -0.2;
    g.add(panelFace);
  }

  const solar = new THREE.Mesh(new THREE.BoxGeometry(s * 0.4, s * 0.02, s * 0.25), new THREE.MeshPhongMaterial({
    color: 0x223366, emissive: 0x111133, shininess: 40,
  }));
  solar.position.set(0, s * 0.35, 0);
  solar.rotation.x = -0.3;
  g.add(solar);
  const solarFrame = new THREE.Mesh(new THREE.BoxGeometry(s * 0.42, s * 0.005, s * 0.27), metalMat());
  solarFrame.position.set(0, s * 0.36, 0);
  solarFrame.rotation.x = -0.3;
  g.add(solarFrame);

  const bracketV = new THREE.Mesh(new THREE.BoxGeometry(s * 0.04, s * 0.4, s * 0.04), metalMat());
  bracketV.position.set(0, -s * 0.3, 0);
  g.add(bracketV);
  const bracketH = new THREE.Mesh(new THREE.BoxGeometry(s * 0.25, s * 0.04, s * 0.04), metalMat());
  bracketH.position.set(0, -s * 0.5, 0);
  g.add(bracketH);

  const statusLed = new THREE.Mesh(new THREE.SphereGeometry(s * 0.03, 6, 6), ledGreen());
  statusLed.position.set(0, s * 0.15, s * 0.26);
  g.add(statusLed);

  return g;
}

/* ─── SMS GATEWAY ─────────────────────────────────────────────────────── */

export function createSmsGatewayObject(size: number, color: number, emissive: number): THREE.Object3D {
  const s = safeS(size);
  const g = new THREE.Group();
  const mat = bodyMat(color, emissive);

  const body = new THREE.Mesh(new THREE.BoxGeometry(s * 0.6, s * 0.8, s * 0.4), mat);
  g.add(body);

  const housing = new THREE.Mesh(new THREE.BoxGeometry(s * 0.68, s * 0.88, s * 0.48), new THREE.MeshPhongMaterial({
    color: 0xcccccc, emissive: 0x222222, transparent: true, opacity: 0.15, shininess: 100,
  }));
  g.add(housing);

  for (const dx of [-1, 1]) {
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.025, s * 0.03, s * 0.5, 6), metalMat());
    ant.position.set(dx * s * 0.18, s * 0.65, 0);
    ant.rotation.z = dx * 0.15;
    g.add(ant);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(s * 0.05, 8, 8), ledRed());
    tip.position.set(dx * s * 0.18 + dx * s * 0.075, s * 0.92, 0);
    g.add(tip);
  }

  for (let i = 0; i < 4; i++) {
    const led = new THREE.Mesh(new THREE.SphereGeometry(s * 0.02, 6, 6), i < 2 ? ledGreen() : ledAmber());
    led.position.set(-s * 0.15 + i * s * 0.1, s * 0.3, s * 0.21);
    g.add(led);
  }

  const simTray = new THREE.Mesh(new THREE.BoxGeometry(s * 0.15, s * 0.06, s * 0.01), new THREE.MeshPhongMaterial({ color: 0xffcc00, emissive: 0x665500 }));
  simTray.position.set(s * 0.31, s * 0.1, s * 0.0);
  g.add(simTray);

  const simSlot = new THREE.Mesh(new THREE.BoxGeometry(s * 0.12, s * 0.04, s * 0.01), darkMat());
  simSlot.position.set(s * 0.31, s * 0.1, s * 0.01);
  g.add(simSlot);

  const ethPort = new THREE.Mesh(new THREE.BoxGeometry(s * 0.08, s * 0.06, s * 0.04), darkMat());
  ethPort.position.set(-s * 0.15, -s * 0.2, -s * 0.22);
  g.add(ethPort);

  const powerConn = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.03, s * 0.03, s * 0.04, 8), darkMat());
  powerConn.position.set(s * 0.15, -s * 0.2, -s * 0.22);
  powerConn.rotation.x = Math.PI / 2;
  g.add(powerConn);

  const grille = new THREE.Mesh(new THREE.BoxGeometry(s * 0.4, s * 0.15, s * 0.01), metalMat());
  grille.position.set(0, -s * 0.25, s * 0.21);
  g.add(grille);

  const label = new THREE.Mesh(new THREE.BoxGeometry(s * 0.2, s * 0.06, s * 0.01), new THREE.MeshPhongMaterial({ color: 0xffffff, emissive: 0x666666 }));
  label.position.set(0, s * 0.15, s * 0.21);
  g.add(label);

  return g;
}

/* ─── VSAT TERMINAL ───────────────────────────────────────────────────── */

export function createVsatTerminalObject(size: number, color: number, emissive: number): THREE.Object3D {
  const s = safeS(size);
  const g = new THREE.Group();
  const mat = bodyMat(color, emissive);

  const dish = new THREE.Mesh(
    new THREE.SphereGeometry(s * 0.5, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    mat,
  );
  dish.rotation.x = -Math.PI / 4;
  g.add(dish);

  const dishRim = new THREE.Mesh(new THREE.TorusGeometry(s * 0.5, s * 0.02, 8, 24), mat);
  dishRim.rotation.x = -Math.PI / 4;
  g.add(dishRim);

  const armLength = s * 0.5;
  const feedArm = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.015, s * 0.015, armLength, 6), metalMat());
  feedArm.position.set(0, s * 0.2, s * 0.15);
  feedArm.rotation.x = -0.6;
  g.add(feedArm);

  const lnb = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.04, s * 0.03, s * 0.1, 8), metalMat());
  lnb.position.set(0, s * 0.42, s * 0.28);
  g.add(lnb);
  const lnbTip = new THREE.Mesh(new THREE.SphereGeometry(s * 0.04, 8, 8), new THREE.MeshPhongMaterial({ color: 0xdddddd, emissive: 0x333333 }));
  lnbTip.position.set(0, s * 0.48, s * 0.28);
  g.add(lnbTip);

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.04, s * 0.06, s * 0.7, 8), mat);
  pole.position.y = -s * 0.35;
  g.add(pole);

  const mountBase = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.25, s * 0.28, s * 0.06, 10), metalMat());
  mountBase.position.y = -s * 0.72;
  g.add(mountBase);

  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const bolt = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.02, s * 0.02, s * 0.03, 6), darkMat());
    bolt.position.set(Math.cos(angle) * s * 0.22, -s * 0.72, Math.sin(angle) * s * 0.22);
    g.add(bolt);
  }

  const cableConn = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.03, s * 0.03, s * 0.06, 8), darkMat());
  cableConn.position.set(s * 0.08, -s * 0.65, 0);
  cableConn.rotation.z = Math.PI / 2;
  g.add(cableConn);

  const statusLed = new THREE.Mesh(new THREE.SphereGeometry(s * 0.025, 6, 6), ledGreen());
  statusLed.position.set(-s * 0.06, -s * 0.15, s * 0.05);
  g.add(statusLed);

  return g;
}

/* ─── OFFLINE QUEUE ───────────────────────────────────────────────────── */

export function createOfflineQueueObject(size: number, color: number, emissive: number): THREE.Object3D {
  const s = safeS(size);
  const g = new THREE.Group();
  const mat = bodyMat(color, emissive);

  for (let i = 0; i < 3; i++) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(s * 0.5, s * 0.2, s * 0.4), mat);
    box.position.y = i * s * 0.25 - s * 0.25;
    g.add(box);

    const face = new THREE.Mesh(new THREE.BoxGeometry(s * 0.48, s * 0.18, s * 0.01), darkMat());
    face.position.set(0, i * s * 0.25 - s * 0.25, s * 0.21);
    g.add(face);
  }

  const display = new THREE.Mesh(new THREE.BoxGeometry(s * 0.3, s * 0.08, s * 0.01), screenMat());
  display.position.set(0, s * 0.32, s * 0.21);
  g.add(display);

  const battery = new THREE.Mesh(new THREE.BoxGeometry(s * 0.04, s * 0.15, s * 0.01), new THREE.MeshPhongMaterial({ color: 0x00cc44, emissive: 0x00aa33 }));
  battery.position.set(s * 0.26, s * 0.05, s * 0.21);
  g.add(battery);
  const batteryFrame = new THREE.Mesh(new THREE.BoxGeometry(s * 0.06, s * 0.2, s * 0.01), metalMat());
  batteryFrame.position.set(s * 0.26, s * 0.05, s * 0.215);
  g.add(batteryFrame);

  for (let i = 0; i < 2; i++) {
    const dataPort = new THREE.Mesh(new THREE.BoxGeometry(s * 0.08, s * 0.05, s * 0.03), darkMat());
    dataPort.position.set(-s * 0.12 + i * s * 0.16, -s * 0.35, s * 0.22);
    g.add(dataPort);
  }

  const powerLed = new THREE.Mesh(new THREE.SphereGeometry(s * 0.025, 6, 6), ledGreen());
  powerLed.position.set(s * 0.2, s * 0.32, s * 0.22);
  g.add(powerLed);

  const statusLed = new THREE.Mesh(new THREE.SphereGeometry(s * 0.025, 6, 6), ledAmber());
  statusLed.position.set(-s * 0.2, s * 0.32, s * 0.22);
  g.add(statusLed);

  for (let i = 0; i < 4; i++) {
    const ventSlat = new THREE.Mesh(new THREE.BoxGeometry(s * 0.35, s * 0.008, s * 0.01), metalMat());
    ventSlat.position.set(0, -s * 0.45 + i * s * 0.015, -s * 0.21);
    g.add(ventSlat);
  }

  const foot = new THREE.Mesh(new THREE.BoxGeometry(s * 0.55, s * 0.03, s * 0.45), metalMat());
  foot.position.y = -s * 0.51;
  g.add(foot);

  return g;
}

/* ─── factory maps & data exports ─────────────────────────────────────── */

export const EQUIPMENT_FACTORIES: Record<string, (size: number, color: number, emissive: number) => THREE.Object3D> = {
  SERVER: createServerObject,
  BASE_STATION: createBaseStationObject,
  SWITCH: createSwitchObject,
  MULTIPLEXER: createMultiplexerObject,
  DEMULTIPLEXER: createMultiplexerObject,
  PROVIDER: createProviderObject,
  REGENERATOR: createRegeneratorObject,
  REGENERATION_POINT: createRegeneratorObject,
  MODEM: createModemObject,
  EQUIPMENT: createEquipmentObject,
  MESH_RELAY: createMeshRelayObject,
  SMS_GATEWAY: createSmsGatewayObject,
  VSAT_TERMINAL: createVsatTerminalObject,
  OFFLINE_QUEUE: createOfflineQueueObject,
};

export const NODE_VISUALS: Record<string, { size: number; color: number; emissive: number }> = {
  PROVIDER: { size: 0.022, color: 0x7aa2ff, emissive: 0x103060 },
  SERVER: { size: 0.018, color: 0x3ddc97, emissive: 0x0f4a2e },
  SWITCH: { size: 0.014, color: 0xf6c177, emissive: 0x3b2b10 },
  MULTIPLEXER: { size: 0.012, color: 0xe6a7ff, emissive: 0x3a1456 },
  DEMULTIPLEXER: { size: 0.012, color: 0xb36cff, emissive: 0x1d0840 },
  REGENERATOR: { size: 0.016, color: 0x7df1ff, emissive: 0x08374a },
  REGENERATION_POINT: { size: 0.014, color: 0x7df1ff, emissive: 0x08374a },
  MODEM: { size: 0.010, color: 0xff7d7d, emissive: 0x3a0e0e },
  BASE_STATION: { size: 0.020, color: 0xffc3a0, emissive: 0x3a240f },
  SATELLITE: { size: 0.05, color: 0x9fe7ff, emissive: 0x0a2b3d },
  SATELLITE_RASSVET: { size: 0.05, color: 0x9fe7ff, emissive: 0x0a2b3d },
  EQUIPMENT: { size: 0.010, color: 0xffffff, emissive: 0x111133 },
  MESH_RELAY: { size: 0.016, color: 0x00e5ff, emissive: 0x073040 },
  SMS_GATEWAY: { size: 0.016, color: 0xffd740, emissive: 0x3a3010 },
  VSAT_TERMINAL: { size: 0.020, color: 0xb388ff, emissive: 0x2a1060 },
  OFFLINE_QUEUE: { size: 0.014, color: 0x69f0ae, emissive: 0x0a3a20 },
};

export const CABLE_COLORS: Record<string, string> = {
  CABLE_FIBER: '#3a7bd5',
  CABLE_COPPER: '#d4a54a',
  CABLE_UNDERGROUND_FIBER: '#00e676',
  CABLE_UNDERGROUND_COPPER: '#ff7043',
};

export const TYPE_LABELS_RU: Record<string, string> = {
  CABLE_UNDERGROUND_FIBER: 'Подземный оптоволоконный кабель',
  CABLE_UNDERGROUND_COPPER: 'Подземный медный кабель',
  CABLE_FIBER: 'Подводный оптоволоконный кабель',
  CABLE_COPPER: 'Подводный медный кабель',
  PROVIDER: 'Провайдер',
  SERVER: 'Сервер / Дата-центр',
  SWITCH: 'Коммутатор',
  MULTIPLEXER: 'Мультиплексор',
  DEMULTIPLEXER: 'Демультиплексор',
  REGENERATOR: 'Регенератор',
  REGENERATION_POINT: 'Точка регенерации',
  MODEM: 'Модем',
  BASE_STATION: 'Базовая станция',
  SATELLITE: 'Спутник',
  SATELLITE_RASSVET: 'Спутник (Рассвет)',
  EQUIPMENT: 'Оборудование',
  MESH_RELAY: 'Mesh-ретранслятор',
  SMS_GATEWAY: 'SMS-шлюз (2G)',
  VSAT_TERMINAL: 'VSAT-терминал',
  OFFLINE_QUEUE: 'Офлайн-очередь транзакций',
};
