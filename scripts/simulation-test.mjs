import assert from "node:assert/strict";
import { build } from "esbuild";

const simulation = await loadSimulation();

const OPEN_DOOR_CHASE_CASES = [
  {
    name: "from the hinge side",
    npc: { x: -1.4, z: -1.15 },
    player: { x: 0.7, z: -1.15 },
  },
  {
    name: "from behind the open door leaf",
    npc: { x: 0.2, z: -1.2 },
    player: { x: -1.4, z: -1.15 },
  },
  {
    name: "while already overlapping the open door leaf",
    npc: { x: -1, z: -1 },
    player: { x: 0.8, z: -1 },
  },
];

const PLAYER_DOOR_OPENING_CASES = [
  {
    name: "from the hinge side",
    player: { x: -0.9, z: -1.4 },
  },
  {
    name: "from the door leaf path",
    player: { x: -0.72, z: -1.1 },
  },
  {
    name: "from the center lane",
    player: { x: 0, z: -1.25 },
  },
  {
    name: "from the knob side",
    player: { x: 0.68, z: -1.52 },
  },
];

const TEST_ROOM_CENTER_X = 0;
const TEST_DOOR = {
  z: -2.08,
  width: 1.45,
  depth: 0.18,
  openRotation: -Math.PI * 0.54,
};
const TEST_PLAYER_RADIUS = 0.38;
const TEST_DOOR_DETOUR_MARGIN = 0.18;
const TEST_DOOR_SWEEP_SAMPLES = 18;

for (const scenario of OPEN_DOOR_CHASE_CASES) {
  runTest(`NPC keeps chasing around an open door: ${scenario.name}`, () => {
    assertNpcKeepsChasingAroundOpenDoor(scenario);
  });
}

for (const scenario of PLAYER_DOOR_OPENING_CASES) {
  runTest(`Player is not trapped when opening a door: ${scenario.name}`, () => {
    assertPlayerNotTrappedWhenOpeningDoor(scenario);
  });
}

function assertPlayerNotTrappedWhenOpeningDoor({ player }) {
  const state = createPlayerDoorOpeningState({ player });
  const positionBeforeOpen = { ...state.player.position };

  assert.equal(simulation.tryOpenDoor(state), true);

  const openingDisplacement = distanceTo(positionBeforeOpen, state.player.position);

  assert.ok(openingDisplacement > 0.02, `expected door opening to clear player, moved ${openingDisplacement}`);
  assertOutsideDoorSweep(TEST_ROOM_CENTER_X, state.player.position);

  const positionAfterOpen = { ...state.player.position };
  const movementAttempts = [
    { x: 1, z: 0 },
    { x: -1, z: 0 },
    { x: 0, z: 1 },
    { x: 0, z: -1 },
  ];
  const movements = movementAttempts.map((input) => {
    const candidate = createPlayerDoorOpeningState({ player });

    assert.equal(simulation.tryOpenDoor(candidate), true);
    const beforeMove = { ...candidate.player.position };
    simulation.movePlayer(candidate, input, 0.1);

    return distanceTo(beforeMove, candidate.player.position);
  });
  const availableMovements = movements.filter((movement) => movement > 0.02).length;

  assert.ok(
    availableMovements >= 2,
    `expected player controls to remain available, movements: ${movements.join(", ")}`,
  );
  assert.ok(
    distanceTo(positionAfterOpen, positionBeforeOpen) > 0.02,
    "expected player to stay clear of the opened door leaf",
  );
}

function assertNpcKeepsChasingAroundOpenDoor({ npc, player }) {
  const state = createOpenDoorChaseState({
    npc,
    player,
  });
  const startingDistance = distanceTo(state.npc.position, state.player.position);
  const firstPosition = { ...state.npc.position };

  simulation.updateNpcChase(state, 0.1);

  const firstStep = distanceTo(firstPosition, state.npc.position);

  assert.ok(firstStep > 0.02, `expected NPC to start detouring, moved ${firstStep}`);

  let totalMovement = firstStep;

  for (let index = 0; index < 49 && state.status === "playing"; index += 1) {
    const previousPosition = { ...state.npc.position };

    simulation.updateNpcChase(state, 0.1);
    totalMovement += distanceTo(previousPosition, state.npc.position);
  }

  const finalDistance = distanceTo(state.npc.position, state.player.position);

  assert.ok(totalMovement > 1, `expected NPC to keep moving, moved ${totalMovement}`);
  assert.ok(
    state.status === "lost" || finalDistance < startingDistance - 1,
    `expected NPC to close distance or catch player, distance ${startingDistance} -> ${finalDistance}`,
  );
}

function createPlayerDoorOpeningState({ player }) {
  const state = simulation.createGameState();

  for (const room of state.rooms) {
    room.doorOpen = false;
    room.isDanger = false;
  }

  state.status = "playing";
  state.player.position = { ...player };

  return state;
}

function createOpenDoorChaseState({ npc, player }) {
  const state = simulation.createGameState();
  const room = state.rooms[2];

  for (const candidate of state.rooms) {
    candidate.doorOpen = false;
    candidate.isDanger = false;
  }

  room.doorOpen = true;
  room.isDanger = true;
  state.status = "playing";
  state.npc.status = "chasing";
  state.npc.roomId = room.id;
  state.npc.position = { ...npc };
  state.player.position = { ...player };

  return state;
}

async function loadSimulation() {
  const result = await build({
    entryPoints: ["src/game/simulation/state.ts"],
    bundle: true,
    format: "esm",
    logLevel: "silent",
    platform: "node",
    write: false,
  });
  const source = result.outputFiles[0].text;
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;

  return import(moduleUrl);
}

function runTest(name, test) {
  test();
  console.log(`ok - ${name}`);
}

function distanceTo(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function assertOutsideDoorSweep(roomCenterX, point) {
  assert.equal(
    isPointInDoorSweep(roomCenterX, point),
    false,
    `expected player to be outside the door opening sweep, got ${JSON.stringify(point)}`,
  );
}

function isPointInDoorSweep(roomCenterX, point) {
  const hinge = {
    x: roomCenterX - TEST_DOOR.width / 2,
    z: TEST_DOOR.z,
  };
  const collisionRadius = TEST_PLAYER_RADIUS + TEST_DOOR.depth / 2 + TEST_DOOR_DETOUR_MARGIN * 0.35;

  for (let index = 0; index <= TEST_DOOR_SWEEP_SAMPLES; index += 1) {
    const progress = index / TEST_DOOR_SWEEP_SAMPLES;
    const rotation = TEST_DOOR.openRotation * progress;
    const end = {
      x: hinge.x + Math.cos(rotation) * TEST_DOOR.width,
      z: hinge.z - Math.sin(rotation) * TEST_DOOR.width,
    };

    if (distanceToSegment(point, hinge, end) <= collisionRadius) {
      return true;
    }
  }

  return false;
}

function distanceToSegment(point, start, end) {
  const segmentX = end.x - start.x;
  const segmentZ = end.z - start.z;
  const lengthSquared = segmentX * segmentX + segmentZ * segmentZ;

  if (lengthSquared <= 0.0001) {
    return distanceTo(point, start);
  }

  const progress = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * segmentX + (point.z - start.z) * segmentZ) / lengthSquared),
  );
  const closest = {
    x: start.x + segmentX * progress,
    z: start.z + segmentZ * progress,
  };

  return distanceTo(point, closest);
}
