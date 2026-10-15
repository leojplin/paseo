import { describe, expect, it } from "vitest";
import { resolveWorkspaceLabels } from "./label.js";
import type { WorkspaceLabelDefinition } from "@getpaseo/protocol/workspace-labels";

const catalog: WorkspaceLabelDefinition[] = [
  { name: "slack-task", color: "sky" },
  { name: "Review Ready", color: "emerald" },
];

describe("resolveWorkspaceLabels", () => {
  it("resolves an exact name", () => {
    expect(resolveWorkspaceLabels({ requested: ["slack-task"], catalog })).toEqual([
      { name: "slack-task", color: "sky" },
    ]);
  });

  it("normalizes whitespace and case", () => {
    expect(resolveWorkspaceLabels({ requested: ["  SLACK-TASK  "], catalog })).toEqual([
      { name: "slack-task", color: "sky" },
    ]);
    expect(resolveWorkspaceLabels({ requested: ["review ready"], catalog })).toEqual([
      { name: "Review Ready", color: "emerald" },
    ]);
  });

  it("deduplicates repeated requests", () => {
    expect(
      resolveWorkspaceLabels({ requested: ["slack-task", "SLACK-TASK"], catalog }),
    ).toHaveLength(1);
  });

  it("preserves request order", () => {
    expect(
      resolveWorkspaceLabels({ requested: ["Review Ready", "slack-task"], catalog }).map(
        (label) => label.name,
      ),
    ).toEqual(["Review Ready", "slack-task"]);
  });

  it("rejects unknown labels and lists what is available", () => {
    try {
      resolveWorkspaceLabels({ requested: ["nope"], catalog });
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ code: "UNKNOWN_LABEL" });
      expect(String((error as { message?: string }).message)).toContain("Label not found: nope");
      expect(String((error as { details?: string }).details)).toContain("slack-task, Review Ready");
    }
  });

  it("reports every missing label at once", () => {
    try {
      resolveWorkspaceLabels({ requested: ["a", "slack-task", "b"], catalog });
      expect.unreachable();
    } catch (error) {
      expect((error as { code?: string }).code).toBe("UNKNOWN_LABEL");
      expect((error as { message?: string }).message).toContain("a, b");
    }
  });
});
