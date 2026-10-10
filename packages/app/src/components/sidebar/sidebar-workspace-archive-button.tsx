import { Pressable } from "react-native";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { isWeb } from "@/constants/platform";
import type { Theme } from "@/styles/theme";

const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const archiveXButtonStyle = ({ hovered }: { hovered?: boolean }) => [
  styles.archiveXButton,
  hovered && styles.archiveXButtonHovered,
];
const ThemedX = withUnistyles(X);

/**
 * Direct archive affordance for a sidebar workspace row's trailing slot — the same action the
 * kebab menu and the workspace.archive shortcut run, so confirmations (running agent,
 * uncommitted changes) and the optimistic-archive redirect all still apply. Shared by every
 * row renderer; the trailing-slot renderers show it beside the kebab.
 */
export function SidebarWorkspaceArchiveButton({
  workspaceKey,
  onArchive,
}: {
  workspaceKey: string;
  onArchive: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Pressable
      hitSlop={8}
      accessibilityRole={isWeb ? "button" : undefined}
      accessibilityLabel={t("sidebar.workspace.actions.archiveWorkspace")}
      testID={`sidebar-workspace-archive-button-${workspaceKey}`}
      onPress={onArchive}
      style={archiveXButtonStyle}
    >
      <ThemedX size={14} uniProps={foregroundMutedColorMapping} />
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  // The × sits beside the kebab on the same hover-revealed rail. The trigger-style padding
  // matches the kebab so the pair reads as one control cluster.
  archiveXButton: {
    padding: 2,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  archiveXButtonHovered: {
    backgroundColor: theme.colors.surface2,
  },
}));
