import type { Vec2 } from "../simulation/state";

type MoveName = "forward" | "back" | "left" | "right";
type ActionName = "open" | "use";

const KEY_TO_MOVE: Record<string, MoveName | undefined> = {
  KeyW: "forward",
  ArrowUp: "forward",
  KeyS: "back",
  ArrowDown: "back",
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
};

// Standard gamepad mapping (https://w3c.github.io/gamepad/#remapping).
const GAMEPAD_BUTTON = {
  use: 0, // A / Cross
  openCircle: 1, // B / Circle
  openSquare: 2, // X / Square
  start: 9, // Start / Menu
  dpadUp: 12,
  dpadDown: 13,
  dpadLeft: 14,
  dpadRight: 15,
} as const;

// Left analog stick drift can be sizeable, so ignore anything inside this radius.
const GAMEPAD_DEADZONE = 0.2;

export class InputController {
  private readonly activeMoves = new Set<MoveName>();
  private openRequested = false;
  private useRequested = false;
  private restartRequested = false;

  private gamepadIndex: number | null = null;
  private readonly gamepadMove: Vec2 = { x: 0, z: 0 };
  private readonly gamepadButtonWasPressed = new Map<number, boolean>();
  private gamepadStatusHandler: ((connected: boolean) => void) | null = null;

  constructor(private readonly root: HTMLElement) {
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("blur", this.clearHeldInputs);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    window.addEventListener("gamepadconnected", this.handleGamepadConnected);
    window.addEventListener("gamepaddisconnected", this.handleGamepadDisconnected);

    this.root.querySelectorAll<HTMLButtonElement>("[data-move]").forEach((button) => {
      const move = button.dataset.move as MoveName;
      this.bindHeldButton(button, () => this.activeMoves.add(move), () => this.activeMoves.delete(move));
    });

    this.root.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((button) => {
      const action = button.dataset.action as ActionName;
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        button.classList.add("active");
        this.requestAction(action);
      });
      button.addEventListener("pointerup", () => button.classList.remove("active"));
      button.addEventListener("pointercancel", () => button.classList.remove("active"));
      button.addEventListener("pointerleave", () => button.classList.remove("active"));
    });
  }

  /**
   * Reads the current gamepad state. Must be called once per frame before the
   * movement/request getters, because the Gamepad API only exposes a snapshot
   * that has to be polled (there are no per-button browser events).
   */
  pollGamepad(): void {
    const pad = this.getActiveGamepad();

    if (!pad) {
      this.gamepadMove.x = 0;
      this.gamepadMove.z = 0;
      return;
    }

    this.readGamepadMovement(pad);
    this.readGamepadButtons(pad);
  }

  /**
   * Registers a callback that fires when a controller connects (true) or
   * disconnects (false). Invoked immediately with the current state so the HUD
   * can sync up with a controller that was already plugged in.
   */
  setGamepadStatusHandler(handler: (connected: boolean) => void): void {
    this.gamepadStatusHandler = handler;
    handler(this.gamepadIndex !== null);
  }

  getMovementVector(): Vec2 {
    const vector = {
      x: 0,
      z: 0,
    };

    if (this.activeMoves.has("forward")) {
      vector.z -= 1;
    }

    if (this.activeMoves.has("back")) {
      vector.z += 1;
    }

    if (this.activeMoves.has("left")) {
      vector.x -= 1;
    }

    if (this.activeMoves.has("right")) {
      vector.x += 1;
    }

    vector.x += this.gamepadMove.x;
    vector.z += this.gamepadMove.z;

    // movePlayer normalizes direction, so clamping just keeps the magnitude
    // sane when keyboard and stick are pushed at the same time.
    vector.x = clamp(vector.x, -1, 1);
    vector.z = clamp(vector.z, -1, 1);

    return vector;
  }

  consumeOpenRequest(): boolean {
    const requested = this.openRequested;
    this.openRequested = false;
    return requested;
  }

  consumeUseRequest(): boolean {
    const requested = this.useRequested;
    this.useRequested = false;
    return requested;
  }

  consumeRestartRequest(): boolean {
    const requested = this.restartRequested;
    this.restartRequested = false;
    return requested;
  }

  dispose(): void {
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("blur", this.clearHeldInputs);
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    window.removeEventListener("gamepadconnected", this.handleGamepadConnected);
    window.removeEventListener("gamepaddisconnected", this.handleGamepadDisconnected);
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    const move = KEY_TO_MOVE[event.code];

    if (move) {
      event.preventDefault();
      this.activeMoves.add(move);
      return;
    }

    if (event.code === "KeyE") {
      event.preventDefault();
      this.openRequested = true;
    }

    if (event.code === "KeyF" || event.code === "Space") {
      event.preventDefault();
      this.useRequested = true;
    }

    if (event.code === "KeyR") {
      event.preventDefault();
      this.restartRequested = true;
    }
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    const move = KEY_TO_MOVE[event.code];

    if (move) {
      event.preventDefault();
      this.activeMoves.delete(move);
    }
  };

  private readonly handleVisibilityChange = (): void => {
    if (document.hidden) {
      this.clearHeldInputs();
    }
  };

  private readonly handleGamepadConnected = (event: GamepadEvent): void => {
    this.gamepadIndex = event.gamepad.index;
    this.gamepadStatusHandler?.(true);
  };

  private readonly handleGamepadDisconnected = (event: GamepadEvent): void => {
    if (event.gamepad.index !== this.gamepadIndex) {
      return;
    }

    this.resetGamepadState();
    this.gamepadStatusHandler?.(false);
  };

  private readonly clearHeldInputs = (): void => {
    this.activeMoves.clear();
    this.root.querySelectorAll<HTMLButtonElement>("[data-move].active").forEach((button) => {
      button.classList.remove("active");
    });
  };

  private getActiveGamepad(): Gamepad | null {
    const pads = typeof navigator.getGamepads === "function" ? navigator.getGamepads() : [];

    if (this.gamepadIndex !== null) {
      const tracked = pads[this.gamepadIndex];

      if (tracked) {
        return tracked;
      }
    }

    // Fallback for controllers that were already connected before the page
    // loaded: the connection event never fires until the first input, so adopt
    // the first live pad we see and announce it.
    for (const pad of pads) {
      if (pad) {
        if (pad.index !== this.gamepadIndex) {
          this.gamepadIndex = pad.index;
          this.gamepadStatusHandler?.(true);
        }

        return pad;
      }
    }

    if (this.gamepadIndex !== null) {
      this.resetGamepadState();
      this.gamepadStatusHandler?.(false);
    }

    return null;
  }

  private readGamepadMovement(pad: Gamepad): void {
    let x = 0;
    let z = 0;

    const stickX = pad.axes[0] ?? 0;
    const stickY = pad.axes[1] ?? 0;

    if (Math.hypot(stickX, stickY) >= GAMEPAD_DEADZONE) {
      x += stickX;
      z += stickY;
    }

    if (isButtonPressed(pad, GAMEPAD_BUTTON.dpadUp)) {
      z -= 1;
    }

    if (isButtonPressed(pad, GAMEPAD_BUTTON.dpadDown)) {
      z += 1;
    }

    if (isButtonPressed(pad, GAMEPAD_BUTTON.dpadLeft)) {
      x -= 1;
    }

    if (isButtonPressed(pad, GAMEPAD_BUTTON.dpadRight)) {
      x += 1;
    }

    this.gamepadMove.x = clamp(x, -1, 1);
    this.gamepadMove.z = clamp(z, -1, 1);
  }

  private readGamepadButtons(pad: Gamepad): void {
    // Evaluate every edge first so each button's "was pressed" history stays in
    // sync even when several map to the same action.
    const usePressed = this.consumeButtonEdge(pad, GAMEPAD_BUTTON.use);
    const openCircle = this.consumeButtonEdge(pad, GAMEPAD_BUTTON.openCircle);
    const openSquare = this.consumeButtonEdge(pad, GAMEPAD_BUTTON.openSquare);
    const startPressed = this.consumeButtonEdge(pad, GAMEPAD_BUTTON.start);

    if (usePressed) {
      this.useRequested = true;
    }

    if (openCircle || openSquare) {
      this.openRequested = true;
    }

    if (startPressed) {
      this.restartRequested = true;
    }
  }

  /** Returns true only on the frame a button transitions from up to down. */
  private consumeButtonEdge(pad: Gamepad, index: number): boolean {
    const pressed = isButtonPressed(pad, index);
    const wasPressed = this.gamepadButtonWasPressed.get(index) ?? false;
    this.gamepadButtonWasPressed.set(index, pressed);
    return pressed && !wasPressed;
  }

  private resetGamepadState(): void {
    this.gamepadIndex = null;
    this.gamepadMove.x = 0;
    this.gamepadMove.z = 0;
    this.gamepadButtonWasPressed.clear();
  }

  private bindHeldButton(button: HTMLButtonElement, onDown: () => void, onUp: () => void): void {
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      button.classList.add("active");
      onDown();
    });

    const release = (event: PointerEvent) => {
      event.preventDefault();
      button.classList.remove("active");
      onUp();
    };

    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
    button.addEventListener("lostpointercapture", () => {
      button.classList.remove("active");
      onUp();
    });
  }

  private requestAction(action: ActionName): void {
    if (action === "open") {
      this.openRequested = true;
    } else {
      this.useRequested = true;
    }
  }
}

function isButtonPressed(pad: Gamepad, index: number): boolean {
  const button = pad.buttons[index];
  return button ? button.pressed || button.value > 0.5 : false;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
