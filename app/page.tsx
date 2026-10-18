import AreaMap from "@/components/AreaMap";

export default function Home() {
  return (
    <main className="flex h-dvh flex-col">
      <header className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h1 className="text-lg font-semibold tracking-tight">Settle</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Bay Area ZIP code areas (San Francisco, San Mateo, Santa Clara, Alameda, Contra Costa)
        </p>
      </header>
      <AreaMap />
    </main>
  );
}
