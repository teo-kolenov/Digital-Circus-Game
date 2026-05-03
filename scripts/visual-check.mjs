import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const targetUrl = process.env.QA_URL ?? "http://localhost:5173/";
const screenshotDir = path.join(tmpdir(), "digital-circus-qa");
const chromeCandidates = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Google Chrome 2.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];
const executablePath = chromeCandidates.find((candidate) => existsSync(candidate));

if (!executablePath) {
  throw new Error("No local Chrome or Chromium executable was found for visual checks.");
}

await mkdir(screenshotDir, { recursive: true });

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: [
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-features=MediaRouter,OptimizationGuideModelDownloading",
    "--disable-gpu",
    "--no-default-browser-check",
    "--no-first-run",
  ],
});

const viewports = [
  { name: "desktop", width: 1280, height: 800, isMobile: false },
  { name: "tablet", width: 820, height: 1180, isMobile: true },
];
const results = [];

try {
  for (const viewport of viewports) {
    const page = await browser.newPage({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
      isMobile: viewport.isMobile,
      hasTouch: viewport.isMobile,
    });
    const runtimeIssues = [];

    page.on("console", (message) => {
      if (message.type() === "error") {
        runtimeIssues.push(message.text());
      }
    });
    page.on("pageerror", (error) => runtimeIssues.push(error.message));

    await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#game");
    await page.waitForTimeout(1600);

    const stats = await page.evaluate(() => {
      const canvas = document.querySelector("#game");

      if (!(canvas instanceof HTMLCanvasElement)) {
        throw new Error("Game canvas is missing.");
      }

      const sample = document.createElement("canvas");
      sample.width = 96;
      sample.height = 60;
      const context = sample.getContext("2d", { willReadFrequently: true });

      if (!context) {
        throw new Error("2D canvas context is unavailable.");
      }

      context.drawImage(canvas, 0, 0, sample.width, sample.height);
      const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
      const colorBuckets = new Set();
      let litPixels = 0;
      let luminanceSum = 0;
      let luminanceSquareSum = 0;

      for (let index = 0; index < pixels.length; index += 4) {
        const red = pixels[index];
        const green = pixels[index + 1];
        const blue = pixels[index + 2];
        const alpha = pixels[index + 3];
        const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;

        if (alpha > 20 && luminance > 18) {
          litPixels += 1;
        }

        luminanceSum += luminance;
        luminanceSquareSum += luminance * luminance;
        colorBuckets.add(`${red >> 4}:${green >> 4}:${blue >> 4}`);
      }

      const pixelCount = pixels.length / 4;
      const average = luminanceSum / pixelCount;
      const variance = luminanceSquareSum / pixelCount - average * average;
      const centerElement = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
      const controls = Array.from(document.querySelectorAll(".touch-controls button"));
      const overflowing = Array.from(document.querySelectorAll("button, .objective-chip, .inventory-strip, .prompt"))
        .filter((element) => {
          const htmlElement = element;
          const style = window.getComputedStyle(htmlElement);

          if (style.display === "none" || style.visibility === "hidden") {
            return false;
          }

          return htmlElement.scrollWidth > htmlElement.clientWidth + 1 || htmlElement.scrollHeight > htmlElement.clientHeight + 1;
        })
        .map((element) => element.textContent?.trim() || element.className.toString());

      return {
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        displayWidth: canvas.getBoundingClientRect().width,
        displayHeight: canvas.getBoundingClientRect().height,
        canvasHash: hashPixels(pixels),
        litRatio: litPixels / pixelCount,
        colorBucketCount: colorBuckets.size,
        luminanceVariance: variance,
        centerClear: centerElement === canvas,
        objective: document.querySelector("#objectiveText")?.textContent,
        controlCount: controls.length,
        overflowing,
      };

      function hashPixels(pixelData) {
        let hash = 2166136261;

        for (let index = 0; index < pixelData.length; index += 16) {
          hash ^= pixelData[index] + (pixelData[index + 1] << 8) + (pixelData[index + 2] << 16);
          hash = Math.imul(hash, 16777619);
        }

        return hash >>> 0;
      }
    });

    if (viewport.name === "desktop") {
      await page.keyboard.down("w");
      await page.waitForTimeout(700);
      await page.keyboard.up("w");

      const movedCanvasHash = await page.evaluate(() => {
        const canvas = document.querySelector("#game");

        if (!(canvas instanceof HTMLCanvasElement)) {
          throw new Error("Game canvas is missing.");
        }

        const sample = document.createElement("canvas");
        sample.width = 96;
        sample.height = 60;
        const context = sample.getContext("2d", { willReadFrequently: true });

        if (!context) {
          throw new Error("2D canvas context is unavailable.");
        }

        context.drawImage(canvas, 0, 0, sample.width, sample.height);
        const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
        let hash = 2166136261;

        for (let index = 0; index < pixels.length; index += 16) {
          hash ^= pixels[index] + (pixels[index + 1] << 8) + (pixels[index + 2] << 16);
          hash = Math.imul(hash, 16777619);
        }

        return hash >>> 0;
      });

      assert(movedCanvasHash !== stats.canvasHash, "desktop: keyboard movement did not change the frame");
    }

    const screenshotPath = path.join(screenshotDir, `digital-circus-${viewport.name}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false });
    await page.close();

    assert(stats.displayWidth >= viewport.width - 1, `${viewport.name}: canvas width is too small`);
    assert(stats.displayHeight >= viewport.height - 1, `${viewport.name}: canvas height is too small`);
    assert(stats.litRatio > 0.8, `${viewport.name}: canvas looks blank or too dark`);
    assert(stats.colorBucketCount > 20, `${viewport.name}: canvas lacks visible color variety`);
    assert(stats.luminanceVariance > 40, `${viewport.name}: canvas has too little contrast`);
    assert(stats.centerClear, `${viewport.name}: HUD covers the playfield center`);
    assert(stats.objective === "Соберите 0/3 запчасти", `${viewport.name}: objective HUD text is wrong`);
    assert(stats.controlCount === 6, `${viewport.name}: tablet controls are incomplete`);
    assert(stats.overflowing.length === 0, `${viewport.name}: visible text overflows: ${stats.overflowing.join(", ")}`);
    assert(runtimeIssues.length === 0, `${viewport.name}: runtime errors: ${runtimeIssues.join(" | ")}`);

    results.push({
      viewport: viewport.name,
      screenshotPath,
      litRatio: Number(stats.litRatio.toFixed(3)),
      colorBucketCount: stats.colorBucketCount,
      luminanceVariance: Number(stats.luminanceVariance.toFixed(1)),
    });
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify({ ok: true, results }, null, 2));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
