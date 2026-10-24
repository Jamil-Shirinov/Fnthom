// WorkspacePort backed by the VS Code API: open buffers first, edits through WorkspaceEdit,
// document symbols for source references, and configured checks.

import * as vscode from "vscode";
import { rangeHash } from "../agent/controller";
import { CheckDefinition, type FileSnapshot, type SourceRef, type StepProposal } from "../shared/schema";
import { runCheckProcess } from "./checks";
import { contentHash } from "./hash";
import type { ApplyFileOutcome, CheckRun, WorkspacePort } from "./port";

const normalizeEol = (text: string) => text.replace(/\r\n/g, "\n");

export class VsCodeWorkspace implements WorkspacePort {
  constructor(private readonly root: vscode.Uri) {}

  uri(path: string) {
    return vscode.Uri.joinPath(this.root, ...path.split("/"));
  }

  relative(uri: vscode.Uri): string | undefined {
    const rel = vscode.workspace.asRelativePath(uri, false);
    return rel === uri.fsPath || rel.startsWith("..") ? undefined : rel.replace(/\\/g, "/");
  }

  async snapshot(paths: string[]): Promise<FileSnapshot[]> {
    return Promise.all(
      paths.map(async (path): Promise<FileSnapshot> => {
        const uri = this.uri(path);
        const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
        if (open) {
          const content = normalizeEol(open.getText());
          return { path, exists: true, content, contentHash: contentHash(content), documentVersion: open.version };
        }
        try {
          const content = normalizeEol(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)));
          return { path, exists: true, content, contentHash: contentHash(content) };
        } catch {
          return { path, exists: false, content: "", contentHash: contentHash("") };
        }
      }),
    );
  }

  async dirtyPaths(paths: string[]): Promise<string[]> {
    return paths.filter((path) => vscode.workspace.textDocuments.some((d) => d.isDirty && d.uri.toString() === this.uri(path).toString()));
  }

  async apply(proposal: StepProposal): Promise<ApplyFileOutcome[]> {
    const edit = new vscode.WorkspaceEdit();
    for (const file of proposal.files) {
      const uri = this.uri(file.path);
      if (file.kind === "create") {
        edit.createFile(uri, { overwrite: false, ignoreIfExists: false, contents: new TextEncoder().encode(file.newContent) });
      } else {
        const doc = await vscode.workspace.openTextDocument(uri);
        edit.replace(uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), file.newContent);
      }
    }

    let applied = false;
    let applyError: string | undefined;
    try {
      applied = await vscode.workspace.applyEdit(edit);
    } catch (err) {
      applyError = err instanceof Error ? err.message : String(err);
    }

    // Report what actually happened to each file, not what was intended.
    const outcomes: ApplyFileOutcome[] = [];
    for (const file of proposal.files) {
      try {
        const doc = await vscode.workspace.openTextDocument(this.uri(file.path));
        const text = normalizeEol(doc.getText());
        const matches = text === normalizeEol(file.newContent);
        const saved = matches ? (doc.isDirty ? await doc.save() : true) : false;
        outcomes.push({
          path: file.path,
          applied: matches,
          saved,
          appliedHash: contentHash(text),
          error: matches ? undefined : (applyError ?? (applied ? "content differs after apply" : "edit was rejected")),
        });
      } catch (err) {
        outcomes.push({ path: file.path, applied: false, saved: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return outcomes;
  }

  async referencesFor(path: string): Promise<SourceRef[]> {
    const uri = this.uri(path);
    let text: string;
    try {
      text = normalizeEol((await vscode.workspace.openTextDocument(uri)).getText());
    } catch {
      return [];
    }
    const lineCount = text.split("\n").length;
    const make = (startLine: number, endLine: number, symbol?: string): SourceRef => ({
      path,
      symbol,
      startLine,
      endLine,
      contentHash: rangeHash(text, { startLine, endLine }),
      status: "resolved",
    });

    try {
      const symbols = await vscode.commands.executeCommand<(vscode.DocumentSymbol | vscode.SymbolInformation)[] | undefined>(
        "vscode.executeDocumentSymbolProvider",
        uri,
      );
      const wanted = new Set([vscode.SymbolKind.Function, vscode.SymbolKind.Class, vscode.SymbolKind.Method, vscode.SymbolKind.Interface]);
      const refs = (symbols ?? [])
        .filter((s) => wanted.has(s.kind))
        .map((s) => {
          const range = "range" in s ? s.range : s.location.range;
          return make(range.start.line + 1, range.end.line + 1, s.name);
        });
      if (refs.length) return refs;
    } catch {
      // Fall through to a whole-file reference when no symbol provider answers.
    }
    return [make(1, lineCount)];
  }

  checkDefinitions(): CheckDefinition[] {
    const raw = vscode.workspace.getConfiguration("humanCenteredAgent", this.root).get<unknown[]>("checks", []);
    return raw.flatMap((entry) => {
      const parsed = CheckDefinition.safeParse(entry);
      return parsed.success ? [parsed.data] : [];
    });
  }

  runCheck(check: CheckDefinition, signal: AbortSignal): Promise<CheckRun> {
    return runCheckProcess(check, this.root.fsPath, signal);
  }
}

/** Read-only virtual documents for the two sides of a proposal diff. */
export const PROPOSAL_SCHEME = "hca-proposal";

export function proposalUri(proposalId: string, side: "base" | "proposed", path: string) {
  return vscode.Uri.from({ scheme: PROPOSAL_SCHEME, path: `/${path}`, query: new URLSearchParams({ proposalId, side }).toString() });
}

export function parseProposalUri(uri: vscode.Uri) {
  const params = new URLSearchParams(uri.query);
  return { proposalId: params.get("proposalId") ?? "", side: params.get("side") as "base" | "proposed", path: uri.path.slice(1) };
}
