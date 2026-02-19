const { execSync } = require("node:child_process");

const PORT = 5173;
const SAFE_IMAGES = new Set(["node", "electron"]);

function run(command) {
  return execSync(command, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function runPowerShell(command) {
  const escaped = command.replace(/"/g, '\\"');
  return run(`powershell -NoProfile -Command "${escaped}"`);
}

function getListeningPids(port) {
  const output = runPowerShell(
    `$ErrorActionPreference='SilentlyContinue'; Get-NetTCPConnection -LocalPort ${port} -State Listen | Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique`
  );
  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => /^\d+$/u.test(line))
    .map((line) => Number(line));
}

function getImageName(pid) {
  const output = runPowerShell(
    `$p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if($p){$p.ProcessName}`
  );
  return output.trim().toLowerCase() || null;
}

function main() {
  let pids;
  try {
    pids = getListeningPids(PORT);
  } catch {
    return;
  }

  if (pids.length === 0) {
    return;
  }

  for (const pid of pids) {
    const imageName = getImageName(pid);
    if (!imageName) {
      continue;
    }

    if (!SAFE_IMAGES.has(imageName)) {
      console.error(
        `[predev] Port ${PORT} is occupied by ${imageName} (PID ${pid}). Stop it manually before running dev.`
      );
      process.exit(1);
    }

    try {
      run(`taskkill /PID ${pid} /F`);
      console.log(`[predev] Stopped ${imageName} (PID ${pid}) using port ${PORT}.`);
    } catch (error) {
      console.error(`[predev] Failed to stop PID ${pid} on port ${PORT}.`, error);
      process.exit(1);
    }
  }
}

main();
