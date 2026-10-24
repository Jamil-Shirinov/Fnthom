import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { ConceptImplementationState, InvariantStatus } from "../../../src/shared/schema";

export type ConceptNodeData = {
  title: string;
  state: ConceptImplementationState;
  verification: InvariantStatus | "none";
  selected: boolean;
};

export type ConceptFlowNode = Node<ConceptNodeData, "concept">;

// Text and icons carry the state as well as color, so the graph reads without color vision.
export const STATE_LABEL: Record<ConceptImplementationState, { icon: string; text: string }> = {
  planned: { icon: "◌", text: "Planned" },
  active: { icon: "▶", text: "Active" },
  applied: { icon: "●", text: "Applied" },
  stale: { icon: "⚠", text: "Stale" },
};

export const VERIFICATION_LABEL: Record<InvariantStatus | "none", string> = {
  supported: "✓ Supported",
  unverified: "? Unverified",
  failed: "✕ Failed",
  stale: "⚠ Evidence stale",
  none: "No claims",
};

export function ConceptNode({ data }: NodeProps<ConceptFlowNode>) {
  const state = STATE_LABEL[data.state];
  return (
    <div className={`concept concept--${data.state}${data.selected ? " concept--selected" : ""}`}>
      <Handle type="target" position={Position.Left} />
      <div className="concept__title">{data.title}</div>
      <div className="concept__meta">
        <span className={`chip chip--${data.state}`}>
          <span aria-hidden="true">{state.icon}</span> {state.text}
        </span>
        <span className={`badge badge--${data.verification}`}>{VERIFICATION_LABEL[data.verification]}</span>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
