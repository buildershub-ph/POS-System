import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const PORT = 4173;
const BASE_URL = `http://localhost:${PORT}`;
const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const nextBin = path.join(projectRoot, "node_modules", ".bin", "next");

let server;

test.before(async () => {
  server = spawn(nextBin, ["start", "--port", String(PORT)], {
    cwd: projectRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let ready = false;
  server.stdout.on("data", (chunk) => {
    if (chunk.toString().includes("Ready")) ready = true;
  });
  const timeout = Date.now() + 60_000;
  while (!ready && Date.now() < timeout) {
    if (server.exitCode !== null) throw new Error("Next.js server exited before it was ready.");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error("Next.js server did not become ready in time.");
});

test.after(async () => {
  if (!server) return;
  server.kill();
  await once(server, "exit").catch(() => undefined);
});

test("server-renders the inventory dashboard", async () => {
  const response = await fetch(`${BASE_URL}/`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Builder&#x27;s Hub/);
  assert.doesNotMatch(html, /unit cost|landed cost|gross margin/i);
});

test("core workflow routes render", async () => {
  for (const path of ["/inventory", "/receive", "/scan", "/cashier", "/login"]) {
    const response = await fetch(`${BASE_URL}${path}`);
    assert.equal(response.status, 200, `${path} should render`);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  }
});
