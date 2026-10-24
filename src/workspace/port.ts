// What the controller needs from the editor and file system. The VS Code implementation lives in
// vscodeWorkspace.ts; tests use a Node file-system implementation, so the controller stays testable.

import type { CheckDefinition, CheckStatus, FileSnapshot, SourceRef, StepProposal } from "../shared/schema";

export type ApplyFileOutcome = { path: string; applied: boolean; saved: boolean; appliedHash?: string; error?: string };

export type CheckRun = { exitCode?: number; output: string; status: CheckStatus };

export interface WorkspacePort {
  /** Current content of each path, preferring open editor buffers to disk. Missing files have exists: false. */
  snapshot(paths: string[]): Promise<FileSnapshot[]>;
  /** Paths among these that have unsaved editor changes. */
  dirtyPaths(paths: string[]): Promise<string[]>;
  /** Writes the proposal's full contents and saves only the touched files. Never throws; reports per-file outcomes. */
  apply(proposal: StepProposal): Promise<ApplyFileOutcome[]>;
  /** Source references for the symbols in a file, or one whole-file reference when symbols are unavailable. */
  referencesFor(path: string): Promise<SourceRef[]>;
  checkDefinitions(): CheckDefinition[];
  runCheck(check: CheckDefinition, signal: AbortSignal): Promise<CheckRun>;
}
