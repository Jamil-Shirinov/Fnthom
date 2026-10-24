import { createHash } from "node:crypto";

/** Hash of the exact string, line endings included. Prefixed so the algorithm can change later. */
export function contentHash(content: string): string {
  return "sha256:" + createHash("sha256").update(content, "utf8").digest("hex");
}
