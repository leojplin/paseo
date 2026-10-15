import type { Href } from "expo-router";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import { buildHostRootRoute, buildHostWorkspaceRoute } from "@/utils/host-routes";
import { resolveWorkspaceRouteId } from "@/utils/workspace-identity";

export function resolveWorkspaceArchiveRedirectWorkspaceId(input: {
  archivedWorkspaceId: string;
  workspaces: Iterable<WorkspaceDescriptor>;
}): string | null {
  const archivedWorkspaceId = resolveWorkspaceRouteId({
    routeWorkspaceId: input.archivedWorkspaceId,
  });
  if (!archivedWorkspaceId) {
    return null;
  }

  const workspaces = Array.from(input.workspaces);
  const archivedIndex = workspaces.findIndex((workspace) => workspace.id === archivedWorkspaceId);
  if (archivedIndex < 0) {
    return null;
  }

  return workspaces[archivedIndex + 1]?.id ?? workspaces[archivedIndex - 1]?.id ?? null;
}

export function buildWorkspaceArchiveRedirectRoute(input: {
  serverId: string;
  archivedWorkspaceId: string;
  workspaces: Iterable<WorkspaceDescriptor>;
}): Href {
  const redirectWorkspaceId = resolveWorkspaceArchiveRedirectWorkspaceId(input);
  return redirectWorkspaceId
    ? buildHostWorkspaceRoute(input.serverId, redirectWorkspaceId)
    : buildHostRootRoute(input.serverId);
}
