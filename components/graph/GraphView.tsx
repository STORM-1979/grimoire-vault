"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface Node {
  id: string;
  title: string;
  categoryId: string;
  tags: string[];
  // Mutated by the simulation:
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null; // pinned position when user drags
  fy?: number | null;
}

interface Edge {
  source: string;
  target: string;
  kind: "backlink" | "tag";
}

const CATEGORY_COLOURS: Record<string, string> = {
  documents: "#7d9b78",
  web: "#86b6c4",
  youtube: "#d77b6c",
  local: "#b39e6f",
  designs: "#c8a8e0",
  images: "#e8c45c",
  skills: "#a3d9a5",
  prompts: "#f0a8a8",
  kanban: "#d4b76a",
  ideas: "#f7d96e",
  portfolio: "#a0e3d6",
  misc: "#888",
  credentials: "#aaa",
};

const WIDTH = 1200;
const HEIGHT = 720;

/**
 * Pure-SVG, dependency-free force-directed graph.  Implements the
 * three classic forces (link spring, electrostatic repulsion, soft
 * gravity to centre) with a fixed-step Verlet-ish integrator.
 *
 *   - O(n²) repulsion is fine up to ~1000 nodes.  Beyond that we'd
 *     need a Barnes-Hut quadtree, but we don't have that many records.
 *   - The simulation runs in requestAnimationFrame for ~3 s (until
 *     kinetic energy drops below a threshold), then idles.  Dragging
 *     a node restarts it.
 */
export function GraphView({ nodes: rawNodes, edges }: { nodes: Node[]; edges: Edge[] }) {
  const router = useRouter();
  const [nodes, setNodes] = useState<Node[]>(() => initPositions(rawNodes));
  const [hovered, setHovered] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const tickRef = useRef<number | null>(null);
  const energyRef = useRef(Infinity);
  const idMap = useRef(new Map<string, Node>());

  // Build id → node map once for edge lookup.
  useEffect(() => {
    idMap.current = new Map(nodes.map((n) => [n.id, n]));
  }, [nodes]);

  // Simulation loop — runs as long as the system has energy.
  useEffect(() => {
    let running = true;
    const step = () => {
      if (!running) return;
      const ns = idMap.current;
      let energy = 0;
      // Reset accumulators.
      for (const n of nodes) {
        n.vx = (n.vx ?? 0) * 0.85;
        n.vy = (n.vy ?? 0) * 0.85;
      }
      // Repulsion.
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          const dx = (b.x! - a.x!) || 0.01;
          const dy = (b.y! - a.y!) || 0.01;
          const d2 = dx * dx + dy * dy;
          const force = 1800 / d2;
          const d = Math.sqrt(d2);
          const fx = (force * dx) / d;
          const fy = (force * dy) / d;
          a.vx! -= fx;
          a.vy! -= fy;
          b.vx! += fx;
          b.vy! += fy;
        }
      }
      // Spring along edges.
      for (const e of edges) {
        const s = ns.get(e.source);
        const t = ns.get(e.target);
        if (!s || !t) continue;
        const dx = t.x! - s.x!;
        const dy = t.y! - s.y!;
        const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
        const target = e.kind === "backlink" ? 90 : 140;
        const force = 0.04 * (d - target);
        s.vx! += (force * dx) / d;
        s.vy! += (force * dy) / d;
        t.vx! -= (force * dx) / d;
        t.vy! -= (force * dy) / d;
      }
      // Gravity to centre + integrate.
      for (const n of nodes) {
        n.vx! += (WIDTH / 2 - n.x!) * 0.002;
        n.vy! += (HEIGHT / 2 - n.y!) * 0.002;
        if (n.fx == null) n.x! += n.vx!;
        if (n.fy == null) n.y! += n.vy!;
        // Bounds.
        n.x = Math.max(20, Math.min(WIDTH - 20, n.x!));
        n.y = Math.max(20, Math.min(HEIGHT - 20, n.y!));
        energy += n.vx! ** 2 + n.vy! ** 2;
      }
      energyRef.current = energy;
      // Force a re-render so React sees new positions.
      setNodes((prev) => [...prev]);
      if (energy < 0.5 && !dragId) return;
      tickRef.current = requestAnimationFrame(step);
    };
    tickRef.current = requestAnimationFrame(step);
    return () => {
      running = false;
      if (tickRef.current) cancelAnimationFrame(tickRef.current);
    };
    // We deliberately exclude `nodes` from deps — the simulation
    // mutates them in place and re-renders via setNodes.  Including
    // it would restart the loop after every step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edges, dragId]);

  // Pointer drag — pins a node's position while held.
  const onPointerDown = (id: string, e: React.PointerEvent<SVGCircleElement>) => {
    e.stopPropagation();
    e.preventDefault();
    setDragId(id);
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragId) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const scaleX = WIDTH / rect.width;
    const scaleY = HEIGHT / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;
    const node = nodes.find((n) => n.id === dragId);
    if (!node) return;
    node.fx = mx;
    node.fy = my;
    node.x = mx;
    node.y = my;
    energyRef.current = 5; // wake the loop
  };
  const onPointerUp = () => {
    if (!dragId) return;
    const node = nodes.find((n) => n.id === dragId);
    if (node) {
      node.fx = null;
      node.fy = null;
    }
    setDragId(null);
  };

  return (
    <div className="rounded-xl border border-white/10 bg-emerald-deep/40 overflow-hidden">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        className="w-full h-auto cursor-grab"
        style={{ touchAction: "none" }}
      >
        {/* Edges first so they render under nodes. */}
        {edges.map((e, i) => {
          const s = idMap.current.get(e.source);
          const t = idMap.current.get(e.target);
          if (!s?.x || !t?.x) return null;
          return (
            <line
              key={i}
              x1={s.x}
              y1={s.y}
              x2={t.x}
              y2={t.y}
              stroke={e.kind === "backlink" ? "rgba(212,183,106,0.6)" : "rgba(255,255,255,0.08)"}
              strokeWidth={e.kind === "backlink" ? 1.5 : 0.6}
            />
          );
        })}
        {nodes.map((n) => {
          const colour = CATEGORY_COLOURS[n.categoryId] ?? "#888";
          const isHovered = hovered === n.id;
          return (
            <g key={n.id}>
              <circle
                cx={n.x}
                cy={n.y}
                r={isHovered ? 9 : 6}
                fill={colour}
                stroke={isHovered ? "#fff" : "rgba(0,0,0,0.4)"}
                strokeWidth={1.2}
                onPointerDown={(e) => onPointerDown(n.id, e)}
                onMouseEnter={() => setHovered(n.id)}
                onMouseLeave={() => setHovered((p) => (p === n.id ? null : p))}
                onClick={() => router.push(`/entry/${n.id}`)}
                className="cursor-pointer transition-[r]"
              />
              {isHovered && (
                <text
                  x={n.x! + 12}
                  y={(n.y ?? 0) + 4}
                  fill="#fff"
                  fontSize={12}
                  fontFamily="monospace"
                  pointerEvents="none"
                  style={{
                    paintOrder: "stroke",
                    stroke: "rgba(0,0,0,0.7)",
                    strokeWidth: 3,
                    strokeLinejoin: "round",
                  }}
                >
                  {n.title.slice(0, 60)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="px-5 py-3 border-t border-white/10 font-mono text-[10px] uppercase tracking-widest text-ivory-mute flex flex-wrap items-center gap-x-5 gap-y-2">
        <span>цвета:</span>
        {Object.entries(CATEGORY_COLOURS).slice(0, 10).map(([cat, colour]) => (
          <span key={cat} className="flex items-center gap-1.5">
            <span
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: colour }}
            />
            {cat}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ---------- helpers ---------- */

function initPositions(nodes: Omit<Node, "x" | "y" | "vx" | "vy">[]): Node[] {
  // Spread initial positions in a tight cluster around centre so the
  // simulation can fan them out instead of teleporting from corners.
  return nodes.map((n) => ({
    ...n,
    x: WIDTH / 2 + (Math.random() - 0.5) * 200,
    y: HEIGHT / 2 + (Math.random() - 0.5) * 200,
    vx: 0,
    vy: 0,
    fx: null,
    fy: null,
  }));
}
