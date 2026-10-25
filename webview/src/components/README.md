# Product interface components

- `PlanningView.tsx`: the planning loop. Decided functions, the current proposal with Accept and Rework (with an optional reason), and the upcoming functions.
- `FunctionGraph.tsx`: the React Flow graph of functions and calls, laid out top to bottom with dagre. Clicking a node shows its pop-up and asks the host to open its code in an editor tab. While planning, accepted functions are drawn as dashed planned nodes. Related functions are grouped (`src/workspace/clusters.ts`): zoomed in, each group gets a faint outline; zoomed out past about a third, each group becomes a named circle and the arrows between groups are merged into one per pair, with a count. Open the preview with `?large` to see an 83-function project.
- `ResultPanel.tsx`: what the feature changed, check results, diffs, the graph legend, and export.

Components send explicit host messages for every action; the host owns state and file access. Add components when they earn a distinct responsibility.
