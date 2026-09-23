import Link from 'next/link';
import { projects } from './projects';
import styles from './platform.module.css';

export default function HomePage() {
  return (
    <div className={styles.shell}>
      <a className={styles.skip} href="#inhalt">
        Zum Inhalt springen
      </a>
      <header className={styles.header}>
        <Link
          href="/"
          className={styles.brand}
          aria-label="Projektraum – Startseite"
        >
          <span className={styles.mark} aria-hidden="true">
            p.
          </span>
          Projektraum
        </Link>
        <nav aria-label="Hauptnavigation">
          <a href="#projekte">
            Projekte <span aria-hidden="true">↗</span>
          </a>
        </nav>
      </header>
      <main id="inhalt">
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>
              <span aria-hidden="true" /> Raum für neue Perspektiven
            </p>
            <h1 id="hero-title">
              Gemeinsam fragen.
              <br />
              Mehr <em>entdecken.</em>
            </h1>
            <p className={styles.lead}>
              Ideen werden spannend, wenn wir sie teilen. Hier finden gemeinsame
              Projekte, kleine Experimente und unterschiedliche Perspektiven
              ihren Platz.
            </p>
            <a href="#projekte" className={styles.primary}>
              Projekte entdecken <span aria-hidden="true">↓</span>
            </a>
          </div>
          <div className={styles.art} aria-hidden="true">
            <span className={styles.artLabel}>NEUGIER VERBINDET</span>
            <div className={styles.orbit}>
              <span />
              <span />
              <span />
            </div>
            <span className={styles.artFoot}>
              Eine Frage. Viele Perspektiven.
            </span>
          </div>
        </section>
        <section
          id="projekte"
          className={styles.projects}
          aria-labelledby="projects-title"
        >
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>Entdecken & mitmachen</p>
              <h2 id="projects-title">Unsere Projekte</h2>
            </div>
            <span className={styles.count}>
              {String(projects.length).padStart(2, '0')} Projekt
              {projects.length === 1 ? '' : 'e'}
            </span>
          </div>
          <div className={styles.grid}>
            {projects.map((project, index) => (
              <article className={styles.card} key={project.id}>
                <div className={styles.cardTop}>
                  <span className={styles.tag}>{project.category}</span>
                  <span className={styles.index}>
                    {String(index + 1).padStart(2, '0')}
                  </span>
                </div>
                <div className={styles.projectGlyph} aria-hidden="true">
                  ◒
                </div>
                <h3>
                  <a href={project.href}>
                    {project.title}
                    <span className={styles.cardArrow} aria-hidden="true">
                      ↗
                    </span>
                  </a>
                </h3>
                <p>{project.description}</p>
                <div className={styles.cardFoot}>
                  <span>Zum Projekt</span>
                  <span aria-hidden="true">→</span>
                </div>
              </article>
            ))}
            <aside className={styles.nextCard}>
              <span aria-hidden="true" className={styles.plus}>
                +
              </span>
              <h3>Platz für das Nächste.</h3>
              <p>
                Neue Fragen, neue Ideen.
                <br />
                Hier wächst mit jedem Projekt eine weitere Perspektive.
              </p>
              <span className={styles.future}>Weitere Projekte folgen</span>
            </aside>
          </div>
        </section>
      </main>
      <footer className={styles.footer}>
        <span>Projektraum</span>
        <p>Mit Neugier beginnt es.</p>
        <a href="#inhalt">
          Nach oben <span aria-hidden="true">↑</span>
        </a>
      </footer>
    </div>
  );
}
