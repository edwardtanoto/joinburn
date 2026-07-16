import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { BRAND } from "@joinburn/shared";
import { CONFIG_DIR } from "./config";

const LABEL = `app.${BRAND.cliName}.sync`;
const INTERVAL_SEC = 30 * 60;
const MAX_LOG_BYTES = 2 * 1024 * 1024;

type ManagedCliSourceOptions = {
  fileExists?: (file: string) => boolean;
  realpath?: (file: string) => string;
};

function nodeBin(): string {
  return process.execPath;
}

export function resolveManagedCliSource(
  argvEntry = process.argv[1] ?? "",
  options: ManagedCliSourceOptions = {},
): string {
  const fileExists = options.fileExists ?? existsSync;
  const resolveRealpath = options.realpath ?? realpathSync;
  const requested = argvEntry ? path.resolve(argvEntry) : "";
  if (!requested || !fileExists(requested)) {
    throw new Error("The background collector requires the bundled Burn CLI. Re-run the install instruction from the app.");
  }

  let source: string;
  try {
    // npm and npx invoke package binaries through an extensionless `.bin`
    // symlink. Resolve it before checking the bundled JavaScript entrypoint.
    source = resolveRealpath(requested);
  } catch {
    throw new Error("The background collector requires the bundled Burn CLI. Re-run the install instruction from the app.");
  }
  if (!/\.(?:m?js|cjs)$/.test(source)) {
    throw new Error("The background collector requires the bundled Burn CLI. Re-run the install instruction from the app.");
  }
  return source;
}

function managedCliEntry(): string {
  const destination = path.join(CONFIG_DIR, "cli.mjs");
  const source = resolveManagedCliSource();
  if (source === destination) return destination;
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  copyFileSync(source, destination);
  chmodSync(destination, 0o700);
  return destination;
}

function logsDirectory(): string {
  return path.join(CONFIG_DIR, "logs");
}

function logPath(kind: "out" | "err"): string {
  return path.join(logsDirectory(), `${LABEL}.${kind}.log`);
}

function xml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function systemdQuote(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function renderLaunchdPlist(input: {
  entry: string;
  environmentPath: string;
  node: string;
  stderrPath: string;
  stdoutPath: string;
}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${xml(LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(input.node)}</string>
    <string>${xml(input.entry)}</string>
    <string>sync</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>${xml(input.environmentPath)}</string></dict>
  <key>StartInterval</key><integer>${INTERVAL_SEC}</integer>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${xml(input.stdoutPath)}</string>
  <key>StandardErrorPath</key><string>${xml(input.stderrPath)}</string>
</dict>
</plist>
`;
}

export function renderSystemdService(node: string, entry: string): string {
  return `[Unit]\nDescription=${BRAND.displayName} usage sync\n\n[Service]\nType=oneshot\nExecStart=${systemdQuote(node)} ${systemdQuote(entry)} sync\n`;
}

export function renderSystemdTimer(): string {
  return `[Unit]\nDescription=${BRAND.displayName} sync every 30 minutes\n\n[Timer]\nOnBootSec=2min\nOnUnitActiveSec=30min\nPersistent=true\n\n[Install]\nWantedBy=timers.target\n`;
}

export function windowsTaskArguments(node: string, entry: string): string[] {
  const command = `"${node}" "${entry}" sync`;
  return ["/Create", "/F", "/SC", "MINUTE", "/MO", "30", "/TN", LABEL, "/TR", command];
}

export function rotateDaemonLogs(): void {
  if (os.platform() !== "darwin") return;
  for (const kind of ["out", "err"] as const) {
    const file = logPath(kind);
    try {
      if (statSync(file).size <= MAX_LOG_BYTES) continue;
      const previous = `${file}.1`;
      try {
        unlinkSync(previous);
      } catch {}
      renameSync(file, previous);
    } catch {}
  }
}

export function installDaemon(): string {
  const platform = os.platform();
  const entry = managedCliEntry();
  if (platform === "darwin") return installLaunchd(entry);
  if (platform === "linux") return installSystemd(entry);
  if (platform === "win32") return installWindowsTask(entry);
  throw new Error(`Automatic background sync is not supported on ${platform}.`);
}

export function uninstallDaemon(): string {
  const platform = os.platform();
  if (platform === "darwin") {
    const plist = plistPath();
    const domain = launchdDomain();
    try {
      execFileSync("launchctl", ["bootout", domain, plist], { stdio: "ignore" });
    } catch {
      try {
        execFileSync("launchctl", ["unload", plist], { stdio: "ignore" });
      } catch {}
    }
    try {
      unlinkSync(plist);
    } catch {}
    return `removed ${plist}`;
  }
  if (platform === "linux") {
    try {
      execFileSync("systemctl", ["--user", "disable", "--now", `${LABEL}.timer`], { stdio: "ignore" });
    } catch {}
    const base = systemdDir();
    for (const file of [`${LABEL}.service`, `${LABEL}.timer`]) {
      try {
        unlinkSync(path.join(base, file));
      } catch {}
    }
    try {
      execFileSync("systemctl", ["--user", "daemon-reload"], { stdio: "ignore" });
    } catch {}
    return "removed systemd user timer";
  }
  if (platform === "win32") {
    try {
      execFileSync("schtasks.exe", ["/Delete", "/F", "/TN", LABEL], { stdio: "ignore" });
    } catch {}
    return "removed Windows scheduled task";
  }
  return "No daemon was installed on this platform.";
}

function plistPath(): string {
  return path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
}

function launchdDomain(): string {
  const uid = typeof process.getuid === "function" ? process.getuid() : Number(execFileSync("id", ["-u"], { encoding: "utf8" }).trim());
  return `gui/${uid}`;
}

function installLaunchd(entry: string): string {
  const plist = plistPath();
  const logs = logsDirectory();
  mkdirSync(path.dirname(plist), { recursive: true, mode: 0o700 });
  mkdirSync(logs, { recursive: true, mode: 0o700 });
  const environmentPath = process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin";
  const contents = renderLaunchdPlist({
    entry,
    environmentPath,
    node: nodeBin(),
    stdoutPath: logPath("out"),
    stderrPath: logPath("err"),
  });
  writeFileSync(plist, contents, { mode: 0o600 });
  chmodSync(plist, 0o600);
  const domain = launchdDomain();
  try {
    execFileSync("launchctl", ["bootout", domain, plist], { stdio: "ignore" });
  } catch {}
  try {
    execFileSync("launchctl", ["bootstrap", domain, plist], { stdio: "ignore" });
  } catch {
    execFileSync("launchctl", ["load", plist], { stdio: "ignore" });
  }
  return `launchd agent loaded (${plist}), syncs every 30 min`;
}

function systemdDir(): string {
  return path.join(os.homedir(), ".config", "systemd", "user");
}

function installSystemd(entry: string): string {
  const directory = systemdDir();
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(
    path.join(directory, `${LABEL}.service`),
    renderSystemdService(nodeBin(), entry),
    { mode: 0o600 },
  );
  writeFileSync(
    path.join(directory, `${LABEL}.timer`),
    renderSystemdTimer(),
    { mode: 0o600 },
  );
  execFileSync("systemctl", ["--user", "daemon-reload"], { stdio: "ignore" });
  execFileSync("systemctl", ["--user", "enable", "--now", `${LABEL}.timer`], { stdio: "ignore" });
  return "systemd user timer enabled, syncs every 30 min";
}

function installWindowsTask(entry: string): string {
  execFileSync("schtasks.exe", windowsTaskArguments(nodeBin(), entry), { stdio: "ignore" });
  return "Windows scheduled task enabled, syncs every 30 min";
}
