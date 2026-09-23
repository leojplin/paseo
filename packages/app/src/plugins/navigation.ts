import { buildPluginSettingsRoute } from "./settings/routes";
import { router } from "expo-router";
import type { PluginPanelLocation } from "@getpaseo/plugin/client";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useCreateFlowStore } from "@/stores/create-flow-store";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { normalizeWorkspaceDescriptor } from "@/stores/session-store";
import { useWorkspaceDraftSubmissionStore } from "@/stores/workspace-draft-submission-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import type { WorkspaceDraftTabSetup } from "@/workspace-tabs/model";
import { buildNewWorkspaceRoute } from "@/utils/host-routes";
import { buildPluginSurfaceRoute } from "./routes";
import type { PluginNavigation } from "./actions";

export function createPluginNavigation(input: {
  serverId: string;
  workspaceId: string | null;
}): PluginNavigation {
  const { serverId, workspaceId } = input;
  function placement(location: PluginPanelLocation) {
    if (location !== "explorer") return undefined;
    if (!workspaceId) throw new Error("No active workspace");
    const workspaceKey = `${serverId}:${workspaceId}`;
    const paneId = useWorkspaceLayoutStore.getState().showExplorerSidebar(workspaceKey);
    if (!paneId) throw new Error("Explorer is unavailable");
    return { mode: "pane" as const, paneId };
  }
  return {
    openAgent({ agentId, workspaceId: targetWorkspaceId, serverId: targetServerId }) {
      navigateToAgent({
        serverId: targetServerId ?? serverId,
        agentId,
        workspaceId: targetWorkspaceId,
      });
    },
    openWorkspace({ workspaceId: targetWorkspaceId, serverId: targetServerId }) {
      navigateToWorkspace({
        serverId: targetServerId ?? serverId,
        workspaceId: targetWorkspaceId,
      });
    },
    openNewWorkspace({ serverId: targetServerId, ...options }) {
      router.push(
        buildNewWorkspaceRoute({
          ...options,
          serverId: targetServerId ?? serverId,
        }),
      );
    },
    openWorkspaceAgentCreation({
      draftId: draftIdInput,
      workspace: workspacePayload,
      setup: setupInput,
      agentCreation,
      serverId: targetServerId,
    }) {
      const destinationServerId = targetServerId ?? serverId;
      const draftId = draftIdInput.trim();
      if (!draftId) throw new Error("draftId is required");

      const workspace = normalizeWorkspaceDescriptor(workspacePayload);
      const createdWorkspaceId = workspace.id;
      const setup: WorkspaceDraftTabSetup = {
        provider: setupInput.provider,
        cwd: setupInput.cwd,
        modeId: setupInput.modeId ?? null,
        model: setupInput.model ?? null,
        thinkingOptionId: setupInput.thinkingOptionId ?? null,
        featureValues: { ...setupInput.featureValues },
      };
      const timestamp = Date.now();
      const clientMessageId = `${draftId}:initial-message`;

      getHostRuntimeStore().acceptWorkspaceSnapshots(destinationServerId, [
        { ...workspace, status: "running" },
      ]);
      void agentCreation.result.catch(() => undefined);
      if (
        !useCreateFlowStore.getState().trySetPending({
          serverId: destinationServerId,
          workspaceId: createdWorkspaceId,
          draftId,
          agentId: null,
          clientMessageId,
          text: "",
          timestamp,
        })
      ) {
        return;
      }
      useWorkspaceDraftSubmissionStore.getState().setPending({
        serverId: destinationServerId,
        workspaceId: createdWorkspaceId,
        draftId,
        text: "",
        attachments: [],
        cwd: setup.cwd,
        provider: setup.provider,
        clientMessageId,
        timestamp,
        ...(setup.modeId ? { modeId: setup.modeId } : {}),
        ...(setup.model ? { model: setup.model } : {}),
        ...(setup.thinkingOptionId ? { thinkingOptionId: setup.thinkingOptionId } : {}),
        featureValues: setup.featureValues,
        allowEmptyText: true,
        agentCreation: {
          result: agentCreation.result,
          retry: async () => agentCreation.retry(),
        },
      });
      navigateToWorkspace({
        serverId: destinationServerId,
        workspaceId: createdWorkspaceId,
        target: { kind: "draft", draftId, setup },
      });
    },
    openSettings(pluginId, screenId) {
      router.push(buildPluginSettingsRoute(serverId, pluginId, screenId));
    },
    openSurface(pluginId, surfaceId) {
      router.push(buildPluginSurfaceRoute(serverId, pluginId, { kind: "surface", id: surfaceId }));
    },
    openWorkspacePanel(pluginId, panelId, location) {
      if (!workspaceId) throw new Error("No active workspace");
      navigateToWorkspace({
        serverId,
        workspaceId,
        target: { kind: "plugin", pluginId, panelId, context: "workspace" },
        placement: placement(location),
      });
    },
    openAgentPanel(pluginId, panelId, agentId, location) {
      if (!workspaceId) throw new Error("No active workspace");
      navigateToWorkspace({
        serverId,
        workspaceId,
        target: { kind: "plugin", pluginId, panelId, context: "agent", agentId },
        placement: placement(location),
      });
    },
  };
}
