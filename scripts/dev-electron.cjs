const { spawn } = require("node:child_process");
const path = require("node:path");

const electronBinary = require("electron");
const entrypoint = path.resolve(__dirname, "..", "dist", "main", "main.js");

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
env.PLAYWRIGHT_BROWSERS_PATH = "0";
env.VITE_DEV_SERVER_URL = "http://localhost:5173";

const child = spawn(electronBinary, [entrypoint], {
  stdio: "inherit",
  env
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
