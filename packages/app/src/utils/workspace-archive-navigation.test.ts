import type { Href } from "expo-router";
import { describe, expect, it } from "vitest";
import { buildWorkspaceArchiveRedirectRoute } from "@/utils/workspace-archive-navigation";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import {
  redirectIfArchivingActiveWorkspace,
  type RedirectIfArchivingActiveWorkspaceDeps,
} from "@/utils/workspace-archive-redirect";

function workspace(
  input: Partial<WorkspaceDescriptor> & Pick<WorkspaceDescriptor, "id">,
): WorkspaceDescriptor {
  return {
    id: input.id,
    projectId: input.projectId ?? "project-1",
    projectDisplayName: input.projectDisplayName ?? "Project",
    projectRootPath: input.projectRootPath ?? "/repo",
    workspaceDirectory: input.workspaceDirectory ?? input.projectRootPath ?? "/repo",
    projectKind: input.projectKind ?? "git",
    workspaceKind: input.workspaceKind ?? "worktree",
    name: input.name ?? input.id,
    status: input.status ?? "done",
    archivingAt: input.archivingAt ?? null,
    statusEnteredAt: null,
    diffStat: input.diffStat ?? null,
    scripts: input.scripts ?? [],
  };
}

describe("buildWorkspaceArchiveRedirectRoute", () => {
  it("focuses the workspace after the archived workspace", () => {
    const workspaces = [
      workspace({ id: "main", workspaceKind: "checkout" }),
      workspace({ id: "feature" }),
      workspace({ id: "bugfix" }),
    ];

    expect(
      buildWorkspaceArchiveRedirectRoute({
        serverId: "server-1",
        archivedWorkspaceId: "feature",
        workspaces,
      }),
    ).toBe("/h/server-1/workspace/bugfix");
  });

  it("focuses the previous workspace when the archived workspace is last", () => {
    const workspaces = [workspace({ id: "main" }), workspace({ id: "feature" })];

    expect(
      buildWorkspaceArchiveRedirectRoute({
        serverId: "server-1",
        archivedWorkspaceId: "feature",
        workspaces,
      }),
    ).toBe("/h/server-1/workspace/main");
  });

  it("returns to the host when no other workspace exists", () => {
    expect(
      buildWorkspaceArchiveRedirectRoute({
        serverId: "server-1",
        archivedWorkspaceId: "notes",
        workspaces: [
          workspace({
            id: "notes",
            projectId: "notes",
            projectKind: "directory",
            workspaceKind: "checkout",
          }),
        ],
      }),
    ).toBe("/h/server-1");
  });
});

function createFakeRouter(workspaces: WorkspaceDescriptor[]): {
  deps: RedirectIfArchivingActiveWorkspaceDeps;
  routes: Href[];
} {
  const routes: Href[] = [];
  return {
    routes,
    deps: {
      navigateToRoute: (route) => {
        routes.push(route);
      },
      readWorkspaces: () => workspaces,
    },
  };
}

describe("redirectIfArchivingActiveWorkspace", () => {
  it("does not replace the route when archiving an inactive workspace", () => {
    const { deps, routes } = createFakeRouter([
      workspace({ id: "main", workspaceKind: "local_checkout" }),
      workspace({ id: "feature", name: "feature" }),
    ]);

    expect(
      redirectIfArchivingActiveWorkspace(
        {
          serverId: "server-1",
          workspaceId: "feature",
          activeWorkspaceSelection: { serverId: "server-1", workspaceId: "main" },
        },
        deps,
      ),
    ).toBe(false);

    expect(routes).toEqual([]);
  });

  it("replaces the route at action time when archiving the active workspace", () => {
    const { deps, routes } = createFakeRouter([
      workspace({ id: "main", workspaceKind: "local_checkout" }),
      workspace({ id: "feature", name: "feature" }),
    ]);

    expect(
      redirectIfArchivingActiveWorkspace(
        {
          serverId: "server-1",
          workspaceId: "feature",
          activeWorkspaceSelection: { serverId: "server-1", workspaceId: "feature" },
        },
        deps,
      ),
    ).toBe(true);

    expect(routes).toEqual(["/h/server-1/workspace/main"]);
  });
});
