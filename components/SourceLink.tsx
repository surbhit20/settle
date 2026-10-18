import type { Metric } from "@/lib/risks";

// Small "source" link shown next to every number (CLAUDE.md: every metric carries its source).
// Shows the upstream source name, plus the data vintage on hover.
export default function SourceLink({ metric }: { metric: Pick<Metric, "source" | "source_url" | "dataset_vintage"> }) {
  return (
    <a
      className="text-xs text-zinc-500 underline decoration-dotted hover:text-zinc-800 dark:hover:text-zinc-200"
      href={metric.source_url}
      target="_blank"
      rel="noreferrer"
      title={metric.dataset_vintage ?? undefined}
    >
      {metric.source.replace(/_/g, " ")}
    </a>
  );
}
