import { Command } from "commander";
import { withOutput } from "../../output/index.js";
import { addJsonAndDaemonHostOptions } from "../../utils/command-options.js";
import { runArchiveCommand } from "./archive.js";
import { runCreateCommand } from "./create.js";
import { runLabelCreateCommand, runLabelListCommand, runLabelSetCommand } from "./label.js";
import { runLsCommand } from "./ls.js";
import { runRenameCommand } from "./rename.js";
import { runSetupCommand } from "./setup.js";

export function createWorkspaceCommand(): Command {
  const workspace = new Command("workspace").description("Manage workspaces");

  addJsonAndDaemonHostOptions(
    workspace
      .command("setup")
      .description("Allow and run setup for a workspace")
      .argument("<workspace-id>", "Workspace id"),
  ).action(withOutput(runSetupCommand));

  addJsonAndDaemonHostOptions(
    workspace
      .command("create")
      .description("Create a workspace")
      .requiredOption("--isolation <local|worktree>", "Workspace isolation")
      .option("--path <path>", "Local directory or source checkout (default: current)")
      .option("--project <id>", "Existing project id")
      .option("--title <title>", "Workspace title")
      .option(
        "--label <name>",
        "Assign this label to the workspace after creation (repeatable)",
        (value: string, previous: string[]) => [...(previous ?? []), value],
        undefined as unknown as string[] | undefined,
      )
      .option(
        "--mode <mode>",
        "Worktree mode: branch-off, checkout-branch, or checkout-pr (default: branch-off)",
      )
      .option("--worktree-slug <slug>", "Managed worktree path slug")
      .option("--new-branch <name>", "New branch name (--mode branch-off)")
      .option("--base <ref>", "Base ref (--mode branch-off)")
      .option("--branch <name>", "Existing branch (--mode checkout-branch)")
      .option("--pr-number <n>", "Pull request or change request number (--mode checkout-pr)")
      .option("--forge <forge>", "Forge for --mode checkout-pr (default: source checkout)")
      .option("--background", "Create a background workspace")
      .option("--no-background", "Create a visible workspace instead of inheriting background"),
  ).action(withOutput(runCreateCommand));

  addJsonAndDaemonHostOptions(
    workspace
      .command("ls")
      .description("List active workspaces")
      .option("--background", "Include background workspaces"),
  ).action(withOutput(runLsCommand));

  addJsonAndDaemonHostOptions(
    workspace
      .command("rename")
      .description("Set a workspace's user-visible title")
      .argument("<workspace-id>", "Workspace id")
      .argument("[title]", "New workspace title")
      .option("--reset", "Clear the title and revert to the branch or directory name")
      // Commander 12 accepts excess positionals by default, which would rename to
      // the first word of an unquoted multi-word title and silently drop the rest.
      .allowExcessArguments(false),
  ).action(withOutput(runRenameCommand));

  addJsonAndDaemonHostOptions(
    workspace
      .command("archive")
      .description("Archive a workspace and everything it owns")
      .argument("<workspace-id>", "Workspace id"),
  ).action(withOutput(runArchiveCommand));

  const label = workspace.command("label").description("Manage workspace labels");

  addJsonAndDaemonHostOptions(label.command("ls").description("List workspace labels")).action(
    withOutput(runLabelListCommand),
  );

  addJsonAndDaemonHostOptions(
    label
      .command("create")
      .description("Create or update a workspace label")
      .argument("<name>", "Label name")
      .option("--color <color>", "Label color"),
  ).action(withOutput(runLabelCreateCommand));

  addJsonAndDaemonHostOptions(
    label
      .command("set")
      .description("Assign or remove labels on a workspace")
      .argument("<workspace-id>", "Workspace id")
      .argument("<name...>", "Label name(s)")
      .option("--remove", "Remove the labels instead of assigning them")
      .allowExcessArguments(false),
  ).action(withOutput(runLabelSetCommand));

  return workspace;
}
