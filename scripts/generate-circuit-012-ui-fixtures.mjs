import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = JSON.parse(await readFile(resolve(root, "tests/fixtures/circuit-012-f0.json"), "utf8"));
const output = resolve(root, "../../../results/CIRCUIT-012/attempt-01/ui-fixtures");
await mkdir(output, { recursive: true });

async function save(name, mutate) {
  const fixture = structuredClone(source);
  mutate(fixture);
  await writeFile(resolve(output, name), `${JSON.stringify(fixture, null, 2)}\n`);
}

await save("duplicate-probe.json", (fixture) => fixture.probes.push(structuredClone(fixture.probes[0])));
await save("invalid-transient-step.json", (fixture) => {
  fixture.settings.analysis = "transient";
  fixture.settings.step = "0";
});
await save("unsafe-color.json", (fixture) => { fixture.probes[0].color = "<b>red</b>"; });
await save("inert-marker.json", (fixture) => {
  fixture.title = '<b data-circuit-marker="012">MARK012</b>';
  fixture.probes[0].label = '<b data-circuit-marker="012">MARK012</b>';
});
