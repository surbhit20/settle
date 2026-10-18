export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Settle</h1>
      <p className="text-lg text-zinc-600 dark:text-zinc-400">
        Where should I live? Enter your salary, office, and priorities to see a ranked map of Bay
        Area neighborhoods.
      </p>
      <p className="text-sm text-zinc-500">
        Scaffold only (M0). Check the database at{" "}
        <a className="underline" href="/api/health">
          /api/health
        </a>
        .
      </p>
    </main>
  );
}
