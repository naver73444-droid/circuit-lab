import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const port = Number(process.argv[2] ?? 4189);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const originalTag = '<script type="module" src="/src/app.js"></script>';
const verificationTag = '<script type="module" src="/scripts/verification/attempt-02-instrumentation.js"></script>';

const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
    if (pathname === "/" || pathname === "/verify-attempt-02") {
      const original = await readFile(resolve(root, "index.html"), "utf8");
      if (!original.includes(originalTag)) throw new Error("Expected product module tag was not found");
      const page = original.replace(originalTag, verificationTag);
      response.writeHead(200, { "Content-Type": mime[".html"], "Cache-Control": "no-store", "X-Circuit-Verification": "CIRCUIT-008-attempt-02" });
      response.end(page);
      return;
    }
    const relative = pathname.replace(/^\/+/, "");
    const path = resolve(root, relative);
    const boundary = root.endsWith(sep) ? root : `${root}${sep}`;
    if (path === root || !path.startsWith(boundary)) throw new Error("outside root");
    const data = await readFile(path);
    response.writeHead(200, { "Content-Type": mime[extname(path)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    response.end(data);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("찾을 수 없습니다.");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`CIRCUIT-008 attempt-02 verification: http://127.0.0.1:${port}/verify-attempt-02`);
});
