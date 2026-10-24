// Webview lifecycle, bundled assets, and validated message routing (application-spec.md, section 7).

import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { GuardError, type SessionController } from "./agent/controller";
import { HostMessage, PROTOCOL_VERSION, UiAction } from "./shared/messages";
import type { ChangePreviewProvider } from "./workspace/preview";
import type { VsCodeWorkspace } from "./workspace/vscodeWorkspace";

export type PanelServices = {
  controller: SessionController;
  workspace: VsCodeWorkspace | undefined;
  previews: ChangePreviewProvider;
  exportReference: () => Promise<void>;
};

export class AgentPanel implements vscode.Disposable {
  static readonly viewType = "humanCenteredAgent.panel";
  private static current: AgentPanel | undefined;

  private readonly disposables: vscode.Disposable[] = [];
  /** Marks the lines of the function the user clicked in the graph. */
  private readonly highlight = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor("editor.findMatchHighlightBackground"),
    overviewRulerColor: new vscode.ThemeColor("editorOverviewRuler.findMatchForeground"),
    overviewRulerLane: vscode.OverviewRulerLane.Center,
    isWholeLine: true,
  });

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
    this.highlight.dispose();
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
        case "acceptFunction":
          if (!vscode.workspace.isTrusted) return reply("requestError", "Trust this workspace before the agent writes code or runs checks.");
          await c.acceptFunction(action.payload.functionId, action.payload);
          return reply("requestComplete");
        case "rejectFunction":
          await c.rejectFunction(action.payload.functionId, action.payload.reason, action.payload);
          return reply("requestComplete");
        case "retry":
          await c.retry(action.payload);
          return reply("requestComplete");
        case "showGraph":
          if (!this.services.workspace) return reply("requestError", "Open a folder to see its function graph.");
          await c.showGraph(action.payload);
          return reply("requestComplete");
        case "openNode":
          await this.openNode(action.payload.nodeId);
          return reply("requestComplete");
        case "previewChange":
          await this.previewChange(action.payload.path);
          return reply("requestComplete");
        case "rerunChecks":
          await c.rerunChecks(action.payload);
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
      }
    } catch (err) {
      reply("requestError", err instanceof GuardError || err instanceof Error ? err.message : String(err));
    }
  }

  /** Diff of a file as it was before the feature and as the feature wrote it. */
  private async previewChange(path: string) {
    const applied = this.controller.getState().applied.find((f) => f.path === path);
    const before = this.controller.baselineFor(path);
    const workspace = this.services.workspace;
    if (!applied || !before || !workspace) throw new Error("That file was not changed by this feature.");
    const [now] = await workspace.snapshot([path]);
    await this.services.previews.openDiff({
      path,
      before: before.exists ? before.content : null,
      after: now?.exists ? now.content : "",
      version: applied.appliedHash,
    });
  }

  /** Opens the function in its own editor tab and highlights its lines. */
  private async openNode(nodeId: string) {
    const node = this.controller.getState().graph?.nodes.find((n) => n.id === nodeId);
    const workspace = this.services.workspace;
    if (!workspace || !node) throw new Error("That function is no longer in the graph.");
    if (node.planned && node.status === "new") return; // planned, so there is no code to open yet

    const doc = await vscode.workspace.openTextDocument(workspace.uri(node.path));
    // Serialized lines are one-based and inclusive; editor positions are zero-based.
    const last = Math.min(node.endLine, doc.lineCount) - 1;
    const first = Math.min(node.startLine - 1, last);
    const range = new vscode.Range(first, 0, last, doc.lineAt(last).text.length);
    const editor = await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.One,
      preview: false,
      selection: new vscode.Range(first, 0, first, 0),
    });
    for (const visible of vscode.window.visibleTextEditors) visible.setDecorations(this.highlight, []);
    editor.setDecorations(this.highlight, [range]);
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
