// Regression test for getpaseo/paseo#6511: fetching the timeline of an archived
// agent must not start a live provider runtime. The Pi provider serves history from
// the persisted session file (PiHistorySession) for `purpose: "history"` loads, so
// viewing an archived conversation leaves no process behind.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { expect, test } from "vitest";

import { PiRpcAgentClient } from "../agent/providers/pi/agent.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";

const MARKER = "paseo-regression-archived-history";

function allPids(): Map<number, string> {
  const out = spawnSync("ps", ["-eo", "pid=,command="]).stdout.toString();
  const map = new Map<number, string>();
  for (const line of out.split("\n")) {
    const pid = Number.parseInt(line.trimStart(), 10);
    if (Number.isFinite(pid) && pid > 0) map.set(pid, line.trim());
  }
  return map;
}

function processCwd(pid: number): string {
  try {
    const out = spawnSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]);
    return (
      out.stdout
        .toString()
        .split("\n")
        .find((l) => l.startsWith("n"))
        ?.slice(1) ?? "?"
    );
  } catch {
    return "?";
  }
}

/** New pids (not in `before`) whose cwd lives inside our temp tree. */
function ourNewProcesses(before: Map<number, string>): { pid: number; cmd: string }[] {
  const fresh: { pid: number; cmd: string }[] = [];
  for (const [pid, cmd] of allPids()) {
    if (before.has(pid)) continue;
    if (processCwd(pid).includes(MARKER)) fresh.push({ pid, cmd });
  }
  return fresh;
}

test(
  "fetch_agent_timeline for an ARCHIVED pi agent does not spawn a runtime",
  { timeout: 180_000 },
  async () => {
    const root = mkdtempSync(path.join(tmpdir(), MARKER + "-"));
    const cwd = path.join(root, "repo");
    mkdirSync(cwd);
    execFileSync("git", ["init", "-b", "main", cwd]);
    execFileSync(
      "git",
      [
        "-c",
        "user.name=QA",
        "-c",
        "user.email=qa@example.invalid",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "--allow-empty",
        "-m",
        "QA",
      ],
      { cwd },
    );

    const logger = pino({ level: "warn" });
    let daemon: TestPaseoDaemon | undefined;
    let client: DaemonClient | undefined;
    try {
      daemon = await createTestPaseoDaemon({
        agentClients: { pi: new PiRpcAgentClient({ logger }) },
        logger,
        pluginsEnabled: false,
      });
      client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws`, appVersion: "0.9.0" });
      await client.connect();

      const beforeAny = allPids();
      const agent = await client.createAgent({
        cwd,
        title: "archived-history-no-respawn",
        provider: "pi",
        model: "openrouter/google/gemini-2.5-flash-lite",
        thinkingOptionId: "medium",
      });

      const liveProcesses = ourNewProcesses(beforeAny);
      expect(liveProcesses.length).toBeGreaterThan(0);

      await client.archiveWorkspace(agent.workspaceId!);
      const archivedRecord = await daemon.daemon.agentStorage.get(agent.id);
      expect(archivedRecord?.archivedAt).toBeTruthy();

      // Give teardown a moment, then assert the process is really gone.
      await new Promise((r) => setTimeout(r, 3000));
      const stillAliveAfterArchive = liveProcesses.filter((p) => allPids().has(p.pid));
      expect(stillAliveAfterArchive).toEqual([]);

      // Do exactly what a stale relay client does: fetch the archived agent's
      // timeline. This must succeed (history stays viewable) without spawning a
      // provider process.
      const timeline = await client.fetchAgentTimeline(agent.id, { direction: "tail", limit: 10 });
      expect(timeline).toBeTruthy();

      const respawned = ourNewProcesses(beforeAny);
      expect(respawned.map((p) => p.pid)).toEqual([]);
    } finally {
      await client?.close?.();
      await daemon?.close?.();
    }
  },
);
