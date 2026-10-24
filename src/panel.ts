// Webview lifecycle, bundled assets, and validated message routing (application-spec.md, section 7).

import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { GuardError, type SessionController } from "./agent/controller";
import { HostMessage, PROTOCOL_VERSION, UiAction } from "./shared/messages";
import type { ProposalPreviewProvider } from "./workspace/preview";
import type { VsCodeWorkspace } from "./workspace/vscodeWorkspace";

export type PanelServices = {
  controller: SessionController;
  workspace: VsCodeWorkspace | undefined;
  previews: ProposalPreviewProvider;
  exportReference: () => Promise<void>;
};

export class AgentPanel implements vscode.Disposable {
  static readonly viewType = "humanCenteredAgent.panel";
  private static current: AgentPanel | undefined;

  private readonly disposables: vscode.Disposable[] = [];

  static show(context: vscode.ExtensionContext, services: PanelServices) {
    if (AgentPanel.current) {
      AgentPanel.current.panel.reveal(vscode.ViewColumn.Two);
      return AgentPanel.current;
    }
    const panel = vscode.window.createWebviewPanel(AgentPanel.viewType, "Human-Centered Agent", vscode.ViewColumn.Two, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "webview", "dist")],
    });
    AgentPanel.current = new AgentPanel(panel, context.extensionUri, services);
    return AgentPanel.current;
  }

  static get instance() {
    return AgentPanel.current;
  }

  private readonly controller: SessionController;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private readonly services: PanelServices,
  ) {
    this.controller = services.controller;
    panel.webview.html = this.html();
    panel.onDidDispose(() => this.dispose(), null, this.disposables);
    panel.webview.onDidReceiveMessage((raw) => void this.handle(raw), null, this.disposables);
  }

  post(message: HostMessage) {
    void this.panel.webview.postMessage(message);
  }

  dispose() {
    AgentPanel.current = undefined;
    for (const d of this.disposables.splice(0)) d.dispose();
    this.panel.dispose();
  }

  private async handle(raw: unknown) {
    const parsed = UiAction.safeParse(raw);
    if (!parsed.success) {
      this.post({
        protocolVersion: PROTOCOL_VERSION,
        type: "requestError",
        payload: { message: "The panel sent a message the extension does not understand." },
      });
      return;
    }
    const action = parsed.data;
    const reply = (type: "requestComplete" | "requestError", message?: string) =>
      this.post(
        type === "requestComplete"
          ? { protocolVersion: PROTOCOL_VERSION, type, requestId: action.requestId, payload: {} }
          : { protocolVersion: PROTOCOL_VERSION, type, requestId: action.requestId, payload: { message: message ?? "" } },
      );

    try {
      const c = this.controller;
      switch (action.type) {
        case "ready":
          this.post({ protocolVersion: PROTOCOL_VERSION, type: "stateSnapshot", payload: c.getState() });
          return;
        case "startFeature":
          if (!this.services.workspace) return reply("requestError", "Open a folder before starting a feature.");
          if (!vscode.workspace.isTrusted) return reply("requestError", "Trust this workspace before the agent reads it.");
          await c.startFeature(action.payload.intent, action.payload);
          return reply("requestComplete");
        case "startStep":
          await c.startStep(action.payload.stepId, action.payload);
          return reply("requestComplete");
        case "regenerateProposal":
          await c.regenerateProposal(action.payload.stepId, action.payload);
          return reply("requestComplete");
        case "previewFile":
          await this.previewFile(action.payload.proposalId, action.payload.path);
          return reply("requestComplete");
        case "applyAndContinue":
          if (!vscode.workspace.isTrusted) return reply("requestError", "Trust this workspace before applying changes or running checks.");
          await c.applyAndContinue(action.payload.proposalId, action.payload);
          return reply("requestComplete");
        case "askQuestion":
          await c.askQuestion(action.payload.question, action.payload);
          return reply("requestComplete");
        case "reviseApproach":
          await c.reviseApproach(action.payload.instruction, action.payload);
          return reply("requestComplete");
        case "rerunChecks":
          await c.rerunChecks(action.payload);
          return reply("requestComplete");
        case "continueAfterFailure":
          await c.continueAfterFailure(action.payload);
          return reply("requestComplete");
        case "cancel":
          c.cancel(action.payload);
          return reply("requestComplete");
        case "export":
          await this.services.exportReference();
          return reply("requestComplete");
        case "resetSession":
          c.assertGuard(action.payload);
          c.reset();
          return reply("requestComplete");
        case "selectConcept":
          // Selection is UI-local; the host keeps no selection state.
          return;
        case "openSource":
          await this.openSource(action.payload.conceptId, action.payload.refIndex);
          return reply("requestComplete");
      }
    } catch (err) {
      reply("requestError", err instanceof GuardError || err instanceof Error ? err.message : String(err));
    }
  }

  private async previewFile(proposalId: string, path: string) {
    const state = this.controller.getState();
    const proposal = state.proposal;
    const file = proposal?.id === proposalId ? proposal.files.find((f) => f.path === path) : undefined;
    const baseline = this.controller.baselineFor(proposalId, path);
    if (!proposal || !file || !baseline) throw new Error("That proposal is no longer current. Regenerate it to preview again.");
    const stepTitle = state.plan?.steps.find((s) => s.id === proposal.stepId)?.title ?? proposal.stepId;
    await this.services.previews.openDiff({
      proposalId,
      path,
      baseline: baseline.exists ? baseline.content : null,
      proposed: file.newContent,
      stepTitle,
    });
  }

  private async openSource(conceptId: string, refIndex: number) {
    const concept = this.controller.getState().plan?.concepts.find((c) => c.id === conceptId);
    const ref = concept?.sourceRefs[refIndex];
    const workspace = this.services.workspace;
    if (!workspace || !ref) throw new Error("That source reference no longer exists.");

    const uri = workspace.uri(ref.path);
    if (ref.status !== "resolved") {
      // Never assert an exact range for a stale reference; open the file instead.
      await vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.One });
      return;
    }
    // Serialized lines are one-based and inclusive; editor positions are zero-based.
    const range = new vscode.Range(ref.startLine - 1, 0, ref.endLine - 1, Number.MAX_SAFE_INTEGER);
    const editor = await vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.One, selection: range });
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  private html() {
    const webview = this.panel.webview;
    const asset = (file: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "webview", "dist", "assets", file));
    const nonce = randomBytes(16).toString("hex");
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      `img-src ${webview.cspSource} data:`,
      `script-src 'nonce-${nonce}'`,
    ].join("; ");

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${asset("index.css")}" />
    <title>Human-Centered Agent</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" nonce="${nonce}" src="${asset("index.js")}"></script>
  </body>
</html>`;
  }
}
