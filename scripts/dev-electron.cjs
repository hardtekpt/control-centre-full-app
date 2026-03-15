const { spawn } = require("node:child_process");
const electronBinary = require("electron");

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
env.VITE_DEV_SERVER_URL = env.VITE_DEV_SERVER_URL || "http://localhost:5180";

const child = spawn(electronBinary, [".electron-build/main/index.js"], {
  stdio: "inherit",
  env,
  windowsHide: false,
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
