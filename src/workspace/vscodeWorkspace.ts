// WorkspacePort backed by the VS Code API: open buffers first, edits through WorkspaceEdit,
// and configured checks.

import * as vscode from "vscode";
import { CheckDefinition, type FileChange, type FileSnapshot } from "../shared/schema";
import { runCheckProcess } from "./checks";
import { contentHash } from "./hash";
import { IGNORED_DIR, MAX_SOURCE_FILES, isSourcePath, type ApplyFileOutcome, type CheckRun, type WorkspacePort } from "./port";

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

  async listSourceFiles(): Promise<string[]> {
    const uris = await vscode.workspace.findFiles(
      new vscode.RelativePattern(this.root, "**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}"),
      new vscode.RelativePattern(this.root, "**/{node_modules,dist,out,build,coverage,.git,.vscode,.human-centered-agent}/**"),
      MAX_SOURCE_FILES * 2,
    );
    return uris
      .map((uri) => this.relative(uri))
      .filter((p): p is string => !!p && isSourcePath(p) && !IGNORED_DIR.test(p))
      .sort()
      .slice(0, MAX_SOURCE_FILES);
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

  async apply(files: FileChange[]): Promise<ApplyFileOutcome[]> {
    const edit = new vscode.WorkspaceEdit();
    for (const file of files) {
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
    for (const file of files) {
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

/** Read-only virtual documents for the two sides of a change diff. */
export const PROPOSAL_SCHEME = "hca-change";

export function changeUri(side: "before" | "after", path: string, version: string) {
  return vscode.Uri.from({ scheme: PROPOSAL_SCHEME, path: `/${path}`, query: new URLSearchParams({ side, version }).toString() });
}
