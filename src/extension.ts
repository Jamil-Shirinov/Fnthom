// Activation, commands, service construction, and disposal.

import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import type { AgentAdapter } from "./agent/adapter";
import { SessionController } from "./agent/controller";
import { FakeAgentAdapter } from "./agent/fakeAdapter";
import { AgentPanel } from "./panel";
import { buildFeatureReference } from "./shared/exportMarkdown";
import { PROTOCOL_VERSION } from "./shared/messages";
import { ProposalPreviewProvider } from "./workspace/preview";
import { VsCodeWorkspace } from "./workspace/vscodeWorkspace";

const SECRET_KEY = "humanCenteredAgent.factoryApiKey";
// Changes here are not "source": dependencies, build output, VCS data, editor settings.
const IGNORED = /(^|\/)(node_modules|dist|out|coverage|\.git|\.vscode|\.human-centered-agent)(\/|$)/;

export async function activate(context: vscode.ExtensionContext) {
  const root = await pickWorkspaceRoot();
  const agent = createAgent();
  const workspace = root ? new VsCodeWorkspace(root) : undefined;
  const controller = new SessionController(
    agent,
    workspace ?? noWorkspace,
    {
      onState: (state) => AgentPanel.instance?.post({ protocolVersion: PROTOCOL_VERSION, type: "stateSnapshot", payload: state }),
      onActivity: (event) => AgentPanel.instance?.post({ protocolVersion: PROTOCOL_VERSION, type: "activity", payload: event }),
    },
    { sessionId: randomUUID(), workspaceId: root?.toString() ?? "" },
  );
  const previews = new ProposalPreviewProvider();

  const exportReference = async () => {
    if (!controller.getState().plan) {
      void vscode.window.showInformationMessage("Start a feature first; there is nothing to export yet.");
      return;
    }
    const target = await vscode.window.showSaveDialog({
      defaultUri: root ? vscode.Uri.joinPath(root, "feature-reference.md") : undefined,
      filters: { Markdown: ["md"] },
      title: "Export feature reference",
    });
    if (!target) return;
    await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(buildFeatureReference(controller.getState())));
    await vscode.window.showTextDocument(target, { viewColumn: vscode.ViewColumn.One, preview: false });
  };

  context.subscriptions.push(
    { dispose: () => agent.dispose() },
    previews.register(),
    vscode.commands.registerCommand("humanCenteredAgent.open", () =>
      AgentPanel.show(context, { controller, workspace, previews, exportReference }),
    ),
    vscode.commands.registerCommand("humanCenteredAgent.setApiKey", async () => {
      const key = await vscode.window.showInputBox({
        title: "Factory API key",
        prompt: "Stored in VS Code secret storage; never written to files or sent to the panel.",
        password: true,
        ignoreFocusOut: true,
      });
      if (key) {
        await context.secrets.store(SECRET_KEY, key.trim());
        void vscode.window.showInformationMessage("Factory API key saved.");
      }
    }),
    vscode.commands.registerCommand("humanCenteredAgent.export", exportReference),
    vscode.commands.registerCommand("humanCenteredAgent.resetSession", async () => {
      const choice = await vscode.window.showWarningMessage(
        "Discard the current session's plan and progress? Source files are not changed.",
        { modal: true },
        "Discard session",
      );
      if (choice === "Discard session") controller.reset();
    }),
  );

  if (workspace && root) {
    // Edits the session did not make invalidate evidence and references (application-spec.md, section 5).
    const pending = new Set<string>();
    let timer: NodeJS.Timeout | undefined;
    const note = (uri: vscode.Uri) => {
      const rel = workspace.relative(uri);
      if (!rel || IGNORED.test(rel)) return;
      pending.add(rel);
      clearTimeout(timer);
      timer = setTimeout(() => {
        const paths = [...pending];
        pending.clear();
        void controller.noteSourceChanged(paths);
      }, 300);
    };
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, "**/*"));
    context.subscriptions.push(
      watcher,
      watcher.onDidChange(note),
      watcher.onDidCreate(note),
      watcher.onDidDelete(note),
      vscode.workspace.onDidSaveTextDocument((doc) => note(doc.uri)),
      { dispose: () => clearTimeout(timer) },
    );
  }
}

export function deactivate() {}

function createAgent(): AgentAdapter {
  const useFake = vscode.workspace.getConfiguration("humanCenteredAgent").get<boolean>("useFakeAgent", true);
  if (!useFake) {
    void vscode.window.showWarningMessage("The Factory Droid adapter is not wired yet; using the fake agent.");
  }
  return new FakeAgentAdapter();
}

/** One workspace root per session; ask when several are open. */
async function pickWorkspaceRoot(): Promise<vscode.Uri | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length <= 1) return folders[0]?.uri;
  const picked = await vscode.window.showWorkspaceFolderPick({ placeHolder: "Choose the folder the agent may work in" });
  return picked?.uri;
}

/** Used only when no folder is open; the panel shows an empty state and never reaches these. */
const noWorkspace = {
  snapshot: async () => [],
  dirtyPaths: async () => [],
  apply: async () => [],
  referencesFor: async () => [],
  checkDefinitions: () => [],
  runCheck: async () => ({ output: "No workspace folder is open.", status: "error" as const }),
};
