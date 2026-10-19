import type { Metric } from "@/lib/risks";

// Small "source" link shown next to every number (CLAUDE.md: every metric carries its source).
// Shows the upstream source name, plus the data vintage on hover.
export default function SourceLink({ metric }: { metric: Pick<Metric, "source" | "source_url" | "dataset_vintage"> }) {
  return (
    <a
      className="text-[0.75rem] text-muted underline decoration-dotted underline-offset-2 hover:text-ink"
      href={metric.source_url}
      target="_blank"
      rel="noreferrer"
      title={metric.dataset_vintage ?? undefined}
    >
      {metric.source.replace(/_/g, " ")}
    </a>
  );
}
