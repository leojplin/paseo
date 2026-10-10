import { readFileSync } from "node:fs";

import type { Logger } from "pino";

import type {
  AgentCapabilityFlags,
  AgentPermissionResponse,
  AgentPersistenceHandle,
  AgentPromptInput,
  AgentProvider,
  AgentRunOptions,
  AgentRuntimeInfo,
  AgentSession,
  AgentSessionConfig,
  AgentStreamEvent,
} from "../../agent-sdk-types.js";
import {
  PiHistoryMapper,
  type PiCapturedUserMessageEntry,
  streamPiHistory,
} from "./history-mapper.js";
import type { PiAgentMessage } from "./rpc-types.js";

/**
 * A read-only entry from a persisted Pi session file. Pi writes one JSON object per
 * line; the ones relevant to history replay are `message` entries (which carry the
 * same message shape the RPC `getMessages` call returns) and `compaction` entries.
 */
export type PiSessionHistoryEntry =
  | { kind: "message"; message: PiAgentMessage; id?: string }
  | { kind: "compaction"; preTokens?: number };

/**
 * Parse a persisted Pi session file into ordered history entries. Tolerates unknown
 * or malformed lines by skipping them; a missing or unreadable file throws so the
 * caller can fall back to a bounded runtime read.
 */
export function readPiSessionHistoryEntries(sessionFile: string): PiSessionHistoryEntry[] {
  const raw = readFileSync(sessionFile, "utf8");
  const entries: PiSessionHistoryEntry[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) {
      continue;
    }
    const entry = parsed as Record<string, unknown>;
    const message = entry.message;
    if (
      typeof message === "object" &&
      message !== null &&
      typeof (message as Record<string, unknown>).role === "string"
    ) {
      entries.push({
        kind: "message",
        // Session files store tool-call arguments as JSON strings; the history mapper
        // expects them already parsed, matching what the RPC getMessages path returns.
        message: normalizePiSessionMessage(message as PiAgentMessage),
        ...(typeof entry.id === "string" ? { id: entry.id } : {}),
      });
      continue;
    }
    if (entry.type === "compaction") {
      entries.push({
        kind: "compaction",
        ...(typeof entry.tokensBefore === "number" ? { preTokens: entry.tokensBefore } : {}),
      });
    }
  }
  return entries;
}

function normalizePiSessionMessage(message: PiAgentMessage): PiAgentMessage {
  if (message.role !== "assistant" || !Array.isArray(message.content)) {
    return message;
  }
  const content = message.content.map((part) => {
    if (part.type !== "toolCall" || typeof part.arguments !== "string") {
      return part;
    }
    try {
      return { ...part, arguments: JSON.parse(part.arguments) as unknown };
    } catch {
      return part;
    }
  });
  return content.some((part, index) => part !== message.content[index])
    ? { ...message, content }
    : message;
}

export interface PiHistorySessionOptions {
  provider: AgentProvider;
  handle: AgentPersistenceHandle;
  config: AgentSessionConfig;
  capabilities: AgentCapabilityFlags;
  logger: Logger;
  /**
   * Bounded fallback for session files that cannot be read from disk (for example a
   * session stored inside a container). Implementations must read the messages and
   * release the runtime before resolving.
   */
  readMessagesFallback: () => Promise<PiAgentMessage[]>;
}

/**
 * Passive session for history loads (`purpose: "history"`), used when an archived
 * agent's timeline is fetched. It replays the persisted session file without ever
 * starting a provider runtime, so viewing an archived conversation leaves no
 * process behind. Interactive operations are rejected.
 */
export class PiHistorySession implements AgentSession {
  readonly provider: AgentProvider;
  readonly capabilities: AgentCapabilityFlags;

  private readonly handle: AgentPersistenceHandle;
  private readonly config: AgentSessionConfig;
  private readonly logger: Logger;
  private readonly readMessagesFallback: () => Promise<PiAgentMessage[]>;

  constructor(options: PiHistorySessionOptions) {
    this.provider = options.provider;
    this.handle = options.handle;
    this.config = options.config;
    this.capabilities = options.capabilities;
    this.logger = options.logger;
    this.readMessagesFallback = options.readMessagesFallback;
  }

  get id(): string | null {
    return this.handle.sessionId ?? null;
  }

  async run(_prompt: AgentPromptInput, _options?: AgentRunOptions): Promise<never> {
    throw new Error("Pi history session cannot start a turn");
  }

  async startTurn(_prompt: AgentPromptInput, _options?: AgentRunOptions): Promise<never> {
    throw new Error("Pi history session cannot start a turn");
  }

  subscribe(_callback: (event: AgentStreamEvent) => void): () => void {
    return () => undefined;
  }

  async *streamHistory(): AsyncGenerator<AgentStreamEvent> {
    let entries: PiSessionHistoryEntry[] | null = null;
    const sessionFile = this.handle.nativeHandle;
    if (sessionFile) {
      try {
        entries = readPiSessionHistoryEntries(sessionFile);
      } catch (error) {
        this.logger.debug(
          { err: error, sessionFile },
          "Pi session file unavailable for history read; falling back to bounded runtime read",
        );
      }
    }

    if (!entries) {
      const messages = await this.readMessagesFallback();
      yield* streamPiHistory(this.provider, messages, []);
      return;
    }

    // One mapper across the whole file keeps tool-call pairing and message indices
    // consistent, while entries are yielded in file order so compaction markers land
    // where they appeared in the conversation.
    yield* streamPiHistoryFromEntries(this.provider, entries);
  }

  async getRuntimeInfo(): Promise<AgentRuntimeInfo> {
    return {
      provider: this.provider,
      sessionId: this.handle.sessionId ?? null,
      model: this.config.model ?? null,
      thinkingOptionId: this.config.thinkingOptionId ?? null,
      modeId: this.config.modeId ?? null,
    };
  }

  async getAvailableModes(): Promise<never[]> {
    return [];
  }

  async getCurrentMode(): Promise<string | null> {
    return this.config.modeId ?? null;
  }

  async setMode(_modeId: string): Promise<never> {
    throw new Error("Pi history session cannot change mode");
  }

  getPendingPermissions(): [] {
    return [];
  }

  async respondToPermission(
    _requestId: string,
    _response: AgentPermissionResponse,
  ): Promise<never> {
    throw new Error("Pi history session has no pending permissions");
  }

  describePersistence(): AgentPersistenceHandle {
    return this.handle;
  }

  async interrupt(): Promise<void> {}

  async close(): Promise<void> {}
}

async function* streamPiHistoryFromEntries(
  provider: AgentProvider,
  entries: readonly PiSessionHistoryEntry[],
): AsyncGenerator<AgentStreamEvent> {
  // One entry per user-role message keeps the mapper's index pairing aligned: it
  // advances its user index for every user message and looks the id up by position.
  const userEntries: PiCapturedUserMessageEntry[] = [];
  for (const entry of entries) {
    if (entry.kind === "message" && (entry.message as { role?: string }).role === "user") {
      userEntries.push({
        id: entry.id ?? `pi-history-user-${userEntries.length + 1}`,
        text: "",
      });
    }
  }
  const mapper = new PiHistoryMapper(provider, userEntries);
  for (const entry of entries) {
    if (entry.kind === "compaction") {
      yield {
        type: "timeline",
        provider,
        item: {
          type: "compaction",
          status: "completed",
          ...(entry.preTokens === undefined ? {} : { preTokens: entry.preTokens }),
        },
      };
      continue;
    }
    for (const event of mapper.mapMessages([entry.message])) {
      yield event;
    }
  }
}
