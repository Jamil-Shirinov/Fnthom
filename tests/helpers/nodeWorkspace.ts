// WorkspacePort over a plain directory, for tests. Mirrors the VS Code implementation's contract
// (full-content writes, per-file outcomes) without an editor.

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import type { CheckDefinition, FileChange, FileSnapshot, PlannedFunction } from "../../src/shared/schema";
import { runCheckProcess } from "../../src/workspace/checks";
import { contentHash } from "../../src/workspace/hash";
import { IGNORED_DIR, isSourcePath, type ApplyFileOutcome, type WorkspacePort } from "../../src/workspace/port";

export class NodeWorkspace implements WorkspacePort {
  dirty = new Set<string>();
  failWrites = new Set<string>();
  /** Called after each file is written, to simulate edits racing the apply. */
  onWrite?: (path: string) => void;

  constructor(
    readonly root: string,
    private readonly checks: CheckDefinition[] = [],
  ) {}

  async listSourceFiles(): Promise<string[]> {
    const found: string[] = [];
    const walk = async (dir: string) => {
      for (const entry of await readdir(path.join(this.root, dir), { withFileTypes: true })) {
        const rel = dir ? `${dir}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          if (!IGNORED_DIR.test(rel)) await walk(rel);
        } else if (isSourcePath(rel)) found.push(rel);
      }
    };
    await walk("");
    return found.sort();
  }

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

  async previewFunction(_proposal: PlannedFunction): Promise<void> {}
  async saveFunctionPreview(_functionId: string): Promise<void> {}
  async discardFunctionPreview(_functionId: string): Promise<void> {}

  async apply(files: FileChange[]): Promise<ApplyFileOutcome[]> {
    const outcomes: ApplyFileOutcome[] = [];
    for (const file of files) {
      if (this.failWrites.has(file.path)) {
        outcomes.push({ path: file.path, applied: false, saved: false, error: "simulated write failure" });
        continue;
      }
      const target = path.join(this.root, file.path);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, file.newContent, { flag: file.kind === "create" ? "wx" : "w" });
      outcomes.push({ path: file.path, applied: true, saved: true, appliedHash: contentHash(file.newContent) });
      this.onWrite?.(file.path);
    }
    return outcomes;
  }

  checkDefinitions() {
    return this.checks;
  }

  runCheck(check: CheckDefinition, signal: AbortSignal) {
    return runCheckProcess(check, this.root, signal);
  }

  async write(p: string, content: string) {
    await mkdir(path.dirname(path.join(this.root, p)), { recursive: true });
    await writeFile(path.join(this.root, p), content);
  }
}
