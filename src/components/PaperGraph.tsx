"use client";

import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import noverlap from "graphology-layout-noverlap";
import { useEffect, useMemo, useRef } from "react";
import Sigma from "sigma";
import type { Settings } from "sigma/settings";

import type { Paper, PaperConnection } from "@/lib/types";

type Props = {
  papers: Paper[];
  connections: PaperConnection[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

const MIN_EDGE_STRENGTH = 0.5;

const CATEGORY_PALETTE = [
  "#c9a96e",
  "#8fa4b3",
  "#b08fa6",
  "#9eb39a",
  "#c08977",
  "#9c9ec4",
  "#b3a780",
  "#7fa3a3",
  "#b89292",
  "#a4a4a4",
];

const DEFAULT_NODE_COLOR = "#7d7770";
const DIMMED_NODE_COLOR = "rgba(164, 156, 145, 0.18)";
const EDGE_COLOR = "rgba(244, 241, 234, 0.12)";
const EDGE_HIGHLIGHT = "rgba(244, 241, 234, 0.42)";
const EDGE_DIMMED = "rgba(244, 241, 234, 0.03)";
const LABEL_COLOR = "#f4f1ea";
const LABEL_DIMMED = "rgba(164, 156, 145, 0.35)";

function hashCategory(category: string): string {
  let hash = 0;
  for (let i = 0; i < category.length; i++) {
    hash = (hash * 31 + category.charCodeAt(i)) | 0;
  }
  const index = Math.abs(hash) % CATEGORY_PALETTE.length;
  return CATEGORY_PALETTE[index];
}

export function PaperGraph({
  papers,
  connections,
  selectedId,
  onSelect,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const hoveredNodeRef = useRef<string | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const validEdges = useMemo(() => {
    const ids = new Set(papers.map((p) => p.id));
    return connections.filter(
      (c) =>
        ids.has(c.paper_a) &&
        ids.has(c.paper_b) &&
        c.paper_a !== c.paper_b &&
        (c.strength ?? 0) >= MIN_EDGE_STRENGTH,
    );
  }, [papers, connections]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (papers.length === 0) return;

    const graph = new Graph({ multi: false, type: "undirected" });

    const degree = new Map<string, number>();
    for (const edge of validEdges) {
      degree.set(edge.paper_a, (degree.get(edge.paper_a) ?? 0) + 1);
      degree.set(edge.paper_b, (degree.get(edge.paper_b) ?? 0) + 1);
    }
    const maxDegree = Math.max(1, ...degree.values());

    const angleStep = (2 * Math.PI) / Math.max(papers.length, 1);
    papers.forEach((paper, index) => {
      const d = degree.get(paper.id) ?? 0;
      const size = 4 + (d / maxDegree) * 14;
      const primaryCategory = paper.categories?.[0] ?? "Other";
      const color = paper.categories?.length
        ? hashCategory(primaryCategory)
        : DEFAULT_NODE_COLOR;

      const radius = 10 + Math.sqrt(papers.length) * 6;
      graph.addNode(paper.id, {
        label: paper.title,
        size,
        color,
        x: Math.cos(index * angleStep) * radius,
        y: Math.sin(index * angleStep) * radius,
        baseColor: color,
        category: primaryCategory,
      });
    });

    for (const edge of validEdges) {
      graph.addEdge(edge.paper_a, edge.paper_b, {
        size: 0.5 + (edge.strength - MIN_EDGE_STRENGTH) * 2,
        color: EDGE_COLOR,
        baseColor: EDGE_COLOR,
        strength: edge.strength,
      });
    }

    const inferred = forceAtlas2.inferSettings(graph);
    forceAtlas2.assign(graph, {
      iterations: 160,
      settings: {
        ...inferred,
        gravity: (inferred.gravity ?? 1) * 1.6,
        scalingRatio: 8,
        slowDown: 6,
        barnesHutOptimize: graph.order > 200,
      },
    });
    noverlap.assign(graph, {
      maxIterations: 50,
      settings: { margin: 2, ratio: 1.1 },
    });

    const settings: Partial<Settings> = {
      renderEdgeLabels: false,
      labelColor: { color: LABEL_COLOR },
      labelSize: 11,
      labelWeight: "500",
      labelFont:
        "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
      labelDensity: 0.6,
      labelGridCellSize: 80,
      labelRenderedSizeThreshold: 7,
      defaultEdgeColor: EDGE_COLOR,
      minCameraRatio: 0.1,
      maxCameraRatio: 8,
    };

    const sigma = new Sigma(graph, container, settings);
    sigmaRef.current = sigma;

    const applyHighlight = (
      activeId: string | null,
      neighbors: Set<string> | null,
    ) => {
      sigma.setSetting("nodeReducer", (id, attrs) => {
        const isActive = activeId === null || id === activeId;
        const isNeighbor = neighbors?.has(id) ?? false;
        if (activeId === null) {
          return { ...attrs, color: attrs.baseColor };
        }
        if (isActive || isNeighbor) {
          return {
            ...attrs,
            color: attrs.baseColor,
            zIndex: 2,
            highlighted: isActive,
          };
        }
        return {
          ...attrs,
          color: DIMMED_NODE_COLOR,
          label: "",
          zIndex: 0,
        };
      });

      sigma.setSetting("edgeReducer", (id, attrs) => {
        if (activeId === null) {
          return { ...attrs, color: EDGE_COLOR };
        }
        const [source, target] = sigma.getGraph().extremities(id);
        if (source === activeId || target === activeId) {
          return { ...attrs, color: EDGE_HIGHLIGHT, zIndex: 1 };
        }
        return { ...attrs, color: EDGE_DIMMED };
      });
    };

    const handleEnter = ({ node }: { node: string }) => {
      hoveredNodeRef.current = node;
      const neighbors = new Set(graph.neighbors(node));
      container.style.cursor = "pointer";
      applyHighlight(node, neighbors);
    };
    const handleLeave = () => {
      hoveredNodeRef.current = null;
      container.style.cursor = "default";
      applyHighlight(null, null);
    };
    const handleClick = ({ node }: { node: string }) => {
      onSelectRef.current(node);
    };

    sigma.on("enterNode", handleEnter);
    sigma.on("leaveNode", handleLeave);
    sigma.on("clickNode", handleClick);

    applyHighlight(null, null);

    return () => {
      sigma.kill();
      sigmaRef.current = null;
    };
  }, [papers, validEdges]);

  useEffect(() => {
    const sigma = sigmaRef.current;
    if (!sigma) return;
    const graph = sigma.getGraph();

    if (selectedId && graph.hasNode(selectedId)) {
      const neighbors = new Set(graph.neighbors(selectedId));
      sigma.setSetting("nodeReducer", (id, attrs) => {
        if (id === selectedId) {
          return { ...attrs, color: attrs.baseColor, highlighted: true, zIndex: 2 };
        }
        if (neighbors.has(id)) {
          return { ...attrs, color: attrs.baseColor, zIndex: 1 };
        }
        return { ...attrs, color: DIMMED_NODE_COLOR, label: "", zIndex: 0 };
      });
      sigma.setSetting("edgeReducer", (id, attrs) => {
        const [source, target] = graph.extremities(id);
        if (source === selectedId || target === selectedId) {
          return { ...attrs, color: EDGE_HIGHLIGHT, zIndex: 1 };
        }
        return { ...attrs, color: EDGE_DIMMED };
      });
      sigma.setSetting("labelColor", { color: LABEL_COLOR });
    } else {
      sigma.setSetting("nodeReducer", (_id, attrs) => ({
        ...attrs,
        color: attrs.baseColor,
      }));
      sigma.setSetting("edgeReducer", (_id, attrs) => ({
        ...attrs,
        color: EDGE_COLOR,
      }));
      sigma.setSetting("labelColor", { color: LABEL_DIMMED });
    }
    sigma.refresh();
  }, [selectedId]);

  const categories = useMemo(() => {
    const seen = new Map<string, string>();
    for (const paper of papers) {
      const cat = paper.categories?.[0];
      if (cat && !seen.has(cat)) {
        seen.set(cat, hashCategory(cat));
      }
      if (seen.size >= 8) break;
    }
    return Array.from(seen.entries());
  }, [papers]);

  if (papers.length === 0) {
    return <GraphEmpty />;
  }

  return (
    <div className="relative h-full w-full bg-surface-2">
      <div ref={containerRef} className="absolute inset-0" />

      <div className="pointer-events-none absolute left-4 top-4 flex items-center gap-2">
        <span className="rounded-md border border-border bg-surface/80 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted backdrop-blur">
          {papers.length} nodes · {validEdges.length} edges
        </span>
      </div>

      {categories.length > 0 && (
        <div className="pointer-events-none absolute bottom-4 left-4 max-w-xs rounded-md border border-border bg-surface/80 px-3 py-2 backdrop-blur">
          <p className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-muted">
            Categories
          </p>
          <ul className="flex flex-wrap gap-x-3 gap-y-1">
            {categories.map(([name, color]) => (
              <li
                key={name}
                className="flex items-center gap-1.5 text-[11px] text-foreground/80"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <span className="truncate">{name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function GraphEmpty() {
  return (
    <div className="flex h-full items-center justify-center bg-surface-2 p-8 text-center">
      <div className="relative w-full max-w-xl rounded-xl border border-border bg-surface px-10 py-14 shadow-[0_2px_8px_rgba(244,241,234,0.035)]">
        <div className="absolute left-8 top-8 flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
        </div>
        <p className="mx-auto max-w-sm font-display text-4xl leading-none tracking-[-0.04em] text-foreground">
          Build a living map of your papers.
        </p>
        <p className="mx-auto mt-4 max-w-sm text-sm leading-6 text-muted">
          Add a paper to see it appear here. Connections form automatically as
          your library grows.
        </p>
      </div>
    </div>
  );
}
