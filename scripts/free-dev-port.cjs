const { execSync } = require("node:child_process");

/**
 * Returns a list of PIDs currently bound to the requested local TCP port.
 * We avoid relying on a specific state label (for example "LISTENING") so this works across locales.
 */
function getPortPids(port) {
  try {
    const output = execSync("netstat -ano -p tcp", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const lines = output.split(/\r?\n/);
    const pids = new Set();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      const parts = trimmed.split(/\s+/);
      if (parts.length < 4) {
        continue;
      }

      const protocol = parts[0].toUpperCase();
      if (protocol !== "TCP") {
        continue;
      }

      const localAddress = parts[1];
      const pidValue = Number(parts[parts.length - 1]);
      const localPort = Number(localAddress.slice(localAddress.lastIndexOf(":") + 1));

      if (localPort === port && Number.isFinite(pidValue) && pidValue > 0) {
        pids.add(pidValue);
      }
    }

    return [...pids];
  } catch {
    return [];
  }
}

/**
 * Tries to terminate each PID and keeps going if one fails.
 */
function killPids(pids) {
  for (const pid of pids) {
    if (pid === process.pid) {
      continue;
    }
    try {
      execSync(`taskkill /PID ${pid} /F`, { stdio: ["ignore", "pipe", "pipe"] });
      console.log(`[free-dev-port] Freed port by terminating PID ${pid}.`);
    } catch {
      console.warn(`[free-dev-port] Could not terminate PID ${pid}. You may need elevated permissions.`);
    }
  }
}

function main() {
  const requested = Number(process.argv[2] ?? "5173");
  const port = Number.isFinite(requested) && requested > 0 ? requested : 5173;
  const pids = getPortPids(port);

  if (pids.length === 0) {
    console.log(`[free-dev-port] Port ${port} is already free.`);
    return;
  }

  console.log(`[free-dev-port] Port ${port} is in use by PID(s): ${pids.join(", ")}.`);
  killPids(pids);
}

main();
