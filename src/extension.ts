// Activation, commands, service construction, and disposal.

import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import type { AgentAdapter } from "./agent/adapter";
import { SessionController } from "./agent/controller";
import { FactoryDroidAdapter } from "./agent/factoryDroidAdapter";
import { FakeAgentAdapter } from "./agent/fakeAdapter";
import { AgentPanel } from "./panel";
import { buildFeatureReference } from "./shared/exportMarkdown";
import { PROTOCOL_VERSION } from "./shared/messages";
import { ChangePreviewProvider } from "./workspace/preview";
import { isSourcePath } from "./workspace/port";
import { VsCodeWorkspace } from "./workspace/vscodeWorkspace";

const SECRET_KEY = "fnthom.factoryApiKey";

export async function activate(context: vscode.ExtensionContext) {
  const root = await pickWorkspaceRoot();
  const agent = await createAgent(context);
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
  const previews = new ChangePreviewProvider();

  const exportReference = async () => {
    if (!controller.getState().plan && !controller.getState().graph) {
      void vscode.window.showInformationMessage("Start a feature or build the graph first; there is nothing to export yet.");
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
    vscode.commands.registerCommand("fnthom.open", () =>
      AgentPanel.show(context, { controller, workspace, previews, exportReference }),
    ),
    vscode.commands.registerCommand("fnthom.setApiKey", async () => {
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
    vscode.commands.registerCommand("fnthom.export", exportReference),
    vscode.commands.registerCommand("fnthom.resetSession", async () => {
      const choice = await vscode.window.showWarningMessage(
        "Discard the current session's plan and progress? Source files are not changed.",
        { modal: true },
        "Discard session",
      );
      if (choice === "Discard session") controller.reset();
    }),
  );

  if (workspace && root) {
    // Saved edits move functions around; rebuild the graph so node links keep pointing at the right lines.
    let timer: NodeJS.Timeout | undefined;
    const note = (uri: vscode.Uri) => {
      const rel = workspace.relative(uri);
      if (!rel || !isSourcePath(rel)) return;
      clearTimeout(timer);
      timer = setTimeout(() => void controller.noteSourceChanged(), 300);
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

async function createAgent(context: vscode.ExtensionContext): Promise<AgentAdapter> {
  const config = vscode.workspace.getConfiguration("fnthom");
  const useFake = config.get<boolean>("useFakeAgent", true);
  const apiKey = (await context.secrets.get(SECRET_KEY)) ?? process.env.FACTORY_API_KEY?.trim() ?? "";

  if (useFake) {
    return new FakeAgentAdapter();
  }

  if (!apiKey) {
    void vscode.window.showWarningMessage(
      "Factory API key is not configured; using the fake agent until you set it. Run 'Fnthom: Set Factory API Key' or set FACTORY_API_KEY in your shell.",
    );
    return new FakeAgentAdapter();
  }

  const execPath = config.get<string>("droidExecutablePath", "").trim();
  return new FactoryDroidAdapter({ apiKey, execPath: execPath || undefined });
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
  previewFunction: async () => {},
  saveFunctionPreview: async () => {},
  discardFunctionPreview: async () => {},
  apply: async () => [],
  listSourceFiles: async () => [],
  checkDefinitions: () => [],
  runCheck: async () => ({ output: "No workspace folder is open.", status: "error" as const }),
};
