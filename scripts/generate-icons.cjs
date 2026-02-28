const path = require("node:path");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

const scriptPath = path.resolve(__dirname, "generate_app_icons.py");
const buildDir = path.resolve(__dirname, "..", "build");
const requiredIcons = ["icon.png", "icon.ico", "icon.icns"];

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
let sawScriptFailure = false;
const failureMessages = [];

function hasPrebuiltIcons() {
  return requiredIcons.every((fileName) => fs.existsSync(path.join(buildDir, fileName)));
}

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
    if (result.status === 0) {
      process.exit(0);
    }
    sawScriptFailure = true;
    failureMessages.push(
      `[generate:icons] '${candidate.command} ${candidate.args.join(" ")}' exited with code ${result.status}.`
    );
    continue;
  }

  process.exit(1);
}

if (hasPrebuiltIcons()) {
  if (sawScriptFailure || sawExecutionError) {
    console.warn(
      "[generate:icons] Icon generation failed, but prebuilt icons already exist in ./build. Continuing build."
    );
    if (failureMessages.length > 0) {
      console.warn(failureMessages.join("\n"));
    }
    console.warn(
      "[generate:icons] To regenerate icons locally, install Pillow: python3 -m pip install pillow"
    );
  }
  process.exit(0);
}

if (!sawExecutionError && !sawScriptFailure) {
  console.error(
    "[generate:icons] Python not found. Install Python 3 and ensure 'python3' (macOS/Linux) or 'python'/'py' (Windows) is in PATH."
  );
} else if (failureMessages.length > 0) {
  console.error(failureMessages.join("\n"));
  console.error(
    "[generate:icons] To generate icons from source, install Pillow: python3 -m pip install pillow"
  );
}

process.exit(1);
