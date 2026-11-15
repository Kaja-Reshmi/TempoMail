import { spawn } from "node:child_process";

const processes = [
  spawn(process.execPath, ["src/server.js"], { stdio: "inherit" }),
  spawn(process.execPath, ["src/worker.js"], { stdio: "inherit" }),
];

let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of processes) {
    if (!child.killed) child.kill("SIGTERM");
  }

  setTimeout(() => process.exit(code), 1000).unref();
}

for (const child of processes) {
  child.on("error", (error) => {
    console.error("Process startup error:", error);
    shutdown(1);
  });

  child.on("exit", (code) => {
    if (!shuttingDown) {
      console.error("A service process exited unexpectedly.");
      shutdown(code || 1);
    }
  });
}

process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));
