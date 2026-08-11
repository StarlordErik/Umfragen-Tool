# Umfragen-Tool für das Oliven-Symposium

Start:

```powershell
python main.py
```

Der Server bindet an `0.0.0.0`, sucht ab Port `8000` einen freien Port und öffnet den Linktree auf dem Windows-PC. In der Konsole stehen die drei Umfrage-Links für das lokale Netzwerk.

Wichtige Seiten:

- `/` zeigt den Linktree zum Oliven-Symposium.
- `/umfrage/geschmack`, `/umfrage/geruch`, `/umfrage/gesamt` sind die drei mobilen Umfragen.
- `/ergebnisse` zeigt Live-Statistiken, Ranglisten, Chiffren-Auflösung mit Spoiler-Schutz und Öl-Kacheln.
- `/oel-auswahl` verwaltet die aktive Öl-Auswahl nach Passwort-Eingabe.

Antworten liegen lokal in `data/umfragen.sqlite3`. Gäste werden anonym per Cookie plus IP-Adresse/User-Agent wiedererkannt, sodass sie auf demselben Gerät weiterarbeiten können.

Die private Öl-Zuordnung liegt in `decryption.json`. Nur Einträge mit `implemented: true` erscheinen in den Umfragen; Platzhalter bleiben unsichtbar und können über die Öl-Auswahl belegt werden.
