// Pure validation of the agent's file changes (application-spec.md, section 9). The host's own snapshots
// are authoritative; hashes the model supplies are only compared against them.

import type { FileChange, FileSnapshot } from "../shared/schema";

export const MAX_CHANGE_BYTES = 2 * 1024 * 1024;

const TEXT_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|json|md|css|html|yml|yaml|txt)$/i;
const BLOCKED = /(^|\/)(\.git|node_modules|dist|\.env[^/]*)(\/|$)/;

export type ChangeIssue = { path?: string; kind: "invalid" | "stale"; message: string };

/** Checks file changes against the current snapshots. Stale issues mean "generate again", not "broken". */
export function validateChanges(files: FileChange[], snapshots: FileSnapshot[], allowedNoopPaths: ReadonlySet<string> = new Set()): ChangeIssue[] {
  const issues: ChangeIssue[] = [];
  let bytes = 0;
  for (const file of files) {
    bytes += file.newContent.length;
    if (!TEXT_EXTENSIONS.test(file.path)) issues.push({ path: file.path, kind: "invalid", message: `Unsupported file type: ${file.path}` });
    if (BLOCKED.test(file.path)) issues.push({ path: file.path, kind: "invalid", message: `Refusing to write to ${file.path}` });

    const snapshot = snapshots.find((s) => s.path === file.path);
    if (!snapshot) {
      issues.push({ path: file.path, kind: "stale", message: `No baseline was captured for ${file.path}.` });
      continue;
    }
    if (file.kind === "create" && snapshot.exists) {
      issues.push({ path: file.path, kind: "stale", message: `${file.path} already exists, so it cannot be created.` });
    }
    if (file.kind === "update") {
      if (!snapshot.exists) issues.push({ path: file.path, kind: "stale", message: `${file.path} no longer exists.` });
      else if (snapshot.contentHash !== file.baseHash) {
        issues.push({ path: file.path, kind: "stale", message: `${file.path} changed since the code was generated.` });
      } else if (snapshot.content === file.newContent && !allowedNoopPaths.has(file.path)) {
        issues.push({ path: file.path, kind: "invalid", message: `The generated code does not change ${file.path}.` });
      }
    }
  }
  if (bytes > MAX_CHANGE_BYTES) issues.push({ kind: "invalid", message: "The generated code is larger than the 2 MiB limit." });
  return issues;
}
