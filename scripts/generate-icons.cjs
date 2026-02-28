const path = require("node:path");
const { spawnSync } = require("node:child_process");

const scriptPath = path.resolve(__dirname, "generate_app_icons.py");

const candidates =
  process.platform === "win32"
    ? [
        { command: "python", args: [] },
        { command: "py", args: ["-3"] },
        { command: "py", args: [] }
      ]
    : [
        { command: "python3", args: [] },
        { command: "python", args: [] }
      ];

let sawExecutionError = false;

for (const candidate of candidates) {
  const result = spawnSync(candidate.command, [...candidate.args, scriptPath], {
    stdio: "inherit"
  });

  if (result.error) {
    if (result.error.code === "ENOENT") {
      continue;
    }
    sawExecutionError = true;
    console.error(
      `[generate:icons] Failed to execute '${candidate.command}': ${result.error.message}`
    );
    continue;
  }

  if (typeof result.status === "number") {
    process.exit(result.status);
  }

  process.exit(1);
}

if (!sawExecutionError) {
  console.error(
    "[generate:icons] Python not found. Install Python 3 and ensure 'python3' (macOS/Linux) or 'python'/'py' (Windows) is in PATH."
  );
}

process.exit(1);
