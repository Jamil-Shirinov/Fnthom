// Immutable before/after documents for native diffs. Content is captured when a preview opens,
// so a diff keeps showing exactly what was reviewed even after the proposal is applied or replaced.

import * as vscode from "vscode";
import { PROPOSAL_SCHEME, proposalUri } from "./vscodeWorkspace";

export class ProposalPreviewProvider implements vscode.TextDocumentContentProvider {
  private readonly contents = new Map<string, string>();

  register(): vscode.Disposable {
    return vscode.workspace.registerTextDocumentContentProvider(PROPOSAL_SCHEME, this);
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? "";
  }

  async openDiff(args: { proposalId: string; path: string; baseline: string | null; proposed: string; stepTitle: string }) {
    const left = proposalUri(args.proposalId, "base", args.path);
    const right = proposalUri(args.proposalId, "proposed", args.path);
    if (!this.contents.has(left.toString())) this.contents.set(left.toString(), args.baseline ?? "");
    if (!this.contents.has(right.toString())) this.contents.set(right.toString(), args.proposed);
    const label = args.baseline === null ? `${args.path} (new file)` : args.path;
    await vscode.commands.executeCommand("vscode.diff", left, right, `${label}: ${args.stepTitle}`, {
      preview: true,
      viewColumn: vscode.ViewColumn.One,
    });
  }
}
