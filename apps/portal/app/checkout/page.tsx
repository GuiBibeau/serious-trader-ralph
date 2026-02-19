export default function Page() {
  return (
    <main>
      <section className="py-[clamp(3rem,6vw,6rem)]">
        <div className="w-[min(760px,92vw)] mx-auto">
          <div className="card card-flat p-6">
            <p className="label">Manual Access</p>
            <h1 className="mt-2.5">Self-serve checkout is unavailable</h1>
            <p className="text-muted mt-3">
              Trader Ralph access is provisioned manually for now. Contact{" "}
              <a className="underline" href="mailto:hello@ralph.fund">
                hello@ralph.fund
              </a>{" "}
              to request onboarding.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
