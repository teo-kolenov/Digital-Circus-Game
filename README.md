# Digital Circus Quest

Digital Circus Quest is a browser-based 3D quest game built with Three.js, TypeScript, and Vite. The player explores a bright digital circus corridor, opens rooms, collects three missing machine parts, and avoids the hidden NPC that can start chasing from a dangerous room.

## Gameplay

The goal is to collect all three parts and fill the box before the NPC catches the player.

- Explore a five-room circus corridor.
- Open doors to discover rooms.
- Collect machine parts from safe rooms.
- Avoid the NPC when the dangerous room is opened.
- Escape the NPC by moving into a neighboring safe room.
- Win after collecting three parts.
- Lose if the NPC catches the player.

## Controls

Keyboard:

- `W`, `A`, `S`, `D` or arrow keys: move
- `E`: open a nearby door
- `F` or `Space`: collect a nearby part
- `R`: restart

Touch controls are also available on screen for movement, opening doors, and collecting parts.

Gamepad (Bluetooth or USB, standard layout):

- Left stick or D-pad: move
- `A` / Cross: collect a nearby part
- `B` / Circle or `X` / Square: open a nearby door
- Start / Menu: restart

A "Gamepad connected" badge appears in the HUD when a controller is detected. The left stick has a deadzone of 0.2 to prevent drift.

## Tech Stack

- Three.js for WebGL rendering
- TypeScript for game logic
- Vite for development and production builds
- DOM overlays for HUD, prompts, touch controls, and result screens
- Web Audio API for generated sound effects and playback
- Playwright Core for visual smoke checks

## Project Structure

```text
src/
  audio/              Sound effects and audio unlock logic
  game/
    content/          Room, corridor, player, door, and asset layout constants
    input/            Keyboard and touch input handling
    simulation/       Game state, rules, NPC chase logic, and win/loss flow
  render/             Three.js scene, camera, lighting, textures, and visual sync
  ui/                 HUD and result overlay updates
  main.ts             Game bootstrap and main loop
  styles.css          Browser layout and DOM game UI
public/assets/        Runtime image assets served by Vite
scripts/              Visual QA helper scripts
```

## Installation

Requirements:

- Node.js 18 or newer
- npm
- Chrome or Chromium if you want to run visual checks

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Open the local URL shown by Vite in your browser. By default it is usually:

```text
http://localhost:5173/
```

## Production Build

Create a production build:

```bash
npm run build
```

Preview the built version locally:

```bash
npm run preview
```

## Visual Check

The project includes a browser smoke test that verifies the WebGL canvas renders, the HUD does not cover the center of the playfield, controls are present, and basic keyboard movement changes the frame.

Run the development server first, then run:

```bash
npm run visual-check
```

If the game is running on a different URL or port, pass it with `QA_URL`:

```bash
QA_URL=http://localhost:5174/ npm run visual-check
```

Screenshots are written to the system temporary directory under `digital-circus-qa`.

## Assets

The game uses local image and audio assets for the circus environment, player standee, NPC standee, visual effects, and sounds. Runtime assets are loaded from `public/assets/`, while source/reference files are kept in the project root.

## License

This project is licensed under the GNU General Public License v3. See `LICENSE` for details.
