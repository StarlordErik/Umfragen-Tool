import type { Metadata } from 'next';
import styles from './platform.module.css';

export const metadata: Metadata = {
  title: 'Projektraum',
  description: 'Ein Ort für gemeinsame Ideen, Umfragen und neue Perspektiven.',
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de">
      <body className={styles.body}>{children}</body>
    </html>
  );
}
