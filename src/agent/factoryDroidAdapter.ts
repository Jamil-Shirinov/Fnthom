import { z } from "zod";
import {
  FileChange,
  FileSnapshot,
  PlanningTurn,
  type FileChange as FileChangeType,
  type FileSnapshot as FileSnapshotType,
  type FollowUpExchange,
  type PlannedFunction,
  type PlanningTurn as PlanningTurnType,
} from "../shared/schema";
import { AgentCancelledError, type AgentAdapter, type AgentCallOptions, type Decision } from "./adapter";

export type FactoryDroidAdapterOptions = {
  apiKey?: string;
  execPath?: string;
  cwd?: string;
};

type DroidSessionLike = {
  stream(prompt: string): AsyncIterable<{ type: string; text?: string; success?: boolean; error?: { message?: string } | null; subtype?: string }>;
  close(): Promise<void>;
};

export class FactoryDroidAdapter implements AgentAdapter {
  private readonly apiKey?: string;
  private readonly execPath?: string;
  private readonly cwd?: string;
  private readonly controllers = new Set<AbortController>();
  private session: DroidSessionLike | undefined;

  constructor(options: FactoryDroidAdapterOptions = {}) {
    this.apiKey = options.apiKey?.trim() || process.env.FACTORY_API_KEY?.trim() || undefined;
    this.execPath = options.execPath?.trim() || undefined;
    this.cwd = options.cwd?.trim() || undefined;
  }

  async planNext(
    request: { intent: string; context: FileSnapshot[]; history: PlannedFunction[]; lastDecision: Decision | null },
    options: AgentCallOptions,
  ): Promise<PlanningTurn> {
    const payload = { type: "planNext", request };
    const turn = await this.runJson<PlanningTurn>(
      "Propose the next function or report that the plan is complete. For a proposal, include up to five evidence references only when they directly contextualize the design. Each reference must contain the exact quoted source lines, workspace-relative path, one-based inclusive line range, and a short rationale. Cite only supplied source context; omit unverifiable references. These citations provide context, not proof. Do not set verified or verificationNote.",
      payload,
      options,
      "planning turn",
    );
    return turn;
  }

  async implement(
    request: { intent: string; functions: PlannedFunction[]; context: FileSnapshot[] },
    options: AgentCallOptions,
  ): Promise<FileChange[]> {
    const payload = { type: "implement", request };
    const files = await this.runJson<FileChange[]>("Write the accepted plan as full-content file updates.", payload, options, "implementation output");
    return files;
  }

  async answerQuestion(
    request: { intent: string; proposal: PlannedFunction; history: FollowUpExchange[]; question: string; context: FileSnapshotType[] },
    options: AgentCallOptions,
  ): Promise<string> {
    const payload = { type: "answerQuestion", request };
    const result = await this.runJson<{ answer: string }>(
      "Answer the developer's follow-up about the active proposal using the supplied repository context. Do not revise the proposal, make a new plan, or produce code.",
      payload,
      options,
      "follow-up answer",
    );
    return result.answer;
  }

  async describe(
    request: { nodes: { id: string; name: string; path: string; code: string }[] },
    options: AgentCallOptions,
  ): Promise<Record<string, string>> {
    const payload = { type: "describe", request };
    const result = await this.runJson<Record<string, string>>("Describe the given nodes in one sentence each.", payload, options, "node descriptions");
    return result;
  }

  cancel(): void {
    for (const controller of this.controllers) {
      controller.abort();
    }
    this.controllers.clear();
    void this.closeSession();
  }

  dispose(): void {
    this.cancel();
  }

  private async runJson<T>(instruction: string, payload: unknown, options: AgentCallOptions, label: string): Promise<T> {
    if (options.signal.aborted) throw new AgentCancelledError();
    if (!this.apiKey || !this.apiKey.trim()) {
      throw new Error("Factory API key is required for the Factory Droid adapter. Set it via the command palette or the FACTORY_API_KEY environment variable.");
    }

    const prompt = [
      "You are the Fnthom Factory Droid adapter.",
      "Return raw JSON only. No markdown fences, commentary, or fenced code blocks.",
      "Use the exact schema expected by the application contract.",
      `${instruction}`,
      "JSON payload:",
      JSON.stringify(payload, null, 2),
    ].join("\n");

    const session = await this.getSession(options);
    const combined = new AbortController();
    this.controllers.add(combined);
    const abort = () => combined.abort();
    options.signal.addEventListener("abort", abort, { once: true });

    try {
      let output = "";
      let resultText = "";
      let structuredOutput: unknown = undefined;
      for await (const message of session.stream(prompt)) {
        if (options.signal.aborted) throw new AgentCancelledError();

        const text = typeof message.text === "string" ? message.text : "";
        if (message.type === "assistant" && text) {
          output += text;
        }
        if (message.type === "result") {
          if (text) resultText = text;
          if (typeof (message as { structuredOutput?: unknown }).structuredOutput !== "undefined") {
            structuredOutput = (message as { structuredOutput?: unknown }).structuredOutput;
          }
          if (message.success === false) {
            throw new Error(message.error?.message ?? `${label} failed without a detailed error.`);
          }
        }
      }

      const value = typeof structuredOutput !== "undefined" ? structuredOutput : !output && resultText ? resultText : output;
      if (options.signal.aborted) throw new AgentCancelledError();
      return this.parseJson<T>(value, label);
    } catch (error) {
      await this.closeSession();
      throw error;
    } finally {
      options.signal.removeEventListener("abort", abort);
      this.controllers.delete(combined);
    }
  }

  private async getSession(options: AgentCallOptions): Promise<DroidSessionLike> {
    if (this.session) return this.session;

    const { createSession, DroidMessageType } = await import("@factory/droid-sdk/node");
    void DroidMessageType;

    const session = await createSession({
      apiKey: this.apiKey,
      ...(this.execPath ? { execPath: this.execPath } : {}),
      ...(this.cwd ? { cwd: this.cwd } : {}),
      // Proposal-only mode: keep the agent read-only and let the VS Code controller remain the authority.
      autoRejectPermissionRequests: true,
      disableBuiltinSkills: true,
      abortSignal: options.signal,
    });

    this.session = session;
    return session;
  }

  private async closeSession(): Promise<void> {
    const session = this.session;
    this.session = undefined;
    if (!session) return;

    try {
      await session.close();
    } catch {
      // best-effort cleanup for a cancelled or disconnected session
    }
  }

  private parseJson<T>(value: unknown, label: string): T {
    if (typeof value === "object" && value !== null) {
      const schema = this.schemaForLabel(label);
      const result = schema.safeParse(value);
      if (!result.success) {
        const details = result.error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`).join("; ");
        throw new Error(`${label} returned invalid data: ${details}. Raw output: ${JSON.stringify(value).slice(0, 200)}`);
      }
      return result.data as T;
    }

    const text = typeof value === "string" ? value : String(value ?? "");
    const trimmed = text.trim();
    if (!trimmed) {
      throw new Error(`${label} returned no content.`);
    }

    const match = trimmed.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    const jsonText = match ? match[0] : trimmed;

    try {
      const parsed = JSON.parse(jsonText) as unknown;
      const schema = this.schemaForLabel(label);
      const result = schema.safeParse(parsed);
      if (!result.success) {
        const details = result.error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`).join("; ");
        throw new Error(`${label} returned invalid data: ${details}. Raw output: ${trimmed.slice(0, 200)}`);
      }
      return result.data as T;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith(`${label} returned invalid data:`)) {
        throw error;
      }
      throw new Error(`${label} did not return valid JSON. Raw output: ${trimmed.slice(0, 200)}`);
    }
  }

  private schemaForLabel(label: string) {
    switch (label) {
      case "planning turn":
        return PlanningTurn;
      case "implementation output":
        return z.array(FileChange);
      case "node descriptions":
        return z.record(z.string(), z.string());
      case "follow-up answer":
        return z.object({ answer: z.string().trim().min(1).max(8000) });
      default:
        return z.any();
    }
  }
}
