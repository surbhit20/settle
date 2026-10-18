import Link from "next/link";
import Explorer from "@/components/Explorer";

export default function Home() {
  return (
    // Phones scroll the whole page; from md up the page is exactly one screen tall.
    <main className="flex min-h-dvh flex-col md:h-dvh">
      <header className="flex items-start justify-between gap-4 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Settle</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Where should you live? Bay Area neighborhoods ranked for your salary, office, and priorities.
          </p>
        </div>
        <Link href="/sources" className="shrink-0 text-sm text-zinc-600 underline dark:text-zinc-400">
          Data sources
        </Link>
      </header>
      <Explorer />
    </main>
  );
}
