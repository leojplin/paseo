import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { describe, expect, onTestFinished, test } from "vitest";

import type { AgentPersistenceHandle, AgentStreamEvent } from "../../agent-sdk-types.js";
import { capabilitiesForSession, PiRpcAgentClient } from "./agent.js";
import { PiHistorySession, readPiSessionHistoryEntries } from "./history-session.js";
import type { PiStartSessionInput } from "./runtime.js";
import { FakePi, type FakePiSession } from "./test-utils/fake-pi.js";

function writeSessionFile(lines: string[]): string {
  const dir = mkdtempSync(path.join(tmpdir(), "pi-history-session-"));
  onTestFinished(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const file = path.join(dir, "session.jsonl");
  writeFileSync(file, lines.join("\n") + "\n");
  return file;
}

function historyHandle(nativeHandle: string): AgentPersistenceHandle {
  return {
    provider: "pi",
    sessionId: "pi-session-1",
    nativeHandle,
    metadata: { cwd: "/workspace/project" },
  };
}

function timelineItems(events: AgentStreamEvent[]) {
  return events
    .filter((event) => event.type === "timeline")
    .map((event) => (event as { item: unknown }).item);
}

describe("readPiSessionHistoryEntries", () => {
  test("parses message and compaction entries in file order and skips unknown lines", () => {
    const file = writeSessionFile([
      JSON.stringify({ type: "session", id: "pi-session-1", version: 3 }),
      JSON.stringify({
        type: "message",
        id: "entry-1",
        parentId: null,
        message: { role: "user", content: "list files" },
      }),
      "not json at all",
      JSON.stringify({ type: "session_info", id: "x" }),
      JSON.stringify({
        type: "message",
        id: "entry-2",
        parentId: "entry-1",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "running ls" }],
        },
      }),
      JSON.stringify({ type: "compaction", id: "entry-3", tokensBefore: 4321 }),
      "",
    ]);

    expect(readPiSessionHistoryEntries(file)).toEqual([
      { kind: "message", message: { role: "user", content: "list files" }, id: "entry-1" },
      {
        kind: "message",
        message: { role: "assistant", content: [{ type: "text", text: "running ls" }] },
        id: "entry-2",
      },
      { kind: "compaction", preTokens: 4321 },
    ]);
  });
});

describe("PiHistorySession", () => {
  test("interactive operations are rejected and subscribe is inert", async () => {
    const session = new PiHistorySession({
      provider: "pi",
      handle: historyHandle("/nonexistent/session.jsonl"),
      config: { provider: "pi", cwd: "/workspace/project" },
      capabilities: capabilitiesForSession(true),
      logger: pino({ level: "silent" }),
      readMessagesFallback: async () => {
        throw new Error("fallback should not run");
      },
    });

    expect(session.id).toBe("pi-session-1");
    await expect(session.run("hi")).rejects.toThrow(/cannot start a turn/);
    await expect(session.startTurn("hi")).rejects.toThrow(/cannot start a turn/);
    await expect(session.setMode("mode")).rejects.toThrow(/cannot change mode/);
    await expect(session.respondToPermission("req-1", {} as never)).rejects.toThrow(
      /pending permissions/,
    );
    expect(session.subscribe(() => undefined)).toBeTypeOf("function");
    expect(session.getPendingPermissions()).toEqual([]);
    expect(session.describePersistence()).toMatchObject({ sessionId: "pi-session-1" });
  });

  test("replays the persisted session file without starting a runtime", async () => {
    const pi = new FakePi();
    const client = new PiRpcAgentClient({
      logger: pino({ level: "silent" }),
      runtime: pi,
    });
    const sessionFile = writeSessionFile([
      JSON.stringify({ type: "session", id: "pi-session-1", version: 3 }),
      JSON.stringify({
        type: "message",
        id: "entry-1",
        parentId: null,
        message: { role: "user", content: "list files" },
      }),
      JSON.stringify({
        type: "message",
        id: "entry-2",
        parentId: "entry-1",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "let me check" },
            { type: "text", text: "running ls" },
            { type: "toolCall", id: "call-1", name: "bash", arguments: '{"command":"ls"}' },
          ],
        },
      }),
      JSON.stringify({ type: "compaction", id: "entry-3", tokensBefore: 4321 }),
      JSON.stringify({
        type: "message",
        id: "entry-4",
        parentId: "entry-2",
        message: {
          role: "toolResult",
          toolCallId: "call-1",
          toolName: "bash",
          content: [{ type: "text", text: "file-a\nfile-b" }],
        },
      }),
    ]);

    const session = (await client.resumeSession(historyHandle(sessionFile), undefined, undefined, {
      purpose: "history",
    })) as PiHistorySession;

    expect(pi.recordedLaunches).toHaveLength(0);

    const events: AgentStreamEvent[] = [];
    for await (const event of session.streamHistory()) {
      events.push(event);
    }

    expect(timelineItems(events)).toEqual([
      { type: "user_message", text: "list files", messageId: "entry-1" },
      { type: "reasoning", text: "let me check" },
      { type: "assistant_message", text: "running ls", messageId: expect.any(String) },
      {
        type: "tool_call",
        callId: "call-1",
        name: "bash",
        status: "running",
        detail: { type: "shell", command: "ls", output: undefined, exitCode: undefined },
        error: null,
      },
      { type: "compaction", status: "completed", preTokens: 4321 },
      {
        type: "tool_call",
        callId: "call-1",
        name: "bash",
        status: "completed",
        detail: { type: "shell", command: "ls", output: "file-a\nfile-b", exitCode: null },
        error: null,
      },
    ]);

    await expect(session.getRuntimeInfo()).resolves.toMatchObject({
      provider: "pi",
      sessionId: "pi-session-1",
    });
  });

  test("falls back to a bounded runtime read when the session file is unreadable", async () => {
    const closed: FakePiSession[] = [];
    class SpyingPi extends FakePi {
      override async startSession(input: PiStartSessionInput): Promise<FakePiSession> {
        const session = await super.startSession(input);
        const originalClose = session.close.bind(session);
        session.close = async () => {
          closed.push(session);
          await originalClose();
        };
        return session;
      }
    }
    const pi = new SpyingPi();
    const client = new PiRpcAgentClient({
      logger: pino({ level: "silent" }),
      runtime: pi,
    });
    pi.queueSessionSetup((session) => {
      session.messages = [
        { role: "user", content: "hello from runtime" },
        { role: "assistant", content: [{ type: "text", text: "hi back" }] },
      ];
    });

    const session = (await client.resumeSession(
      historyHandle("/nonexistent/session.jsonl"),
      undefined,
      undefined,
      { purpose: "history" },
    )) as PiHistorySession;

    const events: AgentStreamEvent[] = [];
    for await (const event of session.streamHistory()) {
      events.push(event);
    }

    expect(pi.recordedLaunches).toHaveLength(1);
    expect(closed).toHaveLength(1);
    expect(timelineItems(events)).toEqual([
      { type: "user_message", text: "hello from runtime" },
      { type: "assistant_message", text: "hi back", messageId: expect.any(String) },
    ]);
  });
});
