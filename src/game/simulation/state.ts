import { CORRIDOR, DOOR, PASSAGE, PLAYER, ROOM, ROOM_CENTERS } from "../content/layout";

export type GameStatus = "playing" | "won" | "lost";

export type Vec2 = {
  x: number;
  z: number;
};

export type PlayerState = {
  position: Vec2;
  facing: Vec2;
  yaw: number;
};

export type RoomState = {
  id: number;
  centerX: number;
  doorOpen: boolean;
  isDanger: boolean;
  hasItem: boolean;
  itemCollected: boolean;
  itemPosition: Vec2;
};

export type NpcState = {
  status: "hidden" | "chasing" | "escaped";
  roomId: number;
  position: Vec2;
};

export type InteractionPrompt = {
  kind: "door" | "item" | "npc";
  roomId: number | null;
  text: string;
};

export type GameState = {
  status: GameStatus;
  rooms: RoomState[];
  collected: number;
  player: PlayerState;
  npc: NpcState;
  resultTitle: string;
  resultBody: string;
};

const ITEM_OFFSETS: Vec2[] = [
  { x: -0.75, z: -1.35 },
  { x: 0.82, z: -2.28 },
  { x: -0.12, z: -3.45 },
  { x: 0.66, z: -4.42 },
  { x: -0.64, z: -2.96 },
];
const NPC_SPEED = PLAYER.speed / 3;
const NPC_CATCH_DISTANCE = 0.58;
const NPC_RADIUS = 0.24;

type NavigationRegion = { kind: "corridor" } | { kind: "room"; room: RoomState } | { kind: "unknown" };

export function createGameState(): GameState {
  const dangerId = Math.floor(Math.random() * ROOM_CENTERS.length);
  const safeRoomIds = shuffle(ROOM_CENTERS.map((_, id) => id).filter((id) => id !== dangerId));
  const itemRoomIds = new Set(safeRoomIds.slice(0, 3));
  const offsetOrder = shuffle([...ITEM_OFFSETS]);

  const rooms: RoomState[] = ROOM_CENTERS.map((centerX, id) => {
    const offset = offsetOrder[id % offsetOrder.length];

    return {
      id,
      centerX,
      doorOpen: false,
      isDanger: id === dangerId,
      hasItem: itemRoomIds.has(id),
      itemCollected: false,
      itemPosition: {
        x: centerX + offset.x,
        z: ROOM.minZ + Math.abs(offset.z),
      },
    };
  });

  return {
    status: "playing",
    rooms,
    collected: 0,
    player: {
      position: { x: PLAYER.startX, z: PLAYER.startZ },
      facing: { x: 0, z: -1 },
      yaw: Math.PI,
    },
    npc: {
      status: "hidden",
      roomId: dangerId,
      position: getNpcStartPosition(rooms[dangerId]),
    },
    resultTitle: "",
    resultBody: "",
  };
}

export function movePlayer(state: GameState, input: Vec2, deltaSeconds: number): void {
  if (state.status !== "playing") {
    return;
  }

  const magnitude = Math.hypot(input.x, input.z);

  if (magnitude < 0.01) {
    return;
  }

  const direction = {
    x: input.x / magnitude,
    z: input.z / magnitude,
  };
  const step = PLAYER.speed * deltaSeconds;
  const current = state.player.position;
  const next = {
    x: current.x + direction.x * step,
    z: current.z + direction.z * step,
  };

  if (isWalkable(state, next.x, next.z)) {
    current.x = next.x;
    current.z = next.z;
  } else if (isWalkable(state, next.x, current.z)) {
    current.x = next.x;
  } else if (isWalkable(state, current.x, next.z)) {
    current.z = next.z;
  }

  state.player.facing = direction;
  state.player.yaw = Math.atan2(direction.x, direction.z);
}

export function tryOpenDoor(state: GameState): boolean {
  if (state.status !== "playing") {
    return false;
  }

  const room = getNearestClosedDoor(state);

  if (!room) {
    return false;
  }

  room.doorOpen = true;

  if (room.isDanger && state.npc.status === "hidden") {
    state.npc.status = "chasing";
    state.npc.position = getNpcStartPosition(room);
  }

  return true;
}

export function updateNpcChase(state: GameState, deltaSeconds: number): void {
  if (state.status !== "playing" || state.npc.status !== "chasing") {
    return;
  }

  if (isPlayerInNeighborRoom(state)) {
    state.npc.status = "escaped";
    return;
  }

  const distance = distanceTo(state.npc.position, state.player.position);

  if (distance <= NPC_CATCH_DISTANCE && hasClearNpcLine(state, state.npc.position, state.player.position)) {
    loseToNpc(state);
    return;
  }

  moveNpcToward(state, getNpcNavigationTarget(state), deltaSeconds);

  if (
    distanceTo(state.npc.position, state.player.position) <= NPC_CATCH_DISTANCE &&
    hasClearNpcLine(state, state.npc.position, state.player.position)
  ) {
    loseToNpc(state);
  }
}

export function tryCollectItem(state: GameState): boolean {
  if (state.status !== "playing") {
    return false;
  }

  const room = getNearestCollectableItem(state);

  if (!room) {
    return false;
  }

  room.itemCollected = true;
  state.collected += 1;

  if (state.collected >= 3) {
    state.status = "won";
    state.resultTitle = "Победа";
    state.resultBody = "Все три запчасти лежат в коробке. Цирковая машина снова готова к запуску.";
  }

  return true;
}

export function getPrompt(state: GameState): InteractionPrompt | null {
  if (state.status !== "playing") {
    return null;
  }

  if (state.npc.status === "chasing") {
    return {
      kind: "npc",
      roomId: state.npc.roomId,
      text: "NPC идет за вами: зайдите в соседнюю комнату",
    };
  }

  const itemRoom = getNearestCollectableItem(state);

  if (itemRoom) {
    return {
      kind: "item",
      roomId: itemRoom.id,
      text: "Запчасть рядом: Взять или F",
    };
  }

  const doorRoom = getNearestClosedDoor(state);

  if (doorRoom) {
    return {
      kind: "door",
      roomId: doorRoom.id,
      text: "Дверь рядом: Дверь или E",
    };
  }

  return null;
}

function isPlayerInNeighborRoom(state: GameState): boolean {
  return state.rooms.some((room) => {
    if (Math.abs(room.id - state.npc.roomId) !== 1 || !room.doorOpen || room.isDanger) {
      return false;
    }

    const roomMinX = room.centerX - ROOM.width / 2;
    const roomMaxX = room.centerX + ROOM.width / 2;

    return insideRect(state.player.position.x, state.player.position.z, roomMinX, roomMaxX, ROOM.minZ, ROOM.maxZ, 0);
  });
}

function loseToNpc(state: GameState): void {
  state.status = "lost";
  state.resultTitle = "Проигрыш";
  state.resultBody = "NPC догнал главного персонажа.";
}

function getNpcStartPosition(room: RoomState): Vec2 {
  return {
    x: room.centerX,
    z: ROOM.minZ + 2.08,
  };
}

function getNpcNavigationTarget(state: GameState): Vec2 {
  const npcRegion = getNpcRegion(state, state.npc.position);
  const playerRegion = getNpcRegion(state, state.player.position);

  if (npcRegion.kind === "room") {
    if (playerRegion.kind === "room" && playerRegion.room.id === npcRegion.room.id) {
      return state.player.position;
    }

    const doorLane = getDoorLanePoint(npcRegion.room);

    if (state.npc.position.z < PASSAGE.minZ + 0.16) {
      return {
        x: doorLane.x,
        z: PASSAGE.minZ + 0.16,
      };
    }

    return {
      x: doorLane.x,
      z: PASSAGE.maxZ - 0.08,
    };
  }

  if (playerRegion.kind === "room") {
    const doorLane = getDoorLanePoint(playerRegion.room);
    const corridorDoorPoint = {
      x: doorLane.x,
      z: PASSAGE.maxZ - 0.08,
    };

    if (distanceTo(state.npc.position, corridorDoorPoint) > 0.24) {
      return corridorDoorPoint;
    }

    return {
      x: doorLane.x,
      z: PASSAGE.minZ - 0.16,
    };
  }

  return state.player.position;
}

function moveNpcToward(state: GameState, target: Vec2, deltaSeconds: number): void {
  const toTarget = {
    x: target.x - state.npc.position.x,
    z: target.z - state.npc.position.z,
  };
  const distance = Math.hypot(toTarget.x, toTarget.z);

  if (distance <= 0.001) {
    return;
  }

  const direction = {
    x: toTarget.x / distance,
    z: toTarget.z / distance,
  };
  const step = Math.min(NPC_SPEED * deltaSeconds, distance);
  const current = state.npc.position;
  const next = {
    x: current.x + direction.x * step,
    z: current.z + direction.z * step,
  };

  if (isNpcWalkable(state, next.x, next.z)) {
    current.x = next.x;
    current.z = next.z;
  } else if (isNpcWalkable(state, next.x, current.z)) {
    current.x = next.x;
  } else if (isNpcWalkable(state, current.x, next.z)) {
    current.z = next.z;
  }
}

function getNpcRegion(state: GameState, point: Vec2): NavigationRegion {
  for (const room of state.rooms) {
    if (!isRoomOpenForNpc(state, room)) {
      continue;
    }

    const roomMinX = room.centerX - ROOM.width / 2;
    const roomMaxX = room.centerX + ROOM.width / 2;

    if (insideRect(point.x, point.z, roomMinX, roomMaxX, ROOM.minZ, ROOM.maxZ, 0)) {
      return { kind: "room", room };
    }
  }

  if (insideRect(point.x, point.z, CORRIDOR.minX, CORRIDOR.maxX, CORRIDOR.minZ, CORRIDOR.maxZ, 0)) {
    return { kind: "corridor" };
  }

  return { kind: "unknown" };
}

function getDoorLanePoint(room: RoomState): Vec2 {
  return {
    x: room.centerX + DOOR.width * 0.18,
    z: DOOR.z,
  };
}

function hasClearNpcLine(state: GameState, start: Vec2, end: Vec2): boolean {
  const distance = distanceTo(start, end);
  const samples = Math.max(2, Math.ceil(distance / 0.18));

  for (let index = 1; index <= samples; index += 1) {
    const progress = index / samples;
    const x = start.x + (end.x - start.x) * progress;
    const z = start.z + (end.z - start.z) * progress;

    if (!isNpcWalkable(state, x, z, NPC_RADIUS * 0.45)) {
      return false;
    }
  }

  return true;
}

function isNpcWalkable(state: GameState, x: number, z: number, radius = NPC_RADIUS): boolean {
  if (insideRect(x, z, CORRIDOR.minX, CORRIDOR.maxX, CORRIDOR.minZ, CORRIDOR.maxZ, radius)) {
    return true;
  }

  for (const room of state.rooms) {
    if (!isRoomOpenForNpc(state, room)) {
      continue;
    }

    const roomMinX = room.centerX - ROOM.width / 2;
    const roomMaxX = room.centerX + ROOM.width / 2;

    if (insideRect(x, z, roomMinX, roomMaxX, ROOM.minZ, ROOM.maxZ, radius)) {
      return true;
    }

    if (
      insideRect(
        x,
        z,
        room.centerX - PASSAGE.halfWidth,
        room.centerX + PASSAGE.halfWidth,
        PASSAGE.minZ,
        PASSAGE.maxZ,
        radius * 0.45,
      )
    ) {
      return true;
    }
  }

  return false;
}

function isRoomOpenForNpc(state: GameState, room: RoomState): boolean {
  return room.doorOpen && (!room.isDanger || room.id === state.npc.roomId);
}

function getNearestClosedDoor(state: GameState): RoomState | null {
  let best: RoomState | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const room of state.rooms) {
    if (room.doorOpen) {
      continue;
    }

    const distance = distanceTo(state.player.position, { x: room.centerX, z: DOOR.interactZ });

    if (distance <= DOOR.interactRange && distance < bestDistance) {
      best = room;
      bestDistance = distance;
    }
  }

  return best;
}

function getNearestCollectableItem(state: GameState): RoomState | null {
  let best: RoomState | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const room of state.rooms) {
    if (!room.hasItem || room.itemCollected || !room.doorOpen || room.isDanger) {
      continue;
    }

    const distance = distanceTo(state.player.position, room.itemPosition);

    if (distance <= 1.15 && distance < bestDistance) {
      best = room;
      bestDistance = distance;
    }
  }

  return best;
}

function isWalkable(state: GameState, x: number, z: number): boolean {
  const radius = PLAYER.radius;

  if (insideRect(x, z, CORRIDOR.minX, CORRIDOR.maxX, CORRIDOR.minZ, CORRIDOR.maxZ, radius)) {
    return true;
  }

  for (const room of state.rooms) {
    if (!room.doorOpen || room.isDanger) {
      continue;
    }

    const roomMinX = room.centerX - ROOM.width / 2;
    const roomMaxX = room.centerX + ROOM.width / 2;

    if (insideRect(x, z, roomMinX, roomMaxX, ROOM.minZ, ROOM.maxZ, radius)) {
      return true;
    }

    if (
      insideRect(
        x,
        z,
        room.centerX - PASSAGE.halfWidth,
        room.centerX + PASSAGE.halfWidth,
        PASSAGE.minZ,
        PASSAGE.maxZ,
        radius * 0.45,
      )
    ) {
      return true;
    }
  }

  return false;
}

function insideRect(
  x: number,
  z: number,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  inset: number,
): boolean {
  return x >= minX + inset && x <= maxX - inset && z >= minZ + inset && z <= maxZ - inset;
}

function distanceTo(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];

  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }

  return result;
}
