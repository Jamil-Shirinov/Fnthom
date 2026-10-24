import { useMemo } from "react";
import { Background, Controls, MarkerType, ReactFlow, type Edge } from "@xyflow/react";
import {
  conceptImplementationState,
  verificationSummary,
  type FeaturePlan,
} from "../../../src/shared/schema";
import { ConceptNode, type ConceptFlowNode } from "./ConceptNode";
import { layoutConcepts } from "./layout";

const nodeTypes = { concept: ConceptNode };

export function ArchitectureGraph(props: {
  plan: FeaturePlan;
  appliedStepIds: ReadonlySet<string>;
  currentStepId: string | null;
  selectedConceptId: string | null;
  onSelect: (conceptId: string | null) => void;
}) {
  const { plan, appliedStepIds, currentStepId, selectedConceptId, onSelect } = props;

  const nodes = useMemo<ConceptFlowNode[]>(() => {
    const positions = layoutConcepts(plan);
    return plan.concepts.map((concept) => ({
      id: concept.id,
      type: "concept",
      position: positions.get(concept.id) ?? { x: 0, y: 0 },
      data: {
        title: concept.title,
        state: conceptImplementationState(concept, plan, appliedStepIds, currentStepId),
        verification: verificationSummary(concept),
        selected: concept.id === selectedConceptId,
      },
      draggable: true,
      connectable: false,
    }));
  }, [plan, appliedStepIds, currentStepId, selectedConceptId]);

  const edges = useMemo<Edge[]>(
    () =>
      plan.edges.map((edge) => ({
        id: edge.id,
        source: edge.fromConceptId,
        target: edge.toConceptId,
        label: edge.label,
        markerEnd: { type: MarkerType.ArrowClosed },
        className: "flow-edge",
      })),
    [plan],
  );

  return (
    <div className="graph" aria-label="Architecture map">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => onSelect(node.id)}
        onPaneClick={() => onSelect(null)}
        nodesConnectable={false}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1.2 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
