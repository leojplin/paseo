import { useCallback } from "react";
import { useToast } from "@/contexts/toast-context";
import { useForkAgent } from "@/hooks/use-fork-agent";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { useSessionStore } from "@/stores/session-store";
import {
  collectAllTabs,
  findPaneById,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";

const WORKSPACE_FORK_ACTIONS = ["workspace.fork"] as const;

// Headless host for the fork shortcut, like WorkspacePinShortcutHandler. The focused tab and the
// agent record are read at keypress time via store getState(), so layout and agent churn never
// re-render the app shell; only the route selection subscription is live.
export function WorkspaceForkShortcutHandler() {
  const toast = useToast();
  const selection = useActiveWorkspaceSelection();
  const serverId = selection?.serverId ?? null;
  const workspaceId = selection?.workspaceId ?? null;
  const forkAgent = useForkAgent({ serverId: serverId ?? "", toast });

  const handle = useCallback(() => {
    if (!serverId || !workspaceId) {
      return false;
    }
    // forkAgent's serverId placeholder is never used: the guard above keeps
    // handle from reaching it without a real selection.
    const workspaceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
    const layout = workspaceKey
      ? (useWorkspaceLayoutStore.getState().layoutByWorkspace[workspaceKey] ?? null)
      : null;
    const focusedPane = layout ? findPaneById(layout.root, layout.focusedPaneId) : null;
    const focusedTabId = focusedPane?.focusedTabId ?? null;
    const focusedTab =
      layout && focusedTabId
        ? (collectAllTabs(layout.root).find((tab) => tab.tabId === focusedTabId) ?? null)
        : null;
    const agentId = focusedTab?.target.kind === "agent" ? focusedTab.target.agentId : null;
    const agent = agentId
      ? (useSessionStore.getState().sessions[serverId]?.agents.get(agentId) ?? null)
      : null;
    if (!agent) {
      return false;
    }
    // No boundary: forks the whole timeline up to now, the same as the in-flight
    // turn-footer fork.
    void forkAgent({ agentId: agent.id, agent, workspaceId, target: "workspace" });
    return true;
  }, [forkAgent, serverId, workspaceId]);

  useKeyboardActionHandler({
    handlerId: "workspace-fork-global",
    actions: WORKSPACE_FORK_ACTIONS,
    enabled: serverId !== null && workspaceId !== null,
    priority: 0,
    handle,
  });

  return null;
}
