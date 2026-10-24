// Immutable before/after documents for native diffs of what the feature changed. Content is captured when
// a diff first opens, so it keeps showing what was written even if the file is edited afterwards.

import * as vscode from "vscode";
import { PROPOSAL_SCHEME, changeUri } from "./vscodeWorkspace";

export class ChangePreviewProvider implements vscode.TextDocumentContentProvider {
  private readonly contents = new Map<string, string>();

  register(): vscode.Disposable {
    return vscode.workspace.registerTextDocumentContentProvider(PROPOSAL_SCHEME, this);
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? "";
  }

  async openDiff(args: { path: string; before: string | null; after: string; version: string }) {
    const left = changeUri("before", args.path, args.version);
    const right = changeUri("after", args.path, args.version);
    if (!this.contents.has(left.toString())) this.contents.set(left.toString(), args.before ?? "");
    if (!this.contents.has(right.toString())) this.contents.set(right.toString(), args.after);
    const label = args.before === null ? `${args.path} (new file)` : `${args.path} (before ↔ after)`;
    await vscode.commands.executeCommand("vscode.diff", left, right, label, { preview: true, viewColumn: vscode.ViewColumn.One });
  }
}
