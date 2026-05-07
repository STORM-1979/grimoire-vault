import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { GraphView } from "@/components/graph/GraphView";

/**
 * /graph — force-directed visualisation of every entry as a node
 * and either shared-tag-coincidences or [[wikilink]] backlinks as
 * edges.  Server-side fetch is intentionally compact: just the
 * fields the layout needs.
 */
// Hard cap so a future 10K-entry vault doesn't choke the page.
// Sorted by created_at desc so the most recent entries always make
// the cut.
const GRAPH_NODE_CAP = 1500;

export default async function GraphPage() {
  const supabase = await createClient();
  // Run both reads in parallel — entries and backlinks are
  // independent.  Saves a round-trip on every /graph navigation.
  const [entryResp, backlinkResp] = await Promise.all([
    supabase
      .from("entries")
      .select("id, title, category_id, tags, created_at")
      .order("created_at", { ascending: false })
      .limit(GRAPH_NODE_CAP),
    supabase
      .from("entry_backlinks")
      .select("source_id, target_id")
      .not("target_id", "is", null),
  ]);
  const entryRows = entryResp.data;
  const backlinkRows = backlinkResp.data;

  const nodes = (entryRows ?? []).map((r) => ({
    id: r.id as string,
    title: r.title as string,
    categoryId: r.category_id as string,
    tags: (r.tags as string[]) ?? [],
  }));

  const edges = new Set<string>();
  const edgeList: { source: string; target: string; kind: "backlink" | "tag" }[] = [];
  for (const b of backlinkRows ?? []) {
    const key = [b.source_id, b.target_id].sort().join("|") + "|backlink";
    if (!edges.has(key)) {
      edges.add(key);
      edgeList.push({
        source: b.source_id as string,
        target: b.target_id as string,
        kind: "backlink",
      });
    }
  }

  // Tag co-occurrence — naive pair-iteration was O(n²).  Bucketing
  // entries by tag first turns it into O(t · k²) where t is unique
  // tag count and k is the avg number of entries per tag.  For
  // 1500 entries × 5-10 tags / entry × maybe 50-200 unique tags,
  // the bucketed pass is ~100× faster.
  const byTag = new Map<string, number[]>();
  for (let i = 0; i < nodes.length; i++) {
    for (const t of nodes[i].tags) {
      const arr = byTag.get(t) ?? [];
      arr.push(i);
      byTag.set(t, arr);
    }
  }
  // Count shared-tag occurrences per (i, j) pair via the bucket.
  const pairCounts = new Map<string, number>();
  for (const indices of byTag.values()) {
    if (indices.length < 2) continue;
    for (let a = 0; a < indices.length; a++) {
      for (let b = a + 1; b < indices.length; b++) {
        const i = indices[a];
        const j = indices[b];
        const key = i < j ? `${i}|${j}` : `${j}|${i}`;
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }
  }
  for (const [key, count] of pairCounts.entries()) {
    if (count < 2) continue;
    const [i, j] = key.split("|").map(Number);
    const edgeKey = [nodes[i].id, nodes[j].id].sort().join("|") + "|tag";
    if (!edges.has(edgeKey)) {
      edges.add(edgeKey);
      edgeList.push({ source: nodes[i].id, target: nodes[j].id, kind: "tag" });
    }
  }

  return (
    <div className="fade-in">
      <section className="max-w-[1480px] mx-auto px-10 pt-12 pb-6 border-b border-white/10">
        <div className="flex items-center gap-3 mb-6 text-[12px] font-mono uppercase tracking-widest text-ivory-mute">
          <Link href="/" className="hover:text-gold">Главная</Link>
          <span>/</span>
          <span className="text-gold">Graph</span>
        </div>

        <div>
          <div className="font-mono text-[11px] uppercase tracking-widest text-gold mb-2">
            Network · {nodes.length} узлов · {edgeList.length} связей
          </div>
          <h1 className="font-display text-[64px] font-light leading-[0.95] tracking-tightest mb-3">
            Граф знаний
          </h1>
          <p className="text-[14px] text-ivory-dim font-light max-w-2xl">
            Каждый узел — запись, цвет — категория.  Толстые золотые линии —
            явные [[backlinks]] в тексте, тонкие — общие теги (≥ 2).
            Перетаскивай узлы, наводись для названия, кликай — открывается
            запись.
          </p>
        </div>
      </section>

      <section className="max-w-[1480px] mx-auto px-10 py-10">
        <GraphView nodes={nodes} edges={edgeList} />
      </section>
    </div>
  );
}
