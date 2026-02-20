export default function Page() {
  return (
    <main>
      <section className="py-[clamp(3rem,6vw,6rem)]">
        <div className="w-[min(760px,92vw)] mx-auto">
          <div className="card card-flat p-6">
            <p className="label">Plans</p>
            <h1 className="mt-2.5">Pricing rollout in progress</h1>
            <p className="text-muted mt-3">
              Usage-based plans and bundled strategy pricing will appear here in
              a later release.
            </p>
            <p className="text-muted mt-2">
              Sign in and open the terminal to access the current experience.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
