import type { Vec2 } from "../simulation/state";

const SCREEN_FORWARD_IN_WORLD: Vec2 = { x: 0, z: -1 };
const SCREEN_RIGHT_IN_WORLD: Vec2 = { x: 1, z: 0 };

export function screenInputToWorldMovement(input: Vec2): Vec2 {
  const forwardAmount = -input.z;
  const rightAmount = input.x;

  return {
    x: SCREEN_RIGHT_IN_WORLD.x * rightAmount + SCREEN_FORWARD_IN_WORLD.x * forwardAmount,
    z: SCREEN_RIGHT_IN_WORLD.z * rightAmount + SCREEN_FORWARD_IN_WORLD.z * forwardAmount,
  };
}
