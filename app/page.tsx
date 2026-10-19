import Link from "next/link";
import Explorer from "@/components/Explorer";

export default function Home() {
  return (
    // Phones scroll the whole page; from md up the page is exactly one screen tall.
    <main className="flex min-h-dvh flex-col md:h-dvh">
      {/* Three columns: an empty spacer, the centered title, and the link on the right. The equal
          outer columns (1fr each) keep the title exactly centered. One slim row: the tagline lives
          under the form's heading instead, so the header stays thin. */}
      <header className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 border-b border-line bg-paper px-5 py-2.5 md:px-8">
        <div />
        <h1 className="font-serif text-4xl leading-none tracking-tight">Settle</h1>
        <Link href="/sources" className="justify-self-end text-sm text-muted transition-colors hover:text-ink">
          Data sources
        </Link>
      </header>
      <Explorer />
    </main>
  );
}
