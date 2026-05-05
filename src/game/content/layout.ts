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
  corridor: "/assets/Corridor.jpeg",
  gameStyle1: "/assets/Game%20style1.jpeg",
  gameStyle2: "/assets/Game%20style2.jpeg",
  npc: "/assets/NPC.jpeg",
  player: "/assets/jester_transparent_feathered.png",
  object: "/assets/object.jpeg",
  bangExplosion: "/assets/bang-comic-explosion.png",
};
