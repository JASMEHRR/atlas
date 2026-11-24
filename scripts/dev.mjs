#!/usr/bin/env node
/**
 * Dev launcher: starts `next dev` and opens the browser once the server is
 * actually listening. Streams Next's output through untouched.
 *
 * Skip the auto-open with:  npm run dev -- --no-open   (or ATLAS_NO_OPEN=1)
 */
import { spawn } from "node:child_process";
import process from "node:process";

const args = process.argv.slice(2);
const noOpen =
  process.env.ATLAS_NO_OPEN === "1" || args.includes("--no-open");
const nextArgs = args.filter((a) => a !== "--no-open");

const child = spawn(
  process.platform === "win32" ? "next.cmd" : "next",
  ["dev", ...nextArgs],
  { stdio: ["inherit", "pipe", "inherit"], shell: process.platform === "win32" },
);

let opened = false;

/** Open a URL in the user's default browser, cross-platform. */
function openBrowser(url) {
  if (opened || noOpen) return;
  opened = true;

  const [cmd, cmdArgs] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];

  const opener = spawn(cmd, cmdArgs, { stdio: "ignore", detached: true });
  opener.on("error", () => {
    console.log(`\n  Open ${url} in your browser.\n`);
  });
  opener.unref();
}

child.stdout.on("data", (chunk) => {
  const text = chunk.toString();
  process.stdout.write(text);

  // Next prints e.g. "- Local:  http://localhost:3000" once it is listening.
  if (!opened) {
    const match = text.match(/https?:\/\/localhost:\d+/);
    if (match) {
      // Small grace period so the first request doesn't race the compiler.
      setTimeout(() => openBrowser(match[0]), 600);
    }
  }
});

child.on("exit", (code) => process.exit(code ?? 0));

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    child.kill(signal);
  });
}
