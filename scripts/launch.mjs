/** Start one local server, then open its confirmed URL. Keep this console to stop it. */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2), noBrowser = args.includes("--no-browser");
const portArg = args.find(arg => /^\d+$/.test(arg)) ?? "4173";
if (Number(process.versions.node.split(".")[0]) < 20) throw new Error("Circuit Lab requires Node.js 20 or newer.");
const child = spawn(process.execPath, [fileURLToPath(new URL("../server.mjs", import.meta.url)), portArg], { cwd: root, stdio: ["inherit", "pipe", "pipe"] });
let opened = false, buffer = "";
child.stdout.on("data", bytes => {
  process.stdout.write(bytes); buffer += bytes.toString("utf8");
  const url = buffer.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
  if (!url || opened) return;
  opened = true;
  console.log("Stop Circuit Lab: Ctrl+C in this window. No automatic startup is installed.");
  if (noBrowser) return;
  const command = process.platform === "win32" ? ["cmd.exe", ["/d", "/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  const browser = spawn(command[0], command[1], { stdio: "ignore", windowsHide: true });
  browser.on("error", () => console.error(`Open this URL manually: ${url}`));
});
child.stderr.on("data", bytes => process.stderr.write(bytes));
child.on("error", error => { console.error(error.message); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 0; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { if (!child.killed) child.kill(); });
process.on("exit", () => { if (!child.killed) child.kill(); });
