const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const [rootArg, outputArg, baseUrl] = process.argv.slice(2);
if (!rootArg || !outputArg || !baseUrl) throw new Error("usage: circuit-012-http.cjs ROOT OUTPUT BASE_URL");
const root = path.resolve(rootArg);
const output = path.resolve(outputArg);
const f0 = path.join(root, "tests", "fixtures", "circuit-012-f0.json");
const duplicate = path.resolve(root, "../../../results/CIRCUIT-012/attempt-01/ui-fixtures/duplicate-probe.json");
fs.mkdirSync(output, { recursive: true });
const sha = (filename) => crypto.createHash("sha256").update(fs.readFileSync(filename)).digest("hex");
const evidence = { transport: baseUrl, scenarios: [] };

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CIRCUIT_LAB_BROWSER || undefined });
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, acceptDownloads: true });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.goto(baseUrl, { waitUntil: "load" });
    await page.locator("#file-input").setInputFiles(f0);
    await page.waitForFunction(() => window.__CIRCUIT_LAB__?.getState().runState.status === "success");
    const readings = await page.locator("#probe-list").innerText();
    if (!readings.includes("2.5 V") || !readings.includes("2.5 mA")) throw new Error(`F0 readings missing at ${width}`);

    if (width === 1440) {
      const jsonDownload = page.waitForEvent("download");
      await page.locator("#save-button").click();
      const saved = path.join(output, "f0-saved.json");
      await (await jsonDownload).saveAs(saved);
      const data = JSON.parse(fs.readFileSync(saved, "utf8"));
      if (data.circuit.components.map((item) => item.id).join(",") !== "V1,R1,R2,G1") throw new Error("saved component IDs changed");
      if (data.probes.map((item) => item.key).join(",") !== "V:R2:0,I:R2,V:V1:0") throw new Error("saved probe keys changed");
      if (data.settings.phasorFrequency !== "1") throw new Error("saved settings changed");
      await page.locator("#file-input").setInputFiles(saved);
      await page.waitForFunction(() => window.__CIRCUIT_LAB__?.getState().runState.status === "success");
      const csvDownload = page.waitForEvent("download");
      await page.locator("#csv-button").click();
      const csvFile = path.join(output, "f0.csv");
      await (await csvDownload).saveAs(csvFile);
      const lines = fs.readFileSync(csvFile, "utf8").replace(/^\uFEFF/, "").trim().split(/\r?\n/);
      const cells = lines[1].split(",").map(Number);
      if (lines.length !== 2 || cells.length !== 4 || Math.abs(cells[1] - 2.5) > 1e-9 || Math.abs(cells[2] - .0025) > 1e-11) throw new Error("downloaded CSV changed");
    }

    await page.locator('[data-id="R1"] .value-label').dblclick();
    await page.locator("#inline-value-editor").fill("banana");
    await page.locator("#run-button").click();
    if (!(await page.locator("#csv-button").isDisabled())) throw new Error(`invalid draft exported at ${width}`);
    const before = await page.locator("#canvas-title").innerText();
    await page.locator("#file-input").setInputFiles(duplicate);
    if (!(await page.locator("#engine-status").innerText()).includes("불러오기 실패")) throw new Error(`invalid import accepted at ${width}`);
    if ((await page.locator("#canvas-title").innerText()) !== before) throw new Error(`invalid import mutated title at ${width}`);
    if ((await page.locator("#inline-value-editor").inputValue()) !== "banana") throw new Error(`invalid import lost draft at ${width}`);
    await page.locator("#discard-drafts-button").click();

    const chips = page.locator("[data-probe-key]");
    const initial = await chips.count();
    await chips.first().locator("button").click();
    if (await chips.count() !== initial - 1) throw new Error(`probe delete failed at ${width}`);
    await page.locator("#undo-button").click();
    if (await chips.count() !== initial) throw new Error(`probe undo failed at ${width}`);
    await page.locator("#redo-button").click();
    if (await chips.count() !== initial - 1) throw new Error(`probe redo failed at ${width}`);
    await page.locator("#undo-button").click();
    if (width === 390) await page.locator('[data-pane="results"]').click();
    const shot = path.join(output, `http-${width}.png`);
    await page.screenshot({ path: shot });
    evidence.scenarios.push({ viewport: [width, height], status: "PASS", pageErrors: errors, screenshot: path.basename(shot), screenshotSha256: sha(shot) });
    await context.close();
  }
  evidence.browser = browser.version();
  await browser.close();
  for (const name of ["f0-saved.json", "f0.csv"]) {
    const filename = path.join(output, name);
    evidence[name] = { sha256: sha(filename), bytes: fs.statSync(filename).size };
  }
  fs.writeFileSync(path.join(output, "http-ui.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence, null, 2));
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
