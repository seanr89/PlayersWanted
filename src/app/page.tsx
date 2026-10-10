import Link from "next/link";

export default function Home() {
  return (
    <main className="page">
      <h1 className="title">Bibleague</h1>
      <p className="muted">Working title. Prototype build.</p>
      <Link className="button" href="/prototype/teams">
        Team assignment prototype
      </Link>
    </main>
  );
}
