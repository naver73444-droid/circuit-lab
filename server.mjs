import http from "node:http";
import { readFile, realpath } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = await realpath(fileURLToPath(new URL(".", import.meta.url)));
const port = Number(process.argv[2] ?? 4173);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Port must be an integer from 0 to 65535.");
const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
};
const server = http.createServer(async (request, response) => {
  const reply = (status, text, extra = {}) => {
    response.writeHead(status, { ...headers, "Content-Type": "text/plain; charset=utf-8", ...extra });
    response.end(request.method === "HEAD" ? undefined : text);
  };
  if (!["GET", "HEAD"].includes(request.method)) return reply(405, "읽기 요청만 허용됩니다.", { Allow: "GET, HEAD" });
  try {
    // Explicitly local Host values prevent DNS-rebinding access via an unrelated origin.
    const host = new URL(`http://${request.headers.host ?? ""}`).hostname;
    if (!["127.0.0.1", "localhost"].includes(host)) return reply(403, "로컬 주소만 허용됩니다.");
    const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
    const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    // Serve only runtime assets; no .git, private config, reports, test fixtures, or exports.
    if (!["index.html", "styles.css"].includes(relative) && !/^src\/[A-Za-z0-9_-]+\.js$/.test(relative)) return reply(404, "찾을 수 없습니다.");
    const path = await realpath(resolve(root, relative));
    if (!path.startsWith(root + sep)) return reply(404, "찾을 수 없습니다.");
    const data = await readFile(path);
    response.writeHead(200, { ...headers, "Content-Type": mime[extname(path)] ?? "application/octet-stream", "Content-Length": data.length });
    response.end(request.method === "HEAD" ? undefined : data);
  } catch {
    reply(404, "찾을 수 없습니다.");
  }
});
server.on("error", (error) => { console.error(`Circuit Lab 서버를 시작하지 못했습니다: ${error.message}`); process.exitCode = 1; });
server.listen(port, "127.0.0.1", () => console.log(`Circuit Lab 실행 중: http://127.0.0.1:${server.address().port}`));
