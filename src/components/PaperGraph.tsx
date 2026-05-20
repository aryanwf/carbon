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

type GraphEdge = Pick<
  PaperConnection,
  "id" | "paper_a" | "paper_b" | "strength" | "relation_type"
>;

const MIN_EDGE_STRENGTH = 0.5;
const SUBJECT_EDGE_STRENGTH = 0.58;
const SUBJECT_EDGE_SPAN = 2;

const SUBJECT_COLORS: Record<string, string> = {
  "Computer Science": "#8fa4b3",
  Mathematics: "#c9a96e",
  Physics: "#9c9ec4",
  "Statistics & Data": "#7fa3a3",
  "Biology & Medicine": "#9eb39a",
  Engineering: "#c08977",
  "Chemistry & Materials": "#b08fa6",
  "Economics & Finance": "#b3a780",
  "Social Science": "#b89292",
};

const DEFAULT_NODE_COLOR = "#7d7770";
const DIMMED_NODE_COLOR = "rgba(164, 156, 145, 0.18)";
const EDGE_COLOR = "rgba(244, 241, 234, 0.12)";
const EDGE_HIGHLIGHT = "rgba(244, 241, 234, 0.42)";
const EDGE_DIMMED = "rgba(244, 241, 234, 0.03)";
const LABEL_COLOR = "#171513";
const LABEL_DIMMED = "rgba(164, 156, 145, 0.35)";

function subjectColor(subject: string): string {
  return SUBJECT_COLORS[subject] ?? DEFAULT_NODE_COLOR;
}

function getPaperSubject(paper: Paper): string {
  const categoryText = paper.categories.join(" ");

  for (const category of paper.categories) {
    const codePrefix = category.match(/\b([a-z-]+)\.[a-z]{2}\b/i)?.[1]?.toLowerCase();
    if (!codePrefix) continue;

    if (codePrefix === "cs") return "Computer Science";
    if (codePrefix === "math") return "Mathematics";
    if (codePrefix === "physics" || codePrefix.startsWith("astro-ph")) {
      return "Physics";
    }
    if (codePrefix === "stat") return "Statistics & Data";
    if (codePrefix === "q-bio") return "Biology & Medicine";
    if (codePrefix === "eess") return "Engineering";
    if (codePrefix === "q-fin") return "Economics & Finance";
    if (codePrefix === "econ") return "Economics & Finance";
  }

  const text = `${categoryText} ${paper.title} ${paper.abstract ?? ""}`.toLowerCase();

  if (hasAny(text, ["computer", "software", "algorithm", "machine learning", "neural", "language model", "vision", "robot"])) {
    return "Computer Science";
  }
  if (hasAny(text, ["statistics", "bayesian", "regression", "causal", "data science"])) {
    return "Statistics & Data";
  }
  if (hasAny(text, ["biology", "biomedical", "medicine", "clinical", "genome", "protein", "cell"])) {
    return "Biology & Medicine";
  }
  if (hasAny(text, ["physics", "quantum", "cosmology", "particle", "optical", "relativity"])) {
    return "Physics";
  }
  if (hasAny(text, ["mathematics", "theorem", "algebra", "geometry", "topology"])) {
    return "Mathematics";
  }
  if (hasAny(text, ["engineering", "electronics", "signal processing", "control system", "power system"])) {
    return "Engineering";
  }
  if (hasAny(text, ["chemistry", "chemical", "material", "polymer", "catalyst"])) {
    return "Chemistry & Materials";
  }
  if (hasAny(text, ["economics", "finance", "market", "pricing", "auction"])) {
    return "Economics & Finance";
  }
  if (hasAny(text, ["psychology", "sociology", "education", "policy", "social"])) {
    return "Social Science";
  }

  return "Other";
}

function hasAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle));
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

  const subjectByPaperId = useMemo(() => {
    const subjects = new Map<string, string>();
    for (const paper of papers) {
      subjects.set(paper.id, getPaperSubject(paper));
    }
    return subjects;
  }, [papers]);

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

  const graphEdges = useMemo<GraphEdge[]>(() => {
    const edges: GraphEdge[] = [...validEdges];
    const edgeKeys = new Set(
      validEdges.map((edge) => edgeKey(edge.paper_a, edge.paper_b)),
    );
    const papersBySubject = new Map<string, Paper[]>();

    for (const paper of papers) {
      const subject = subjectByPaperId.get(paper.id) ?? "Other";
      papersBySubject.set(subject, [...(papersBySubject.get(subject) ?? []), paper]);
    }

    for (const [subject, subjectPapers] of papersBySubject) {
      for (let index = 0; index < subjectPapers.length; index++) {
        for (let offset = 1; offset <= SUBJECT_EDGE_SPAN; offset++) {
          const source = subjectPapers[index];
          const target = subjectPapers[index + offset];
          if (!source || !target) continue;

          const key = edgeKey(source.id, target.id);
          if (edgeKeys.has(key)) continue;

          edgeKeys.add(key);
          edges.push({
            id: `subject:${subject}:${source.id}:${target.id}`,
            paper_a: source.id,
            paper_b: target.id,
            strength: SUBJECT_EDGE_STRENGTH,
            relation_type: "subject",
          });
        }
      }
    }

    return edges;
  }, [papers, subjectByPaperId, validEdges]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (papers.length === 0) return;

    const graph = new Graph({ multi: false, type: "undirected" });

    const degree = new Map<string, number>();
    for (const edge of graphEdges) {
      degree.set(edge.paper_a, (degree.get(edge.paper_a) ?? 0) + 1);
      degree.set(edge.paper_b, (degree.get(edge.paper_b) ?? 0) + 1);
    }
    const maxDegree = Math.max(1, ...degree.values());
    const subjectOrder = Array.from(new Set(subjectByPaperId.values()));
    const subjectIndex = new Map(
      subjectOrder.map((subject, index) => [subject, index]),
    );

    const angleStep = (2 * Math.PI) / Math.max(papers.length, 1);
    papers.forEach((paper, index) => {
      const d = degree.get(paper.id) ?? 0;
      const size = 4 + (d / maxDegree) * 14;
      const subject = subjectByPaperId.get(paper.id) ?? "Other";
      const color = subjectColor(subject);
      const subjectAngle =
        ((subjectIndex.get(subject) ?? 0) / Math.max(subjectOrder.length, 1)) *
        2 *
        Math.PI;
      const subjectRadius = 28 + Math.sqrt(papers.length) * 9;
      const localRadius = 4 + Math.sqrt(papers.length) * 2;

      graph.addNode(paper.id, {
        label: "",
        fullLabel: paper.title,
        size,
        color,
        x:
          Math.cos(subjectAngle) * subjectRadius +
          Math.cos(index * angleStep) * localRadius,
        y:
          Math.sin(subjectAngle) * subjectRadius +
          Math.sin(index * angleStep) * localRadius,
        baseColor: color,
        category: subject,
      });
    });

    for (const edge of graphEdges) {
      graph.addEdge(edge.paper_a, edge.paper_b, {
        size:
          edge.relation_type === "subject"
            ? 0.35
            : 0.5 + (edge.strength - MIN_EDGE_STRENGTH) * 2,
        color: EDGE_COLOR,
        baseColor: EDGE_COLOR,
        strength: edge.strength,
        relationType: edge.relation_type,
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
          return { ...attrs, color: attrs.baseColor, label: "" };
        }
        if (isActive || isNeighbor) {
          return {
            ...attrs,
            color: attrs.baseColor,
            label: isActive ? String(attrs.fullLabel ?? "") : "",
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
  }, [papers, subjectByPaperId, graphEdges]);

  useEffect(() => {
    const sigma = sigmaRef.current;
    if (!sigma) return;
    const graph = sigma.getGraph();

    if (selectedId && graph.hasNode(selectedId)) {
      const neighbors = new Set(graph.neighbors(selectedId));
      sigma.setSetting("nodeReducer", (id, attrs) => {
        if (id === selectedId) {
          return {
            ...attrs,
            color: attrs.baseColor,
            highlighted: true,
            label: "",
            zIndex: 2,
          };
        }
        if (neighbors.has(id)) {
          return { ...attrs, color: attrs.baseColor, label: "", zIndex: 1 };
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
        label: "",
      }));
      sigma.setSetting("edgeReducer", (_id, attrs) => ({
        ...attrs,
        color: EDGE_COLOR,
      }));
      sigma.setSetting("labelColor", { color: LABEL_DIMMED });
    }
    sigma.refresh();
  }, [selectedId]);

  const subjects = useMemo(() => {
    const seen = new Map<string, string>();
    for (const paper of papers) {
      const subject = subjectByPaperId.get(paper.id) ?? "Other";
      if (!seen.has(subject)) {
        seen.set(subject, subjectColor(subject));
      }
    }
    return Array.from(seen.entries());
  }, [papers, subjectByPaperId]);

  if (papers.length === 0) {
    return <GraphEmpty />;
  }

  return (
    <div className="relative h-full w-full bg-surface-2">
      <div ref={containerRef} className="absolute inset-0" />

      <div className="pointer-events-none absolute left-4 top-4 flex items-center gap-2">
        <span className="rounded-md border border-border bg-surface/80 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted backdrop-blur">
          {papers.length} nodes · {graphEdges.length} links
        </span>
      </div>

      {subjects.length > 0 && (
        <div className="pointer-events-none absolute bottom-4 left-4 max-w-xs rounded-md border border-border bg-surface/80 px-3 py-2 backdrop-blur">
          <p className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-muted">
            Subjects
          </p>
          <ul className="flex flex-wrap gap-x-3 gap-y-1">
            {subjects.map(([name, color]) => (
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

function edgeKey(source: string, target: string): string {
  return source < target ? `${source}:${target}` : `${target}:${source}`;
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
