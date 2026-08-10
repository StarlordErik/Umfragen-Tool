# Umfragen-Tool für die Ölverkostung

Start:

```powershell
python main.py
```

Der Server bindet an `0.0.0.0`, sucht ab Port `8000` einen freien Port und öffnet die Ergebnis-Seite auf dem Windows-PC. In der Konsole stehen die drei Umfrage-Links für das lokale Netzwerk.

Wichtige Seiten:

- `/` zeigt alle lokalen Links.
- `/umfrage/geschmack`, `/umfrage/geruch`, `/umfrage/gesamt` sind die drei mobilen Umfragen.
- `/ergebnisse` zeigt Live-Statistiken, Chiffren-Auflösung, Trefferquote, Diagramme und Wortwolke.
- `/admin` bearbeitet Öle, Chiffren und Bewertungsfelder aus `event_config.json`.

Antworten liegen lokal in `data/umfragen.sqlite3`. Gäste werden per Cookie plus IP-Adresse/User-Agent wiedererkannt, sodass sie auf demselben Gerät weiterarbeiten können.
