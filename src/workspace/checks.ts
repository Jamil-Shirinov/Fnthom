// Runs developer-configured checks as argument arrays (application-spec.md, section 10).
// Check commands come from settings, never from model text.

import { spawn } from "node:child_process";
import * as path from "node:path";
import type { CheckDefinition } from "../shared/schema";
import type { CheckRun } from "./port";

export const MAX_CHECK_OUTPUT = 64 * 1024;

export function runCheckProcess(check: CheckDefinition, workspaceRoot: string, signal: AbortSignal): Promise<CheckRun> {
  const cwd = path.resolve(workspaceRoot, check.cwd);
  if (path.relative(workspaceRoot, cwd).startsWith("..")) {
    return Promise.resolve({ output: `Check "${check.id}" has a working directory outside the workspace.`, status: "error" });
  }

  return new Promise((resolve) => {
    let output = "";
    let truncated = false;
    let settled = false;
    const append = (chunk: Buffer) => {
      if (output.length >= MAX_CHECK_OUTPUT) {
        truncated = true;
        return;
      }
      output += chunk.toString("utf8");
      if (output.length > MAX_CHECK_OUTPUT) {
        output = output.slice(0, MAX_CHECK_OUTPUT);
        truncated = true;
      }
    };
    const finish = (run: CheckRun) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve({ ...run, output: truncated ? `${run.output}\n[output truncated at 64 KiB]` : run.output });
    };

    // Windows needs a shell to launch npm.cmd and similar; the command still comes only from settings.
    const child = spawn(check.executable, check.args, {
      cwd,
      shell: process.platform === "win32",
      detached: process.platform !== "win32",
      env: { ...process.env, CI: "1", FORCE_COLOR: "0" },
    });
    const kill = () => {
      if (child.pid === undefined) return;
      try {
        if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"]);
        else process.kill(-child.pid, "SIGTERM"); // the whole process group, so test runners' workers die too
      } catch {
        child.kill("SIGTERM");
      }
    };
    const onAbort = () => {
      kill();
      finish({ output, status: "cancelled" });
    };
    const timer = setTimeout(() => {
      kill();
      finish({ output: `${output}\n[timed out after ${check.timeoutMs} ms]`, status: "timed-out" });
    }, check.timeoutMs);

    signal.addEventListener("abort", onAbort);
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    child.on("error", (err) => finish({ output: `${output}${err.message}`, status: "error" }));
    child.on("close", (code) => finish({ exitCode: code ?? undefined, output, status: code === 0 ? "passed" : "failed" }));
  });
}
