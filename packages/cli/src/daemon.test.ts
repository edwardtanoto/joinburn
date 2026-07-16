import { describe, expect, test } from "bun:test";
import { renderLaunchdPlist, renderSystemdService, renderSystemdTimer, windowsTaskArguments } from "./daemon";

describe("collector daemon definitions", () => {
  test("launchd runs the managed collector every 30 minutes without shell interpolation", () => {
    const plist = renderLaunchdPlist({
      node: "/Users/Burn & Team/node",
      entry: "/Users/Burn <Team>/.burnstats/cli.mjs",
      environmentPath: "/opt/homebrew/bin:/usr/bin",
      stdoutPath: "/tmp/burn.out",
      stderrPath: "/tmp/burn.err",
    });

    expect(plist).toContain("<key>StartInterval</key><integer>1800</integer>");
    expect(plist).toContain("<key>RunAtLoad</key><true/>");
    expect(plist).toContain("/Users/Burn &amp; Team/node");
    expect(plist).toContain("/Users/Burn &lt;Team&gt;/.burnstats/cli.mjs");
    expect(plist).not.toContain("/bin/sh");
  });

  test("systemd uses a persistent user timer and safely quotes paths", () => {
    const service = renderSystemdService("/home/burn tools/node", '/home/user/quote"path/cli.mjs');
    const timer = renderSystemdTimer();

    expect(service).toContain('ExecStart="/home/burn tools/node" "/home/user/quote\\"path/cli.mjs" sync');
    expect(timer).toContain("OnBootSec=2min");
    expect(timer).toContain("OnUnitActiveSec=30min");
    expect(timer).toContain("Persistent=true");
    expect(timer).toContain("WantedBy=timers.target");
  });

  test("Windows Task Scheduler invokes Node directly on a 30-minute cadence", () => {
    expect(windowsTaskArguments("C:\\Program Files\\node.exe", "C:\\Users\\Burn User\\.burnstats\\cli.mjs")).toEqual([
      "/Create",
      "/F",
      "/SC",
      "MINUTE",
      "/MO",
      "30",
      "/TN",
      "app.burnstats.sync",
      "/TR",
      '"C:\\Program Files\\node.exe" "C:\\Users\\Burn User\\.burnstats\\cli.mjs" sync',
    ]);
  });
});
