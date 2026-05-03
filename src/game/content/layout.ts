export const ROOM_CENTERS = [-8, -4, 0, 4, 8] as const;

export const CORRIDOR = {
  minX: -11.45,
  maxX: 11.45,
  minZ: -2.1,
  maxZ: 6.2,
};

export const ROOM = {
  width: 3.55,
  depth: 5.65,
  minZ: -7.75,
  maxZ: -2.1,
};

export const DOOR = {
  z: -2.08,
  width: 1.45,
  interactZ: -1.78,
  interactRange: 1.22,
};

export const PASSAGE = {
  halfWidth: 0.78,
  minZ: -2.75,
  maxZ: -1.42,
};

export const PLAYER = {
  startX: 0,
  startZ: 3.55,
  speed: 3.45,
  radius: 0.38,
};

export const ASSETS = {
  corridor: new URL("../../../Corridor.jpeg", import.meta.url).href,
  gameStyle1: new URL("../../../Game style1.jpeg", import.meta.url).href,
  gameStyle2: new URL("../../../Game style2.jpeg", import.meta.url).href,
  npc: new URL("../../../NPC.jpeg", import.meta.url).href,
  player: new URL("../../../jester_transparent_feathered.png", import.meta.url).href,
  object: new URL("../../../object.jpeg", import.meta.url).href,
};
