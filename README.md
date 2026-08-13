# Umfragen-Tool für das Oliven-Symposium

Start:

```powershell
python main.py
```

Der Server bindet an `0.0.0.0`, sucht ab Port `8000` einen freien Port und öffnet die Startseite auf dem Windows-PC. In der Konsole stehen die wichtigsten lokalen Seiten.

Wichtige Seiten:

- `/` zeigt die Startseite der Studie des Oliven-Symposiums.
- `/umfrage/geschmack`, `/umfrage/geruch`, `/umfrage/gesamt` sind die drei mobilen Umfragen.
- `/ergebnisse` zeigt die geschützten Live-Ranglisten.
- `/einzelne-oel-wertungen` zeigt die geschützte Aufschlüsselung je Öl mit Chiffren-Auflösung und Spoiler-Schutz.
- `/oel-auswahl` verwaltet die aktive Öl-Auswahl nach Passwort-Eingabe.

Antworten liegen lokal in `data/umfragen.sqlite3`. Probanden werden anonym per Cookie und optional per Name wiedererkannt, sodass sie weiterarbeiten können.

Die private Öl-Zuordnung liegt in `decryption.json`. Nur Einträge mit `implemented: true` erscheinen in den Umfragen; Platzhalter bleiben unsichtbar und können über die Öl-Auswahl belegt werden.
