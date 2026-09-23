import Link from 'next/link';

export default function NotFound() {
  return (
    <main style={{ maxWidth: 700, margin: '80px auto', padding: 24 }}>
      <h1>Seite nicht gefunden</h1>
      <p>Dieses Projekt oder diese Seite ist nicht verfügbar.</p>
      <Link href="/">Zur Projektübersicht</Link>
    </main>
  );
}
