import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Icon } from "@/components/icons/Icon";
import { GraphView } from "@/components/graph/GraphView";

/**
 * /graph — force-directed visualisation of every entry as a node
 * and either shared-tag-coincidences or [[wikilink]] backlinks as
 * edges.  Server-side fetch is intentionally compact: just the
 * fields the layout needs.
 */
export default async function GraphPage() {
  const supabase = await createClient();
  const { data: entryRows } = await supabase
    .from("entries")
    .select("id, title, category_id, tags")
    .limit(2000);
  const { data: backlinkRows } = await supabase
    .from("entry_backlinks")
    .select("source_id, target_id")
    .not("target_id", "is", null);

  const nodes = (entryRows ?? []).map((r) => ({
    id: r.id as string,
    title: r.title as string,
    categoryId: r.category_id as string,
    tags: (r.tags as string[]) ?? [],
  }));

  // Build edges: explicit backlinks + tag co-occurrence.  Tag edges
  // are kept light — only emitted when two entries share ≥ 2 tags
  // so the graph isn't a hairball.
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
  // Tag co-occurrence — O(n²) but n ≤ 2000 in practice and we only
  // run it on the server during page build.  Fine.
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const shared = nodes[i].tags.filter((t) => nodes[j].tags.includes(t));
      if (shared.length >= 2) {
        const key = [nodes[i].id, nodes[j].id].sort().join("|") + "|tag";
        if (!edges.has(key)) {
          edges.add(key);
          edgeList.push({ source: nodes[i].id, target: nodes[j].id, kind: "tag" });
        }
      }
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
