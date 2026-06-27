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
const DOOR_COLLISION_MIN_RADIUS = PLAYER.radius;
const DOOR_DETOUR_MARGIN = 0.18;
const DOOR_SWEEP_SAMPLES = 18;
const NPC_WAYPOINT_REACHED_DISTANCE = 0.08;

type NavigationRegion = { kind: "corridor" } | { kind: "room"; room: RoomState } | { kind: "unknown" };
type WalkableTest = (state: GameState, x: number, z: number, radius: number) => boolean;

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

  if (canPlayerStepTo(state, current, next)) {
    current.x = next.x;
    current.z = next.z;
  } else if (canPlayerStepTo(state, current, { x: next.x, z: current.z })) {
    current.x = next.x;
  } else if (canPlayerStepTo(state, current, { x: current.x, z: next.z })) {
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
  movePlayerOutOfOpeningDoor(state, room);

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
    state.resultBody = "Все три артефакта лежат в коробке. Цирковая машина снова готова к запуску.";
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
      text: "Артефакт рядом: Взять или F",
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
  const escapeTarget = getOpenDoorEscapeTarget(state, state.npc.position, NPC_RADIUS, isNpcWalkable);
  let target: Vec2;

  if (escapeTarget) {
    return escapeTarget;
  }

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
    const entrancePoint = {
      x: doorLane.x,
      z: PASSAGE.maxZ - 0.08,
    };
    const insideRoomTarget = {
      x: doorLane.x,
      z: PASSAGE.minZ - 0.16,
    };

    // First line the NPC up with the door lane while it is still out in the
    // corridor, then commit to heading through into the room. The commit is
    // directional (already past the entrance) rather than a symmetric distance
    // band, so the NPC keeps moving inward instead of oscillating on the
    // threshold once it crosses the doorway.
    const lanedUp = Math.abs(state.npc.position.x - doorLane.x) <= PASSAGE.halfWidth * 0.5;
    const reachedEntrance = state.npc.position.z <= entrancePoint.z;
    target = lanedUp && reachedEntrance ? insideRoomTarget : entrancePoint;

    return getOpenDoorRouteTarget(state, state.npc.position, target) ?? target;
  }

  target = state.player.position;
  return getOpenDoorRouteTarget(state, state.npc.position, target) ?? target;
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

  if (canNpcStepTo(state, current, next)) {
    current.x = next.x;
    current.z = next.z;
  } else if (canNpcStepTo(state, current, { x: next.x, z: current.z })) {
    current.x = next.x;
  } else if (canNpcStepTo(state, current, { x: current.x, z: next.z })) {
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
  if (isBlockedByOpenDoor(state, x, z, radius)) {
    return false;
  }

  return isNpcAreaWalkable(state, x, z, radius);
}

function isNpcAreaWalkable(state: GameState, x: number, z: number, radius = NPC_RADIUS): boolean {
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

function canNpcStepTo(state: GameState, current: Vec2, next: Vec2): boolean {
  if (isNpcWalkable(state, next.x, next.z, NPC_RADIUS)) {
    return true;
  }

  const currentDoorOverlap = getOpenDoorOverlap(state, current, NPC_RADIUS);

  if (currentDoorOverlap <= 0) {
    return false;
  }

  const nextDoorOverlap = getOpenDoorOverlap(state, next, NPC_RADIUS);

  return (
    nextDoorOverlap < currentDoorOverlap - 0.001 &&
    isNpcAreaWalkable(state, next.x, next.z, NPC_RADIUS)
  );
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

  if (isBlockedByOpenDoor(state, x, z, radius)) {
    return false;
  }

  return isPlayerAreaWalkable(state, x, z, radius);
}

function isPlayerAreaWalkable(state: GameState, x: number, z: number, radius = PLAYER.radius): boolean {
  if (insideRect(x, z, CORRIDOR.minX, CORRIDOR.maxX, CORRIDOR.minZ, CORRIDOR.maxZ, radius)) {
    return true;
  }

  for (const room of state.rooms) {
    // The danger room becomes walkable once its door is open, just like any
    // other room. It only opens after the player opens it (which starts the
    // chase), so this lets the player step into the room the NPC was hiding in.
    if (!room.doorOpen) {
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

function canPlayerStepTo(state: GameState, current: Vec2, next: Vec2): boolean {
  if (isWalkable(state, next.x, next.z)) {
    return true;
  }

  const currentDoorOverlap = getOpenDoorOverlap(state, current, PLAYER.radius);

  if (currentDoorOverlap <= 0) {
    return false;
  }

  const nextDoorOverlap = getOpenDoorOverlap(state, next, PLAYER.radius);

  return (
    nextDoorOverlap < currentDoorOverlap - 0.001 &&
    isPlayerAreaWalkable(state, next.x, next.z, PLAYER.radius)
  );
}

function movePlayerOutOfOpeningDoor(state: GameState, room: RoomState): void {
  const current = state.player.position;

  if (!isPointInDoorSweep(room, current, PLAYER.radius) && getOpenDoorOverlap(state, current, PLAYER.radius) <= 0) {
    return;
  }

  const safeOpeningTarget = getSafePlayerDoorOpeningPoint(state, room, current);

  if (safeOpeningTarget) {
    current.x = safeOpeningTarget.x;
    current.z = safeOpeningTarget.z;
    return;
  }

  const escapeTarget = getOpenDoorEscapeTarget(state, current, PLAYER.radius, isWalkable);

  if (!escapeTarget) {
    return;
  }

  current.x = escapeTarget.x;
  current.z = escapeTarget.z;
}

function getSafePlayerDoorOpeningPoint(state: GameState, room: RoomState, current: Vec2): Vec2 | null {
  const zOffsets = [1.95, 2.2, 2.45, 2.7, 3];
  const xOffsets = [0, PASSAGE.halfWidth * 0.45, -PASSAGE.halfWidth * 0.45, PASSAGE.halfWidth * 0.9, -PASSAGE.halfWidth * 0.9];
  let best: Vec2 | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const zOffset of zOffsets) {
    for (const xOffset of xOffsets) {
      const candidate = {
        x: room.centerX + xOffset,
        z: DOOR.z + zOffset,
      };

      if (!isWalkable(state, candidate.x, candidate.z)) {
        continue;
      }

      if (isPointInDoorSweep(room, candidate, PLAYER.radius)) {
        continue;
      }

      const score = distanceTo(current, candidate);

      if (score < bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
  }

  return best;
}

function isBlockedByOpenDoor(state: GameState, x: number, z: number, radius: number): boolean {
  for (const room of state.rooms) {
    if (!room.doorOpen) {
      continue;
    }

    if (isBlockedByOpenDoorRoom(room, { x, z }, radius)) {
      return true;
    }
  }

  return false;
}

function getOpenDoorOverlap(state: GameState, point: Vec2, radius: number): number {
  let overlap = 0;

  for (const room of state.rooms) {
    if (!room.doorOpen) {
      continue;
    }

    const segment = getOpenDoorSegment(room);
    const doorOverlap = getDoorCollisionRadius(radius) - distanceToSegment(point, segment.hinge, segment.end);

    if (doorOverlap > overlap) {
      overlap = doorOverlap;
    }
  }

  return overlap;
}

function getOpenDoorEscapeTarget(
  state: GameState,
  point: Vec2,
  radius: number,
  isWalkableAt: WalkableTest,
): Vec2 | null {
  let blockingSegment: { hinge: Vec2; end: Vec2 } | null = null;
  let blockingOverlap = 0;

  for (const room of state.rooms) {
    if (!room.doorOpen) {
      continue;
    }

    const segment = getOpenDoorSegment(room);
    const overlap = getDoorCollisionRadius(radius) - distanceToSegment(point, segment.hinge, segment.end);

    if (overlap > blockingOverlap) {
      blockingSegment = segment;
      blockingOverlap = overlap;
    }
  }

  if (!blockingSegment || blockingOverlap <= 0) {
    return null;
  }

  const tangent = normalizeVector({
    x: blockingSegment.end.x - blockingSegment.hinge.x,
    z: blockingSegment.end.z - blockingSegment.hinge.z,
  });
  const normal = {
    x: tangent.z,
    z: -tangent.x,
  };
  const closestPoint = getClosestPointOnSegment(point, blockingSegment.hinge, blockingSegment.end);
  const awayFromDoor = normalizeVector({
    x: point.x - closestPoint.x,
    z: point.z - closestPoint.z,
  });
  const directions = [
    awayFromDoor,
    normal,
    { x: -normal.x, z: -normal.z },
    tangent,
    { x: -tangent.x, z: -tangent.z },
  ].filter((direction) => Math.hypot(direction.x, direction.z) > 0.001);

  for (const distance of [blockingOverlap + DOOR_DETOUR_MARGIN, blockingOverlap + 0.42, blockingOverlap + 0.68]) {
    for (const direction of directions) {
      const candidate = {
        x: point.x + direction.x * distance,
        z: point.z + direction.z * distance,
      };

      if (isWalkableAt(state, candidate.x, candidate.z, radius)) {
        return candidate;
      }
    }
  }

  return null;
}

function getOpenDoorRouteTarget(state: GameState, start: Vec2, target: Vec2): Vec2 | null {
  if (hasNpcPathClear(state, start, target)) {
    return null;
  }

  const waypoints = [start, target, ...getOpenDoorRouteWaypoints(state)];
  const targetIndex = 1;
  const distances = waypoints.map(() => Number.POSITIVE_INFINITY);
  const previous = waypoints.map(() => -1);
  const visited = waypoints.map(() => false);
  distances[0] = 0;

  for (let step = 0; step < waypoints.length; step += 1) {
    const currentIndex = getNearestUnvisitedIndex(distances, visited);

    if (currentIndex === -1 || currentIndex === targetIndex) {
      break;
    }

    visited[currentIndex] = true;

    for (let nextIndex = 0; nextIndex < waypoints.length; nextIndex += 1) {
      if (visited[nextIndex] || nextIndex === currentIndex) {
        continue;
      }

      const edgeDistance = distanceTo(waypoints[currentIndex], waypoints[nextIndex]);

      if (edgeDistance <= NPC_WAYPOINT_REACHED_DISTANCE) {
        continue;
      }

      if (!hasNpcPathClear(state, waypoints[currentIndex], waypoints[nextIndex])) {
        continue;
      }

      const candidateDistance = distances[currentIndex] + edgeDistance;

      if (candidateDistance < distances[nextIndex]) {
        distances[nextIndex] = candidateDistance;
        previous[nextIndex] = currentIndex;
      }
    }
  }

  if (previous[targetIndex] === -1) {
    return getNearestReachableWaypointTowardTarget(state, start, target, waypoints.slice(2));
  }

  const path = getRoutePath(previous, targetIndex);

  for (const waypointIndex of path) {
    const waypoint = waypoints[waypointIndex];

    if (waypointIndex !== 0 && distanceTo(start, waypoint) > NPC_WAYPOINT_REACHED_DISTANCE) {
      return waypoint;
    }
  }

  return null;
}

function getOpenDoorRouteWaypoints(state: GameState): Vec2[] {
  const waypoints: Vec2[] = [];

  for (const room of state.rooms) {
    if (!room.doorOpen) {
      continue;
    }

    const segment = getOpenDoorSegment(room);
    const clearance = getDoorCollisionRadius(NPC_RADIUS) + DOOR_DETOUR_MARGIN;
    const tangent = normalizeVector({
      x: segment.end.x - segment.hinge.x,
      z: segment.end.z - segment.hinge.z,
    });
    const normal = {
      x: tangent.z,
      z: -tangent.x,
    };

    for (const anchor of [segment.hinge, segment.end]) {
      for (const normalDirection of [-1, 1]) {
        for (const tangentScale of [-1, 0, 1, 2, 3]) {
          waypoints.push({
            x: anchor.x + normal.x * clearance * normalDirection + tangent.x * clearance * tangentScale,
            z: anchor.z + normal.z * clearance * normalDirection + tangent.z * clearance * tangentScale,
          });
        }
      }
    }
  }

  return dedupeWalkableWaypoints(state, waypoints);
}

function dedupeWalkableWaypoints(state: GameState, waypoints: Vec2[]): Vec2[] {
  const result: Vec2[] = [];

  for (const waypoint of waypoints) {
    if (!isNpcWalkable(state, waypoint.x, waypoint.z, NPC_RADIUS)) {
      continue;
    }

    if (result.some((candidate) => distanceTo(candidate, waypoint) < NPC_WAYPOINT_REACHED_DISTANCE)) {
      continue;
    }

    result.push(waypoint);
  }

  return result;
}

function getNearestUnvisitedIndex(distances: number[], visited: boolean[]): number {
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < distances.length; index += 1) {
    if (!visited[index] && distances[index] < bestDistance) {
      bestIndex = index;
      bestDistance = distances[index];
    }
  }

  return bestIndex;
}

function getRoutePath(previous: number[], targetIndex: number): number[] {
  const path: number[] = [];

  for (let index = targetIndex; index !== -1; index = previous[index]) {
    path.unshift(index);
  }

  return path;
}

function getNearestReachableWaypointTowardTarget(
  state: GameState,
  start: Vec2,
  target: Vec2,
  waypoints: Vec2[],
): Vec2 | null {
  let best: Vec2 | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const waypoint of waypoints) {
    if (
      distanceTo(start, waypoint) <= NPC_WAYPOINT_REACHED_DISTANCE ||
      !hasNpcPathClear(state, start, waypoint)
    ) {
      continue;
    }

    const score = distanceTo(waypoint, target);

    if (score < bestScore) {
      best = waypoint;
      bestScore = score;
    }
  }

  return best;
}

function hasNpcPathClear(state: GameState, start: Vec2, end: Vec2): boolean {
  const distance = distanceTo(start, end);
  const samples = Math.max(2, Math.ceil(distance / 0.12));

  for (let index = 1; index <= samples; index += 1) {
    const progress = index / samples;
    const point = {
      x: start.x + (end.x - start.x) * progress,
      z: start.z + (end.z - start.z) * progress,
    };

    if (!isNpcWalkable(state, point.x, point.z, NPC_RADIUS)) {
      return false;
    }
  }

  return true;
}

function isBlockedByOpenDoorRoom(room: RoomState, point: Vec2, radius: number): boolean {
  const segment = getOpenDoorSegment(room);

  return distanceToSegment(point, segment.hinge, segment.end) <= getDoorCollisionRadius(radius);
}

function isPointInDoorSweep(room: RoomState, point: Vec2, radius: number): boolean {
  const hinge = getOpenDoorHinge(room);
  const collisionRadius = getDoorCollisionRadius(radius) + DOOR_DETOUR_MARGIN * 0.35;

  for (let index = 0; index <= DOOR_SWEEP_SAMPLES; index += 1) {
    const progress = index / DOOR_SWEEP_SAMPLES;
    const rotation = DOOR.openRotation * progress;
    const end = {
      x: hinge.x + Math.cos(rotation) * DOOR.width,
      z: hinge.z - Math.sin(rotation) * DOOR.width,
    };

    if (distanceToSegment(point, hinge, end) <= collisionRadius) {
      return true;
    }
  }

  return false;
}

function getDoorCollisionRadius(radius: number): number {
  return Math.max(radius, DOOR_COLLISION_MIN_RADIUS) + DOOR.depth / 2;
}

function getOpenDoorSegment(room: RoomState): { hinge: Vec2; end: Vec2 } {
  const hinge = getOpenDoorHinge(room);

  return {
    hinge,
    end: getOpenDoorEnd(hinge),
  };
}

function getOpenDoorHinge(room: RoomState): Vec2 {
  return {
    x: room.centerX - DOOR.width / 2,
    z: DOOR.z,
  };
}

function getOpenDoorEnd(hinge: Vec2): Vec2 {
  return {
    x: hinge.x + Math.cos(DOOR.openRotation) * DOOR.width,
    z: hinge.z - Math.sin(DOOR.openRotation) * DOOR.width,
  };
}

function distanceToSegment(point: Vec2, start: Vec2, end: Vec2): number {
  return distanceTo(point, getClosestPointOnSegment(point, start, end));
}

function getClosestPointOnSegment(point: Vec2, start: Vec2, end: Vec2): Vec2 {
  const segmentX = end.x - start.x;
  const segmentZ = end.z - start.z;
  const lengthSquared = segmentX * segmentX + segmentZ * segmentZ;

  if (lengthSquared <= 0.0001) {
    return start;
  }

  const progress = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * segmentX + (point.z - start.z) * segmentZ) / lengthSquared),
  );
  const closest = {
    x: start.x + segmentX * progress,
    z: start.z + segmentZ * progress,
  };

  return closest;
}

function normalizeVector(vector: Vec2): Vec2 {
  const length = Math.hypot(vector.x, vector.z);

  if (length <= 0.0001) {
    return { x: 0, z: 0 };
  }

  return {
    x: vector.x / length,
    z: vector.z / length,
  };
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
