// What the controller needs from the editor and file system. The VS Code implementation lives in
// vscodeWorkspace.ts; tests use a Node file-system implementation, so the controller stays testable.

import type { CheckDefinition, CheckStatus, FileChange, FileSnapshot, PlannedFunction } from "../shared/schema";

export type ApplyFileOutcome = { path: string; applied: boolean; saved: boolean; appliedHash?: string; error?: string };

export type CheckRun = { exitCode?: number; output: string; status: CheckStatus };

export interface WorkspacePort {
  /** Workspace-relative paths of the source files worth reading and graphing, in a stable order. */
  listSourceFiles(): Promise<string[]>;
  /** Current content of each path, preferring open editor buffers to disk. Missing files have exists: false. */
  snapshot(paths: string[]): Promise<FileSnapshot[]>;
  /** Paths among these that have unsaved editor changes. */
  dirtyPaths(paths: string[]): Promise<string[]>;
  /** Places a proposal preview in the editor without saving it. */
  previewFunction(proposal: PlannedFunction): Promise<void>;
  /** Saves the currently displayed proposal preview. */
  saveFunctionPreview(functionId: string): Promise<void>;
  /** Removes a proposal preview without saving it. */
  discardFunctionPreview(functionId: string): Promise<void>;
  /** Writes the full contents and saves only the touched files. Never throws; reports per-file outcomes. */
  apply(files: FileChange[]): Promise<ApplyFileOutcome[]>;
  checkDefinitions(): CheckDefinition[];
  runCheck(check: CheckDefinition, signal: AbortSignal): Promise<CheckRun>;
}

/** Source files the graph and the agent look at. Build output, dependencies and VCS data are never source. */
export const SOURCE_FILE = /\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/i;
export const IGNORED_DIR = /(^|\/)(node_modules|dist|out|build|coverage|\.git|\.vscode|\.human-centered-agent)(\/|$)/;
export const MAX_SOURCE_FILES = 400;
export const MAX_SOURCE_BYTES = 1024 * 1024;

export function isSourcePath(path: string): boolean {
  return SOURCE_FILE.test(path) && !IGNORED_DIR.test(path) && !path.endsWith(".d.ts");
}
