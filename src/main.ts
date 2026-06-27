import "./styles.css";
import { SoundController } from "./audio/SoundController";
import { InputController } from "./game/input/InputController";
import { screenInputToWorldMovement } from "./game/input/movement";
import {
  createGameState,
  getPrompt,
  movePlayer,
  tryCollectItem,
  tryOpenDoor,
  updateNpcChase,
  type GameState,
  type GameStatus,
} from "./game/simulation/state";
import { WorldView } from "./render/WorldView";
import { Hud } from "./ui/Hud";

class DigitalCircusQuest {
  private state: GameState;
  private readonly input: InputController;
  private readonly world: WorldView;
  private readonly hud: Hud;
  private readonly sound: SoundController;
  private previousTime = performance.now();

  constructor(root: HTMLElement, canvas: HTMLCanvasElement) {
    this.state = createGameState();
    this.input = new InputController(root);
    this.world = new WorldView(canvas);
    this.hud = new Hud(root);
    this.sound = new SoundController();
    this.hud.setRestartHandler(() => this.restart());
    this.input.setGamepadStatusHandler((connected) => this.hud.setGamepadConnected(connected));
    this.world.rebuild(this.state);
    this.tick(this.previousTime);
  }

  private readonly tick = (time: number): void => {
    const deltaSeconds = Math.min(0.05, (time - this.previousTime) / 1000);
    this.previousTime = time;
    const statusBeforeTick = this.state.status;
    const npcStatusBeforeTick = this.state.npc.status;

    this.input.pollGamepad();

    if (this.input.consumeRestartRequest()) {
      this.restart();
    }

    if (this.state.status === "playing") {
      const movement = screenInputToWorldMovement(this.input.getMovementVector());
      const previousPosition = { ...this.state.player.position };
      movePlayer(this.state, movement, deltaSeconds);
      const didMove = Math.hypot(
        this.state.player.position.x - previousPosition.x,
        this.state.player.position.z - previousPosition.z,
      ) > 0.002;
      this.sound.updateWalking(didMove, deltaSeconds);

      if (this.input.consumeOpenRequest()) {
        const didOpenDoor = tryOpenDoor(this.state);

        if (didOpenDoor) {
          this.sound.playDoorOpen();
        }
      }

      if (this.input.consumeUseRequest()) {
        const didCollectItem = tryCollectItem(this.state);

        if (didCollectItem) {
          this.sound.playTake();
        }
      }

      updateNpcChase(this.state, deltaSeconds);
    } else {
      this.sound.updateWalking(false, deltaSeconds);
    }

    this.playNpcTransition(npcStatusBeforeTick, this.state.npc.status);
    this.playStatusTransition(statusBeforeTick, this.state.status, npcStatusBeforeTick);

    const prompt = getPrompt(this.state);
    this.world.sync(this.state, deltaSeconds);
    this.hud.update(this.state, prompt);
    this.world.render();
    requestAnimationFrame(this.tick);
  };

  private restart(): void {
    this.state = createGameState();
    this.sound.reset();
    this.world.rebuild(this.state);
    this.hud.update(this.state, null);
  }

  private playStatusTransition(
    from: GameStatus,
    to: GameStatus,
    npcFrom: GameState["npc"]["status"],
  ): void {
    if (from === "playing" && to === "won") {
      if (npcFrom === "chasing") {
        this.world.showNpcVanishEffect(this.state.npc.position);
        this.sound.playNpcVanish();
      }

      this.sound.playWin(0.08);
    } else if (from === "playing" && to === "lost") {
      this.sound.playGameOver(0.08);
    }
  }

  private playNpcTransition(from: GameState["npc"]["status"], to: GameState["npc"]["status"]): void {
    if (from === "chasing" && to === "escaped") {
      this.world.showNpcVanishEffect(this.state.npc.position);
      this.sound.playNpcVanish();
    }
  }
}

const root = document.querySelector<HTMLElement>("#app");
const canvas = document.querySelector<HTMLCanvasElement>("#game");

if (!root || !canvas) {
  throw new Error("Game root or canvas is missing");
}

new DigitalCircusQuest(root, canvas);
