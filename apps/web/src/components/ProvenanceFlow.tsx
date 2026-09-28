/**
 * Provenance graph — lineage rendered with React Flow. Layout is a simple
 * generational tree: depth from the root decides the row, siblings spread
 * horizontally. Solid edges are version succession; dashed edges are
 * derivations (e.g. model trained on dataset).
 */
import { useMemo } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useNavigate } from 'react-router-dom';
import type { ProvenanceGraph } from '../lib/api';
import { shortHex, timeAgo } from '../lib/format';
import { RiskTag, Tag, TypeTag } from './ui';

type PNodeData = ProvenanceGraph['nodes'][number] & Record<string, unknown>;

function ProvenanceNode({ data }: NodeProps) {
  const d = data as PNodeData;
  return (
    <div className={`flow-node${d.focus ? ' focus' : ''}${d.active ? '' : ' inactive'}`}>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <div className="fn-meta">
        <TypeTag type={d.artifactType} />
        <span className="mono-xs dim">#{d.chainId}</span>
        {!d.active && <Tag tone="warn" dot={false}>REVOKED</Tag>}
      </div>
      <div className="fn-name">
        {d.name} <span className="accent">{d.version}</span>
      </div>
      <div className="mono-xs dim">{shortHex(d.artifactHash, 14, 8)}</div>
      <div className="fn-meta mono-xs faint">
        <span>{shortHex(d.ownerAddress, 8, 4)}</span>
        <span>{timeAgo(d.registeredAt)}</span>
        {d.riskLevel && <RiskTag level={d.riskLevel} />}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  );
}

const nodeTypes = { artifact: ProvenanceNode };

const NODE_W = 250;
const NODE_H = 130;

export function ProvenanceFlow({ graph, height = 520 }: { graph: ProvenanceGraph; height?: number }) {
  const navigate = useNavigate();

  const { nodes, edges } = useMemo(() => {
    const childrenOf = new Map<number, number[]>();
    const hasParent = new Set<number>();
    for (const e of graph.edges) {
      childrenOf.set(e.from, [...(childrenOf.get(e.from) ?? []), e.to]);
      hasParent.add(e.to);
    }
    const roots = graph.nodes.filter((n) => !hasParent.has(n.chainId)).map((n) => n.chainId);

    // BFS: depth → row, order within depth → column.
    const depth = new Map<number, number>();
    const queue = [...roots];
    roots.forEach((r) => depth.set(r, 0));
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const child of childrenOf.get(cur) ?? []) {
        if (!depth.has(child)) {
          depth.set(child, (depth.get(cur) ?? 0) + 1);
          queue.push(child);
        }
      }
    }
    const byDepth = new Map<number, number[]>();
    for (const n of graph.nodes) {
      const d = depth.get(n.chainId) ?? 0;
      byDepth.set(d, [...(byDepth.get(d) ?? []), n.chainId]);
    }
    const maxRowLen = Math.max(1, ...[...byDepth.values()].map((r) => r.length));

    const nodes: Node[] = graph.nodes.map((n) => {
      const d = depth.get(n.chainId) ?? 0;
      const row = byDepth.get(d) ?? [];
      const idx = row.indexOf(n.chainId);
      const rowWidth = row.length * (NODE_W + 40);
      const totalWidth = maxRowLen * (NODE_W + 40);
      return {
        id: String(n.chainId),
        type: 'artifact',
        position: {
          x: (totalWidth - rowWidth) / 2 + idx * (NODE_W + 40),
          y: d * (NODE_H + 60),
        },
        data: n as unknown as Record<string, unknown>,
      };
    });

    const edges: Edge[] = graph.edges.map((e) => ({
      id: `${e.from}-${e.to}`,
      source: String(e.from),
      target: String(e.to),
      animated: e.kind === 'derived',
      label: e.kind === 'derived' ? 'derived' : undefined,
      labelStyle: { fill: 'var(--ink-faint)', fontFamily: 'var(--font-mono)', fontSize: 10 },
      labelBgStyle: { fill: 'var(--bg0)' },
      style: {
        stroke: e.kind === 'derived' ? 'var(--chart-2)' : 'var(--accent)',
        strokeWidth: 1.5,
        strokeDasharray: e.kind === 'derived' ? '5 4' : undefined,
      },
    }));

    return { nodes, edges };
  }, [graph]);

  return (
    <div style={{ height, border: '1px solid var(--line)', borderRadius: 2, background: 'var(--bg0)' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
        minZoom={0.3}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, node) => navigate(`/app/artifacts/${node.id}`)}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#26292e" />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
    </div>
  );
}
