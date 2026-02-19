const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

if (process.platform !== "win32") {
  console.error("[TracerUpdater] This updater helper is only supported on Windows.");
  process.exit(1);
}

const installerPath = process.argv[2];
if (!installerPath) {
  console.error("Usage: npm run update:installed -- \"C:\\path\\to\\Tracer-Setup-x.y.z.exe\"");
  process.exit(1);
}
const extraArgs = process.argv.slice(3);

const resolvedInstallerPath = path.resolve(installerPath);
if (!fs.existsSync(resolvedInstallerPath)) {
  console.error(`[TracerUpdater] Installer file not found: ${resolvedInstallerPath}`);
  process.exit(1);
}

const scriptPath = path.join(__dirname, "update-installed.ps1");
const psArgs = [
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-File",
  scriptPath,
  "-InstallerPath",
  resolvedInstallerPath,
  ...extraArgs
];

const child = spawn("powershell.exe", psArgs, { stdio: "inherit" });
child.on("exit", (code) => {
  process.exit(code ?? 1);
});
child.on("error", (error) => {
  console.error(`[TracerUpdater] Failed to launch updater: ${error.message}`);
  process.exit(1);
});
