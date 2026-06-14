const setupItems = [
  "Vite CSR",
  "React",
  "TypeScript strict mode",
  "Tailwind CSS",
  "Apache ECharts dependency",
];

export default function App() {
  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950">
      <section className="mx-auto flex min-h-screen w-full max-w-5xl flex-col justify-center px-6 py-12">
        <p className="text-sm font-medium text-emerald-700">Market Growth Path</p>
        <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-normal text-zinc-950 sm:text-5xl">
          Long-term total return trend analysis
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-7 text-zinc-600">
          The app shell is ready for the data pipeline, deterministic trend model, random walk
          drift model, and dashboard charts.
        </p>

        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {setupItems.map((item) => (
            <div key={item} className="rounded border border-zinc-200 bg-white px-4 py-3 text-sm">
              {item}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
