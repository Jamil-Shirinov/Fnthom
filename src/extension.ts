// Activation, commands, service construction, and disposal.

import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import type { AgentAdapter } from "./agent/adapter";
import { SessionController } from "./agent/controller";
import { FakeAgentAdapter } from "./agent/fakeAdapter";
import { AgentPanel } from "./panel";
import { PROTOCOL_VERSION } from "./shared/messages";

const SECRET_KEY = "humanCenteredAgent.factoryApiKey";

export async function activate(context: vscode.ExtensionContext) {
  const root = await pickWorkspaceRoot();
  const agent = createAgent();
  const controller = new SessionController(
    agent,
    {
      onState: (state) => AgentPanel.instance?.post({ protocolVersion: PROTOCOL_VERSION, type: "stateSnapshot", payload: state }),
      onActivity: (event) => AgentPanel.instance?.post({ protocolVersion: PROTOCOL_VERSION, type: "activity", payload: event }),
    },
    { sessionId: randomUUID(), workspaceId: root?.toString() ?? "" },
  );

  context.subscriptions.push(
    { dispose: () => agent.dispose() },
    vscode.commands.registerCommand("humanCenteredAgent.open", () => AgentPanel.show(context, controller, root)),
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
    vscode.commands.registerCommand("humanCenteredAgent.export", () => {
      void vscode.window.showInformationMessage("Export arrives in a later MVP step.");
    }),
    vscode.commands.registerCommand("humanCenteredAgent.resetSession", async () => {
      const choice = await vscode.window.showWarningMessage(
        "Discard the current session's plan and progress? Source files are not changed.",
        { modal: true },
        "Discard session",
      );
      if (choice === "Discard session") controller.reset();
    }),
  );
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
