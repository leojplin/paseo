import { useEffect } from "react";
import { useSidebarModel } from "@/components/sidebar/sidebar-model";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";

export function WorkspaceShortcutTargetsSubscriber({ enabled }: { enabled: boolean }) {
  const { shortcutModel } = useSidebarModel();
  const setSidebarShortcutWorkspaceTargets = useKeyboardShortcutsStore(
    (state) => state.setSidebarShortcutWorkspaceTargets,
  );
  const setReadyForReviewWorkspaceTargets = useKeyboardShortcutsStore(
    (state) => state.setReadyForReviewWorkspaceTargets,
  );

  useEffect(() => {
    if (!enabled) {
      setSidebarShortcutWorkspaceTargets([]);
      setReadyForReviewWorkspaceTargets([]);
      return;
    }

    setSidebarShortcutWorkspaceTargets(shortcutModel.shortcutTargets);
    setReadyForReviewWorkspaceTargets(shortcutModel.readyForReviewTargets);
  }, [
    enabled,
    setReadyForReviewWorkspaceTargets,
    setSidebarShortcutWorkspaceTargets,
    shortcutModel.readyForReviewTargets,
    shortcutModel.shortcutTargets,
  ]);

  useEffect(() => {
    return () => {
      setSidebarShortcutWorkspaceTargets([]);
      setReadyForReviewWorkspaceTargets([]);
    };
  }, [setReadyForReviewWorkspaceTargets, setSidebarShortcutWorkspaceTargets]);

  return null;
}
