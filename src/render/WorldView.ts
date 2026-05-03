import * as THREE from "three";
import { ASSETS, CORRIDOR, DOOR, PLAYER, ROOM, ROOM_CENTERS } from "../game/content/layout";
import type { GameState, RoomState } from "../game/simulation/state";

type TextureSet = {
  corridor: THREE.Texture;
  gameStyle1: THREE.Texture;
  gameStyle2: THREE.Texture;
  npc: THREE.Texture;
  player: THREE.Texture;
  object: THREE.Texture;
};

type ItemVisual = {
  group: THREE.Group;
  label: THREE.Mesh;
};

const PLAYER_PORTRAIT_WIDTH = 0.864;
const PLAYER_PORTRAIT_HEIGHT = 1.38;
const PLAYER_PORTRAIT_Y = PLAYER_PORTRAIT_HEIGHT / 2;
const PLAYER_SHADOW_WIDTH = 1.248;
const PLAYER_SHADOW_DEPTH = 0.648;
const NPC_STANDEE_WIDTH = 0.8;
const NPC_STANDEE_HEIGHT = 1.22;

export class WorldView {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(56, 1, 0.1, 80);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly textures: TextureSet;
  private readonly doorPivots = new Map<number, THREE.Group>();
  private readonly itemVisuals = new Map<number, ItemVisual>();
  private readonly billboardMeshes = new Set<THREE.Object3D>();
  private playerRig = new THREE.Group();
  private playerPortrait: THREE.Mesh | null = null;
  private playerShadow: THREE.Mesh | null = null;
  private npcGroup: THREE.Group | null = null;
  private renderedPlayerYaw = Math.PI;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      canvas,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.textures = this.loadTextures();

    window.addEventListener("resize", this.resize);
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      console.warn("WebGL context lost. Reload the page to restore the scene.");
    });
    this.resize();
  }

  rebuild(state: GameState): void {
    this.scene.clear();
    this.doorPivots.clear();
    this.itemVisuals.clear();
    this.billboardMeshes.clear();
    this.playerPortrait = null;
    this.playerShadow = null;
    this.npcGroup = null;
    this.renderedPlayerYaw = state.player.yaw;

    this.scene.background = new THREE.Color("#ffd65a");
    this.scene.fog = new THREE.Fog("#ffd65a", 20, 42);

    this.createLights();
    this.createCircusWorld(state);
    this.createPlayer();
    this.sync(state, 0);
  }

  sync(state: GameState, deltaSeconds: number): void {
    const player = state.player;
    this.renderedPlayerYaw = dampAngle(this.renderedPlayerYaw, player.yaw, 12, deltaSeconds);
    this.playerRig.position.set(player.position.x, 0, player.position.z);
    this.playerRig.rotation.y = this.renderedPlayerYaw;

    if (this.playerPortrait) {
      this.playerPortrait.position.set(player.position.x, PLAYER_PORTRAIT_Y, player.position.z + 0.02);
    }

    if (this.playerShadow) {
      this.playerShadow.position.set(player.position.x, 0.012, player.position.z + 0.22);
      this.playerShadow.rotation.z = -this.renderedPlayerYaw * 0.08;
    }

    for (const room of state.rooms) {
      const pivot = this.doorPivots.get(room.id);

      if (pivot) {
        const targetRotation = room.doorOpen ? -Math.PI * 0.54 : 0;
        pivot.rotation.y = damp(pivot.rotation.y, targetRotation, 10, deltaSeconds);
      }

      const item = this.itemVisuals.get(room.id);

      if (item) {
        item.group.visible = state.status === "playing" && room.doorOpen && !room.itemCollected;
        item.group.rotation.y += deltaSeconds * 1.8;
        item.group.position.y = 0.66 + Math.sin(performance.now() * 0.004 + room.id) * 0.08;
      }
    }

    if (this.npcGroup) {
      this.npcGroup.visible = state.npc.status === "chasing" && state.status !== "won";
      this.npcGroup.position.set(state.npc.position.x, 0, state.npc.position.z);
    }

    this.updateCamera(state, deltaSeconds);
    this.faceBillboards();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private readonly resize = (): void => {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };

  private loadTextures(): TextureSet {
    const loader = new THREE.TextureLoader();

    return {
      corridor: this.prepareTexture(loader.load(ASSETS.corridor)),
      gameStyle1: this.prepareTexture(loader.load(ASSETS.gameStyle1)),
      gameStyle2: this.prepareTexture(loader.load(ASSETS.gameStyle2)),
      npc: this.prepareTexture(loader.load(ASSETS.npc)),
      player: this.prepareTexture(loader.load(ASSETS.player)),
      object: this.prepareTexture(loader.load(ASSETS.object)),
    };
  }

  private prepareTexture(texture: THREE.Texture): THREE.Texture {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    return texture;
  }

  private createLights(): void {
    const hemi = new THREE.HemisphereLight("#fff5bd", "#6a35a7", 1.65);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight("#fff7d2", 2.2);
    key.position.set(-6, 11, 7);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 34;
    key.shadow.camera.left = -18;
    key.shadow.camera.right = 18;
    key.shadow.camera.top = 16;
    key.shadow.camera.bottom = -16;
    this.scene.add(key);

    const fill = new THREE.PointLight("#35f0e0", 1.4, 18);
    fill.position.set(0, 3.2, 3.5);
    this.scene.add(fill);
  }

  private createCircusWorld(state: GameState): void {
    const floorTexture = createCircusFloorTexture();
    const roomTexture = createRoomFloorTexture();
    const stripeMaterial = new THREE.MeshStandardMaterial({
      map: floorTexture,
      roughness: 0.66,
      metalness: 0.02,
    });
    const roomFloorMaterial = new THREE.MeshStandardMaterial({
      map: roomTexture,
      roughness: 0.74,
      metalness: 0.02,
    });
    const wallMaterialA = new THREE.MeshStandardMaterial({ color: "#ff5a71", roughness: 0.68 });
    const wallMaterialB = new THREE.MeshStandardMaterial({ color: "#ffe15d", roughness: 0.7 });
    const wallMaterialC = new THREE.MeshStandardMaterial({ color: "#25cfc0", roughness: 0.72 });

    const corridorFloor = createBox(
      CORRIDOR.maxX - CORRIDOR.minX,
      0.12,
      CORRIDOR.maxZ - CORRIDOR.minZ,
      stripeMaterial,
    );
    corridorFloor.position.set(0, -0.06, (CORRIDOR.minZ + CORRIDOR.maxZ) / 2);
    corridorFloor.receiveShadow = true;
    this.scene.add(corridorFloor);

    this.createCorridorWalls(wallMaterialA, wallMaterialB, wallMaterialC);
    this.createStylePosters();
    this.createBuntingLine(-10.5, 10.5, 2.78, 4.96);
    this.createDoorWallSegments(wallMaterialC);

    for (const room of state.rooms) {
      this.createRoom(room, roomFloorMaterial);
      this.createDoor(room);

      if (room.hasItem && !room.isDanger) {
        this.createItem(room);
      }
    }

    this.createNpc(state);
  }

  private createCorridorWalls(
    wallMaterialA: THREE.Material,
    wallMaterialB: THREE.Material,
    wallMaterialC: THREE.Material,
  ): void {
    const leftWall = createBox(0.3, 2.9, CORRIDOR.maxZ - CORRIDOR.minZ + 0.3, wallMaterialA);
    leftWall.position.set(CORRIDOR.minX - 0.15, 1.38, (CORRIDOR.minZ + CORRIDOR.maxZ) / 2);
    leftWall.receiveShadow = true;
    leftWall.castShadow = true;
    this.scene.add(leftWall);

    const rightWall = createBox(0.3, 2.9, CORRIDOR.maxZ - CORRIDOR.minZ + 0.3, wallMaterialB);
    rightWall.position.set(CORRIDOR.maxX + 0.15, 1.38, (CORRIDOR.minZ + CORRIDOR.maxZ) / 2);
    rightWall.receiveShadow = true;
    rightWall.castShadow = true;
    this.scene.add(rightWall);

    this.addCircusPole(CORRIDOR.minX + 0.72, CORRIDOR.maxZ - 0.75);
    this.addCircusPole(CORRIDOR.maxX - 0.72, CORRIDOR.maxZ - 0.75);
  }

  private createDoorWallSegments(material: THREE.Material): void {
    const doorHalf = DOOR.width / 2;
    let cursor = CORRIDOR.minX;

    for (const centerX of ROOM_CENTERS) {
      const segmentEnd = centerX - doorHalf;
      this.addDoorWallSegment(cursor, segmentEnd, material);
      cursor = centerX + doorHalf;
    }

    this.addDoorWallSegment(cursor, CORRIDOR.maxX, material);
  }

  private addDoorWallSegment(startX: number, endX: number, material: THREE.Material): void {
    const width = endX - startX;

    if (width <= 0.08) {
      return;
    }

    const segment = createBox(width, 2.9, 0.3, material);
    segment.position.set((startX + endX) / 2, 1.38, DOOR.z - 0.17);
    segment.castShadow = true;
    segment.receiveShadow = true;
    this.scene.add(segment);
  }

  private createRoom(room: RoomState, floorMaterial: THREE.Material): void {
    const roomColor = ["#35d6c9", "#ffcf45", "#ff6f8a", "#81e25b", "#8b68f3"][room.id];
    const wallMaterial = new THREE.MeshStandardMaterial({ color: roomColor, roughness: 0.72 });
    const trimMaterial = new THREE.MeshStandardMaterial({ color: "#fff0b9", roughness: 0.58 });
    const roomCenterZ = (ROOM.minZ + ROOM.maxZ) / 2;
    const sideWallFrontZ = DOOR.z - 0.48;
    const sideWallDepth = sideWallFrontZ - ROOM.minZ;
    const sideWallCenterZ = (ROOM.minZ + sideWallFrontZ) / 2;

    const floor = createBox(ROOM.width, 0.1, ROOM.depth, floorMaterial);
    floor.position.set(room.centerX, -0.05, roomCenterZ);
    floor.receiveShadow = true;
    this.scene.add(floor);

    const leftWall = createBox(0.22, 2.45, sideWallDepth, wallMaterial);
    leftWall.position.set(room.centerX - ROOM.width / 2 - 0.11, 1.2, sideWallCenterZ);
    leftWall.castShadow = true;
    leftWall.receiveShadow = true;
    this.scene.add(leftWall);

    const rightWall = leftWall.clone();
    rightWall.position.x = room.centerX + ROOM.width / 2 + 0.11;
    this.scene.add(rightWall);

    const backWall = createBox(ROOM.width + 0.44, 2.45, 0.22, wallMaterial);
    backWall.position.set(room.centerX, 1.2, ROOM.minZ - 0.11);
    backWall.castShadow = true;
    backWall.receiveShadow = true;
    this.scene.add(backWall);

    const rail = createBox(ROOM.width + 0.6, 0.18, 0.18, trimMaterial);
    rail.position.set(room.centerX, 2.46, ROOM.minZ - 0.01);
    this.scene.add(rail);

    const posterTexture = room.id % 2 === 0 ? this.textures.gameStyle1 : this.textures.gameStyle2;
    const poster = createPoster(posterTexture, 1.85, 1.08, "#25152f", "#fff4d8");
    poster.position.set(room.centerX, 1.28, ROOM.minZ + 0.03);
    this.scene.add(poster);

    this.createBuntingLine(room.centerX - 1.38, room.centerX + 1.38, 2.25, ROOM.minZ + 0.34);
  }

  private createDoor(room: RoomState): void {
    const pivot = new THREE.Group();
    pivot.position.set(room.centerX - DOOR.width / 2, 0, DOOR.z);

    const palette = [
      ["#ef4056", "#ffcb3d"],
      ["#22c7b8", "#ffeffa"],
      ["#7b49d6", "#ffcb3d"],
      ["#3a7bff", "#fff4d8"],
      ["#f56d3a", "#22c7b8"],
    ][room.id];
    const doorTexture = createDoorTexture(String(room.id + 1), palette[0], palette[1]);
    const doorMaterial = new THREE.MeshStandardMaterial({
      map: doorTexture,
      roughness: 0.54,
      metalness: 0.04,
    });
    const door = createBox(DOOR.width, 2.35, 0.18, doorMaterial);
    door.position.set(DOOR.width / 2, 1.18, 0);
    door.castShadow = true;
    door.receiveShadow = true;
    pivot.add(door);

    const knobMaterial = new THREE.MeshStandardMaterial({ color: "#ffe66d", metalness: 0.2, roughness: 0.36 });
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.09, 18, 12), knobMaterial);
    knob.position.set(DOOR.width * 0.82, 1.1, 0.13);
    knob.castShadow = true;
    pivot.add(knob);

    const arch = new THREE.Mesh(
      new THREE.TorusGeometry(DOOR.width / 2, 0.055, 10, 28, Math.PI),
      new THREE.MeshStandardMaterial({ color: "#fff1be", roughness: 0.42 }),
    );
    arch.position.set(DOOR.width / 2, 2.37, 0.02);
    arch.rotation.z = Math.PI;
    pivot.add(arch);

    this.scene.add(pivot);
    this.doorPivots.set(room.id, pivot);
  }

  private createItem(room: RoomState): void {
    const group = new THREE.Group();
    group.position.set(room.itemPosition.x, 0.66, room.itemPosition.z);

    const coreMaterial = new THREE.MeshStandardMaterial({
      color: "#ffcb3d",
      metalness: 0.16,
      roughness: 0.32,
      emissive: "#6d3d00",
      emissiveIntensity: 0.09,
    });
    const torus = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.085, 14, 32), coreMaterial);
    torus.rotation.x = Math.PI / 2;
    torus.castShadow = true;
    group.add(torus);

    const center = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 1), coreMaterial);
    center.castShadow = true;
    group.add(center);

    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(0.82, 0.82),
      new THREE.MeshBasicMaterial({ map: this.textures.object, side: THREE.DoubleSide }),
    );
    label.position.set(0, 0.48, 0);
    group.add(label);

    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(0.6, 0.018, 8, 42),
      new THREE.MeshBasicMaterial({ color: "#fff4d8", transparent: true, opacity: 0.62 }),
    );
    halo.rotation.x = Math.PI / 2;
    group.add(halo);

    group.visible = false;
    this.scene.add(group);
    this.itemVisuals.set(room.id, { group, label });
    this.billboardMeshes.add(label);
  }

  private createNpc(state: GameState): void {
    const dangerRoom = state.rooms.find((room) => room.isDanger);

    if (!dangerRoom) {
      return;
    }

    const group = new THREE.Group();
    group.position.set(state.npc.position.x, 0, state.npc.position.z);

    const platform = new THREE.Mesh(
      new THREE.CylinderGeometry(0.34, 0.44, 0.12, 24),
      new THREE.MeshStandardMaterial({ color: "#ef4056", roughness: 0.45 }),
    );
    platform.position.y = 0.06;
    platform.castShadow = true;
    platform.receiveShadow = true;
    group.add(platform);

    const standee = new THREE.Mesh(
      new THREE.PlaneGeometry(NPC_STANDEE_WIDTH, NPC_STANDEE_HEIGHT),
      new THREE.MeshBasicMaterial({ map: this.textures.npc, side: THREE.DoubleSide }),
    );
    standee.position.y = 0.72;
    group.add(standee);

    group.visible = false;
    this.scene.add(group);
    this.npcGroup = group;
    this.billboardMeshes.add(standee);
  }

  private createPlayer(): void {
    this.playerRig = new THREE.Group();
    this.scene.add(this.playerRig);

    const shadowTexture = createBlobShadowTexture();
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(PLAYER_SHADOW_WIDTH, PLAYER_SHADOW_DEPTH),
      new THREE.MeshBasicMaterial({
        map: shadowTexture,
        transparent: true,
        opacity: 0.68,
        depthWrite: false,
      }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.renderOrder = 1;
    this.scene.add(shadow);
    this.playerShadow = shadow;

    const portrait = new THREE.Mesh(
      new THREE.PlaneGeometry(PLAYER_PORTRAIT_WIDTH, PLAYER_PORTRAIT_HEIGHT),
      new THREE.MeshBasicMaterial({
        map: this.textures.player,
        side: THREE.DoubleSide,
        transparent: true,
        alphaTest: 0.04,
        depthWrite: false,
      }),
    );
    portrait.position.y = PLAYER_PORTRAIT_Y;
    this.scene.add(portrait);
    this.playerPortrait = portrait;
    this.billboardMeshes.add(portrait);
  }

  private createStylePosters(): void {
    const leftPoster = createPoster(this.textures.corridor, 2.8, 1.6, "#25152f", "#ffcb3d");
    leftPoster.position.set(CORRIDOR.minX + 0.22, 1.48, 1.85);
    leftPoster.rotation.y = Math.PI / 2;
    this.scene.add(leftPoster);

    const rightPoster = createPoster(this.textures.gameStyle2, 2.8, 1.56, "#25152f", "#22c7b8");
    rightPoster.position.set(CORRIDOR.maxX - 0.22, 1.48, 1.4);
    rightPoster.rotation.y = -Math.PI / 2;
    this.scene.add(rightPoster);

  }

  private createBuntingLine(startX: number, endX: number, y: number, z: number): void {
    const colors = ["#ef4056", "#ffcb3d", "#22c7b8", "#3a7bff", "#7b49d6"];
    const flags = Math.max(3, Math.floor((endX - startX) / 0.62));

    for (let index = 0; index <= flags; index += 1) {
      const x = startX + ((endX - startX) * index) / flags;
      const flag = createTriangleFlag(colors[index % colors.length]);
      flag.position.set(x, y + Math.sin(index * 0.9) * 0.08, z);
      this.scene.add(flag);
    }
  }

  private addCircusPole(x: number, z: number): void {
    const pole = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ color: "#fff4d8", roughness: 0.5 });
    const accent = new THREE.MeshStandardMaterial({ color: "#ef4056", roughness: 0.5 });
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.85, 20), material);
    core.position.y = 1.42;
    core.castShadow = true;
    pole.add(core);

    for (let index = 0; index < 4; index += 1) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.122, 0.02, 8, 20), accent);
      band.position.y = 0.5 + index * 0.62;
      band.rotation.x = Math.PI / 2;
      pole.add(band);
    }

    pole.position.set(x, 0, z);
    this.scene.add(pole);
  }

  private updateCamera(state: GameState, deltaSeconds: number): void {
    const { position } = state.player;
    const mobile = window.innerWidth < 760;
    const target = new THREE.Vector3(position.x, 1.05, position.z - (mobile ? 0.85 : 0.65));
    const desired = new THREE.Vector3(
      position.x,
      mobile ? 5.95 : 5.2,
      position.z + (mobile ? 6.45 : 6.7),
    );

    if (deltaSeconds <= 0) {
      this.camera.position.copy(desired);
    } else {
      this.camera.position.lerp(desired, 1 - Math.exp(-deltaSeconds * 5.5));
    }

    this.camera.lookAt(target);
  }

  private faceBillboards(): void {
    for (const billboard of this.billboardMeshes) {
      billboard.lookAt(this.camera.position.x, billboard.position.y, this.camera.position.z);
      billboard.rotateY(Math.PI);
    }
  }
}

function createBox(width: number, height: number, depth: number, material: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
}

function createPoster(
  texture: THREE.Texture,
  width: number,
  height: number,
  frameColor: string,
  trimColor: string,
): THREE.Group {
  const group = new THREE.Group();
  const frame = createBox(width + 0.18, height + 0.18, 0.08, new THREE.MeshStandardMaterial({ color: frameColor }));
  frame.castShadow = true;
  group.add(frame);

  const trim = createBox(width + 0.05, height + 0.05, 0.04, new THREE.MeshStandardMaterial({ color: trimColor }));
  trim.position.z = 0.045;
  group.add(trim);

  const image = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }),
  );
  image.position.z = 0.075;
  group.add(image);

  return group;
}

function createTriangleFlag(color: string): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(-0.2, 0.18);
  shape.lineTo(0.2, 0.18);
  shape.lineTo(0, -0.24);
  shape.lineTo(-0.2, 0.18);

  const flag = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }),
  );
  flag.rotation.x = 0;
  return flag;
}

function createCircusFloorTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Canvas 2D context is unavailable");
  }

  context.fillStyle = "#fff4d8";
  context.fillRect(0, 0, canvas.width, canvas.height);

  for (let index = -8; index < 16; index += 1) {
    context.fillStyle = index % 2 === 0 ? "#ef4056" : "#ffcb3d";
    context.beginPath();
    context.moveTo(index * 64, 0);
    context.lineTo(index * 64 + 96, 0);
    context.lineTo(index * 64 + 480, canvas.height);
    context.lineTo(index * 64 + 384, canvas.height);
    context.closePath();
    context.fill();
  }

  context.fillStyle = "rgba(34, 199, 184, 0.26)";
  for (let y = 38; y < canvas.height; y += 96) {
    context.fillRect(0, y, canvas.width, 18);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 2);
  return texture;
}

function createRoomFloorTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Canvas 2D context is unavailable");
  }

  context.fillStyle = "#22c7b8";
  context.fillRect(0, 0, 256, 256);
  context.fillStyle = "#fff4d8";
  for (let x = 0; x < 256; x += 64) {
    for (let y = 0; y < 256; y += 64) {
      if ((x + y) % 128 === 0) {
        context.fillRect(x, y, 64, 64);
      }
    }
  }
  context.strokeStyle = "rgba(37, 21, 47, 0.22)";
  context.lineWidth = 4;
  for (let x = 0; x <= 256; x += 64) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, 256);
    context.stroke();
  }
  for (let y = 0; y <= 256; y += 64) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(256, y);
    context.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 3);
  return texture;
}

function createBlobShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Canvas 2D context is unavailable");
  }

  const gradient = context.createRadialGradient(128, 64, 8, 128, 64, 112);
  gradient.addColorStop(0, "rgba(37, 21, 47, 0.5)");
  gradient.addColorStop(0.42, "rgba(37, 21, 47, 0.26)");
  gradient.addColorStop(1, "rgba(37, 21, 47, 0)");

  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createDoorTexture(label: string, colorA: string, colorB: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 512;
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Canvas 2D context is unavailable");
  }

  context.fillStyle = colorA;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = colorB;
  for (let x = -160; x < canvas.width + 160; x += 76) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x + 38, 0);
    context.lineTo(x + 198, canvas.height);
    context.lineTo(x + 160, canvas.height);
    context.closePath();
    context.fill();
  }

  context.fillStyle = "#fff4d8";
  context.beginPath();
  context.roundRect(70, 42, 116, 96, 20);
  context.fill();
  context.strokeStyle = "#25152f";
  context.lineWidth = 8;
  context.stroke();
  context.fillStyle = "#25152f";
  context.font = "900 72px Arial";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, 128, 91);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function damp(current: number, target: number, smoothing: number, deltaSeconds: number): number {
  if (deltaSeconds <= 0) {
    return target;
  }

  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-smoothing * deltaSeconds));
}

function dampAngle(current: number, target: number, smoothing: number, deltaSeconds: number): number {
  if (deltaSeconds <= 0) {
    return target;
  }

  const delta = THREE.MathUtils.euclideanModulo(target - current + Math.PI, Math.PI * 2) - Math.PI;
  return current + delta * (1 - Math.exp(-smoothing * deltaSeconds));
}
