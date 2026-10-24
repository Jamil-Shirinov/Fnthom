import { describe, expect, it } from "vitest";
import { CheckDefinition, type FileChange } from "../src/shared/schema";
import { runCheckProcess } from "../src/workspace/checks";
import { validateChanges } from "../src/workspace/edits";
import { contentHash } from "../src/workspace/hash";

const snap = (path: string, content: string | null) => ({
  path,
  exists: content !== null,
  content: content ?? "",
  contentHash: contentHash(content ?? ""),
});

describe("validateChanges", () => {
  const create: FileChange = { kind: "create", path: "src/cache.ts", newContent: "export {};\n" };

  it("accepts a create against a missing file", () => {
    expect(validateChanges([create], [snap("src/cache.ts", null)])).toEqual([]);
  });

  it("flags a create whose target now exists, and a missing baseline, as stale", () => {
    expect(validateChanges([create], [snap("src/cache.ts", "x")])[0]?.kind).toBe("stale");
    expect(validateChanges([create], [])[0]?.kind).toBe("stale");
  });

  it("flags an update whose base changed as stale and a no-op update as invalid", () => {
    const update: FileChange = { kind: "update", path: "src/app.ts", baseHash: contentHash("old"), newContent: "new" };
    expect(validateChanges([update], [snap("src/app.ts", "changed")])[0]?.kind).toBe("stale");
    const noop: FileChange = { kind: "update", path: "src/app.ts", baseHash: contentHash("same"), newContent: "same" };
    expect(validateChanges([noop], [snap("src/app.ts", "same")])[0]?.kind).toBe("invalid");
  });

  it("refuses dependency, VCS and credential paths, and unknown file types", () => {
    for (const path of ["node_modules/x/index.js", ".git/config.txt", ".env.local", "src/image.png"]) {
      const issues = validateChanges([{ kind: "create", path, newContent: "x" }], [snap(path, null)]);
      expect(issues.some((i) => i.kind === "invalid")).toBe(true);
    }
  });
});

describe("runCheckProcess", () => {
  const check = (args: string[], timeoutMs = 10_000) =>
    CheckDefinition.parse({ id: "c", label: "c", executable: process.execPath, args, timeoutMs });

  it("passes on exit 0 and fails on a non-zero exit, capturing plain output", async () => {
    const ok = await runCheckProcess(check(["-e", "console.log('\\u001b[32mhello\\u001b[39m')"]), process.cwd(), new AbortController().signal);
    expect(ok).toMatchObject({ status: "passed", exitCode: 0 });
    expect(ok.output.trim()).toBe("hello");
    const bad = await runCheckProcess(check(["-e", "process.exit(3)"]), process.cwd(), new AbortController().signal);
    expect(bad).toMatchObject({ status: "failed", exitCode: 3 });
  });

  it("times out and can be cancelled", async () => {
    const slow = ["-e", "setTimeout(() => {}, 10000)"];
    expect((await runCheckProcess(check(slow, 200), process.cwd(), new AbortController().signal)).status).toBe("timed-out");
    const abort = new AbortController();
    setTimeout(() => abort.abort(), 100);
    expect((await runCheckProcess(check(slow), process.cwd(), abort.signal)).status).toBe("cancelled");
  });

  it("refuses a working directory outside the workspace", async () => {
    const outside = CheckDefinition.parse({ id: "c", label: "c", executable: "node", cwd: "../..", args: [] });
    expect((await runCheckProcess(outside, process.cwd(), new AbortController().signal)).status).toBe("error");
  });
});
