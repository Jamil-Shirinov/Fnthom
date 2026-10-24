// WorkspacePort over a plain directory, for tests. Mirrors the VS Code implementation's contract
// (full-content writes, per-file outcomes, whole-file references) without an editor.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { rangeHash } from "../../src/agent/controller";
import type { CheckDefinition, FileSnapshot, SourceRef, StepProposal } from "../../src/shared/schema";
import { runCheckProcess } from "../../src/workspace/checks";
import { contentHash } from "../../src/workspace/hash";
import type { ApplyFileOutcome, WorkspacePort } from "../../src/workspace/port";

export class NodeWorkspace implements WorkspacePort {
  dirty = new Set<string>();
  failWrites = new Set<string>();

  constructor(
    readonly root: string,
    private readonly checks: CheckDefinition[] = [],
  ) {}

  async snapshot(paths: string[]): Promise<FileSnapshot[]> {
    return Promise.all(
      paths.map(async (p) => {
        try {
          const content = await readFile(path.join(this.root, p), "utf8");
          return { path: p, exists: true, content, contentHash: contentHash(content) };
        } catch {
          return { path: p, exists: false, content: "", contentHash: contentHash("") };
        }
      }),
    );
  }

  async dirtyPaths(paths: string[]) {
    return paths.filter((p) => this.dirty.has(p));
  }

  async apply(proposal: StepProposal): Promise<ApplyFileOutcome[]> {
    const outcomes: ApplyFileOutcome[] = [];
    for (const file of proposal.files) {
      if (this.failWrites.has(file.path)) {
        outcomes.push({ path: file.path, applied: false, saved: false, error: "simulated write failure" });
        continue;
      }
      const target = path.join(this.root, file.path);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, file.newContent, { flag: file.kind === "create" ? "wx" : "w" });
      outcomes.push({ path: file.path, applied: true, saved: true, appliedHash: contentHash(file.newContent) });
    }
    return outcomes;
  }

  async referencesFor(p: string): Promise<SourceRef[]> {
    const [snap] = await this.snapshot([p]);
    if (!snap?.exists) return [];
    const endLine = snap.content.split("\n").length;
    return [{ path: p, startLine: 1, endLine, contentHash: rangeHash(snap.content, { startLine: 1, endLine }), status: "resolved" }];
  }

  checkDefinitions() {
    return this.checks;
  }

  runCheck(check: CheckDefinition, signal: AbortSignal) {
    return runCheckProcess(check, this.root, signal);
  }

  async write(p: string, content: string) {
    await writeFile(path.join(this.root, p), content);
  }
}
