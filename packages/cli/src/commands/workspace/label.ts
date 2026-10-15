import type { Command } from "commander";
import {
  normalizeWorkspaceLabelName,
  workspaceLabelKey,
  WORKSPACE_LABEL_COLORS,
  type WorkspaceLabelColor,
  type WorkspaceLabelDefinition,
} from "@getpaseo/protocol/workspace-labels";
import { connectToDaemon, getDaemonHost } from "../../utils/client.js";
import type { CommandError, ListResult, OutputSchema, SingleResult } from "../../output/index.js";

export interface WorkspaceLabelRow {
  name: string;
  color: string;
}

export interface WorkspaceLabelAssignmentRow {
  workspaceId: string;
  label: string;
  assigned: boolean;
  workspaceLabels: string[];
}

const workspaceLabelListSchema: OutputSchema<WorkspaceLabelRow> = {
  idField: "name",
  columns: [
    { header: "NAME", field: "name", width: 24 },
    { header: "COLOR", field: "color", width: 12 },
  ],
};

const workspaceLabelAssignmentSchema: OutputSchema<WorkspaceLabelAssignmentRow> = {
  idField: "label",
  columns: [
    { header: "WORKSPACE ID", field: "workspaceId", width: 20 },
    { header: "LABEL", field: "label", width: 24 },
    { header: "ASSIGNED", field: "assigned", width: 10 },
    { header: "WORKSPACE LABELS", field: "workspaceLabels", width: 40 },
  ],
};

export interface WorkspaceLabelOptions {
  host?: string;
  daemonTarget: import("../../utils/daemon-target.js").DaemonTarget;
}

/**
 * Resolve requested label names against the daemon's label catalog. Names are
 * normalized and matched case-insensitively so `SLACK-TASK`, `slack task`,
 * and `slack-task` all resolve to the same catalog entry.
 */
export function resolveWorkspaceLabels(input: {
  requested: string[];
  catalog: WorkspaceLabelDefinition[];
}): WorkspaceLabelDefinition[] {
  const byKey = new Map(
    input.catalog.map((label) => [workspaceLabelKey(label.name), label] as const),
  );
  const resolved: WorkspaceLabelDefinition[] = [];
  const missing: string[] = [];
  for (const raw of input.requested) {
    const key = workspaceLabelKey(normalizeWorkspaceLabelName(raw));
    const found = byKey.get(key);
    if (found) {
      if (!resolved.some((label) => workspaceLabelKey(label.name) === key)) resolved.push(found);
    } else {
      missing.push(normalizeWorkspaceLabelName(raw));
    }
  }
  if (missing.length > 0) {
    throw {
      code: "UNKNOWN_LABEL",
      message: `Label not found: ${missing.join(", ")}`,
      details: `Available labels: ${
        input.catalog.map((label) => label.name).join(", ") || "(none)"
      }. Create it in the Paseo app or with: paseo workspace label create <name>`,
    } satisfies CommandError;
  }
  return resolved;
}

export async function runLabelCreateCommand(
  name: string,
  options: WorkspaceLabelCreateOptions,
  _command: Command,
): Promise<SingleResult<WorkspaceLabelRow>> {
  const normalized = normalizeWorkspaceLabelName(name);
  if (!normalized) {
    throw {
      code: "MISSING_LABEL",
      message: "Label name cannot be empty",
      details: "Usage: paseo workspace label create <name> [--color <color>]",
    } satisfies CommandError;
  }
  if (options.color !== undefined && !WORKSPACE_LABEL_COLORS.includes(options.color)) {
    throw {
      code: "INVALID_COLOR",
      message: `Unknown label color: ${options.color}`,
      details: `Available colors: ${WORKSPACE_LABEL_COLORS.join(", ")}`,
    } satisfies CommandError;
  }

  const host = getDaemonHost({ target: options.daemonTarget });
  const client = await connectToDaemon({ target: options.daemonTarget }).catch(
    (error: unknown): never => {
      const message = error instanceof Error ? error.message : String(error);
      throw {
        code: "DAEMON_NOT_RUNNING",
        message: `Cannot connect to daemon at ${host}: ${message}`,
      } satisfies CommandError;
    },
  );
  try {
    const payload = await client.updateWorkspaceLabel({
      name: normalized,
      ...(options.color === undefined ? {} : { color: options.color }),
    });
    return {
      type: "single",
      data: { name: payload.label.name, color: payload.label.color },
      schema: workspaceLabelListSchema,
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw { code: "WORKSPACE_LABEL_FAILED", message } satisfies CommandError;
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function runLabelListCommand(
  options: WorkspaceLabelOptions,
  _command: Command,
): Promise<ListResult<WorkspaceLabelRow>> {
  const host = getDaemonHost({ target: options.daemonTarget });
  const client = await connectToDaemon({ target: options.daemonTarget }).catch(
    (error: unknown): never => {
      const message = error instanceof Error ? error.message : String(error);
      throw {
        code: "DAEMON_NOT_RUNNING",
        message: `Cannot connect to daemon at ${host}: ${message}`,
      } satisfies CommandError;
    },
  );
  try {
    const payload = await client.listWorkspaceLabels();
    return {
      type: "list",
      data: payload.labels.map((label) => ({ name: label.name, color: label.color })),
      schema: workspaceLabelListSchema,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export interface WorkspaceLabelSetOptions extends WorkspaceLabelOptions {
  remove?: boolean;
}

export interface WorkspaceLabelCreateOptions extends WorkspaceLabelOptions {
  color?: WorkspaceLabelColor;
}

export async function runLabelSetCommand(
  workspaceId: string,
  names: string[] | undefined,
  options: WorkspaceLabelSetOptions,
  _command: Command,
): Promise<ListResult<WorkspaceLabelAssignmentRow>> {
  const requested = (names ?? []).map((name) => normalizeWorkspaceLabelName(name)).filter(Boolean);
  if (requested.length === 0) {
    throw {
      code: "MISSING_LABEL",
      message: "At least one label name is required",
      details: "Usage: paseo workspace label set <workspace-id> <name...> [--remove]",
    } satisfies CommandError;
  }

  const host = getDaemonHost({ target: options.daemonTarget });
  const client = await connectToDaemon({ target: options.daemonTarget }).catch(
    (error: unknown): never => {
      const message = error instanceof Error ? error.message : String(error);
      throw {
        code: "DAEMON_NOT_RUNNING",
        message: `Cannot connect to daemon at ${host}: ${message}`,
      } satisfies CommandError;
    },
  );
  try {
    const catalog = await client.listWorkspaceLabels();
    const resolved = resolveWorkspaceLabels({ requested, catalog: catalog.labels });
    const assigned = options.remove !== true;
    const rows: WorkspaceLabelAssignmentRow[] = [];
    for (const label of resolved) {
      const payload = await client.setWorkspaceLabel({
        workspaceId,
        label,
        assigned,
      });
      rows.push({
        workspaceId,
        label: payload.label.name,
        assigned,
        workspaceLabels: payload.workspaceLabels,
      });
    }
    return { type: "list", data: rows, schema: workspaceLabelAssignmentSchema };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw { code: "WORKSPACE_LABEL_FAILED", message } satisfies CommandError;
  } finally {
    await client.close().catch(() => undefined);
  }
}
