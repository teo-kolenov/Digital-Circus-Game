import type { GameState, InteractionPrompt } from "../game/simulation/state";

export class Hud {
  private readonly objectiveText: HTMLElement;
  private readonly compactObjectiveQuery = window.matchMedia("(max-width: 900px), (max-height: 560px)");
  private readonly prompt: HTMLElement;
  private readonly slots: HTMLElement[];
  private readonly resultOverlay: HTMLElement;
  private readonly resultKicker: HTMLElement;
  private readonly resultTitle: HTMLElement;
  private readonly resultBody: HTMLElement;
  private readonly restartButton: HTMLButtonElement;
  private collected = 0;

  constructor(root: HTMLElement) {
    this.objectiveText = requireElement(root, "#objectiveText");
    this.prompt = requireElement(root, "#prompt");
    this.slots = Array.from(root.querySelectorAll<HTMLElement>(".slot"));
    this.resultOverlay = requireElement(root, "#resultOverlay");
    this.resultKicker = requireElement(root, "#resultKicker");
    this.resultTitle = requireElement(root, "#resultTitle");
    this.resultBody = requireElement(root, "#resultBody");
    this.restartButton = requireElement<HTMLButtonElement>(root, "#restartButton");
    this.compactObjectiveQuery.addEventListener("change", () => this.updateObjectiveText());
  }

  setRestartHandler(handler: () => void): void {
    this.restartButton.addEventListener("click", handler);
  }

  update(state: GameState, prompt: InteractionPrompt | null): void {
    this.collected = state.collected;
    this.updateObjectiveText();

    this.slots.forEach((slot, index) => {
      slot.classList.toggle("filled", index < state.collected);
    });

    if (prompt) {
      this.prompt.textContent = prompt.text;
      this.prompt.classList.remove("hidden");
    } else {
      this.prompt.textContent = "";
      this.prompt.classList.add("hidden");
    }

    if (state.status === "playing") {
      this.resultOverlay.classList.add("hidden");
      return;
    }

    this.resultKicker.textContent = state.status === "won" ? "Коробка заполнена" : "NPC догнал";
    this.resultTitle.textContent = state.resultTitle;
    this.resultBody.textContent = state.resultBody;
    this.resultOverlay.classList.remove("hidden");
  }

  private updateObjectiveText(): void {
    const progress = `${this.collected}/3 артефакта`;
    this.objectiveText.textContent = this.compactObjectiveQuery.matches ? progress : `Соберите ${progress}`;
  }
}

function requireElement<T extends HTMLElement = HTMLElement>(root: HTMLElement, selector: string): T {
  const element = root.querySelector<T>(selector);

  if (!element) {
    throw new Error(`Missing UI element: ${selector}`);
  }

  return element;
}
