# Willi Agent – EDIFACT → JSON mit KaibanJS (Deutsch)

Dieses Projekt bietet einen KaibanJS Multi-Agenten-Workflow, der:
- EDIFACT-Formatspezifikationen aus Qdrant (Collection: `willi_mako`) bezieht,
- je Format einen JavaScript-Parser (EDIFACT → JSON + Erklärungen) generiert und
- den Parser mit Beispielnachrichten in `MAKO_SAMPLES/` testet.

Die zwei wichtigsten Startpunkte sind:
1) Parser generieren (Team-Pipeline)
2) Erklärung für eine EDIFACT-Nachricht erzeugen (Explain-Team)

## Projektkontext & Kontakt
Dieses Projekt ist Teil von Willi‑Mako, einer Lösung für die Marktkommunikation in der Energiewirtschaft.
Weitere Informationen: https://stromhaltig.de/

Urheberrecht: © STROMDAO GmbH — Kontakt: dev@stromdao.com

## Use Case
Willi‑Agent automatisiert die Verarbeitung von EDIFACT-Nachrichten, die in der deutschen Marktkommunikation (z. B. APERAK, INVOIC, UTILMD, MSCONS, ORDERS …) verwendet werden. Der Agent:
- erzeugt je Format einen Parser (EDIFACT → strukturiertes JSON),
- erklärt die Inhalte feldgenau (menschenlesbar, standardmäßig auf Deutsch),
- unterstützt Tests und Validierungen zur Qualitätssicherung und
- erleichtert die Dokumentation sowie das Onboarding neuer Formate.

Typische Einsatzszenarien:
- Schnelles Onboarding eines neuen EDIFACT-Formats inklusive Tests.
- Automatische Erläuterungen für Fachbereiche (Markdown-Reports in Deutsch).
- Erstellung und Pflege von Parser-Artefakten für Betriebs- und Integrationszwecke.

## Voraussetzungen
- Node.js 18 oder neuer
- Eine gültige `.env`-Datei im Projektroot (nicht einchecken!)

## Installation

```bash
npm install --legacy-peer-deps
```

## .env konfigurieren (erforderliche Einstellungen)
Folgende Variablen sind nötig, damit Qdrant und Gemini funktionieren:

- QDRANT_URL = https://willi-col.corrently.cloud (fixer Wert, immer so setzen)
- QDRANT_COLLECTION = willi_mako (fixer Wert, immer so setzen)
- QDRANT_API_KEY = <dein Qdrant API Key>
  - Den Key erhältst du in der Willi Mako Anwendung unter: https://stromhaltig.de/app/
- GEMINI_API_KEY = <dein Google Gemini API Key> (alternativ GOOGLE_AI_API_KEY)

Optionale, sinnvolle Defaults (falls noch nicht vorhanden):
- EMBEDDING_PROVIDER=gemini
- GEMINI_MODEL=gemini-2.5-flash
- GEMINI_VISION_MODEL=gemini-2.5-flash
- GEMINI_EMBED_MODEL=text-embedding-004

Beispiel (ohne echte Schlüssel):
```properties
QDRANT_URL=https://willi-col.corrently.cloud
QDRANT_COLLECTION=willi_mako
QDRANT_API_KEY=YOUR_QDRANT_KEY
GEMINI_API_KEY=YOUR_GEMINI_KEY
EMBEDDING_PROVIDER=gemini
GEMINI_MODEL=gemini-2.5-flash
GEMINI_VISION_MODEL=gemini-2.5-flash
GEMINI_EMBED_MODEL=text-embedding-004
```

## 1) Parser generieren (Team-Pipeline)

Startet die Multi-Agenten-Pipeline (Strategie → Wissen → Builder → Tester):

```bash
npm start
```

Ergebnisse pro Format landen unter `artifacts/<FORMAT>/`:
- `search-plan.json` – Suchplan und Top-Treffer aus Qdrant
- `spec.json` – konsolidierte Spezifikation
- `parser.js` – generiertes Parsermodul (ESM) für EDIFACT → JSON + explain()
- `tests.json` – Testergebnisse
- `workflowLogs.json` und `status.txt` – Lauf- und Statusprotokolle

### Bereits generierte Parser (Stand: automatisch aus `artifacts/` ermittelt)
- APERAK
- INVOIC
- MSCONS
- ORDERS
- PARTIN
- QUOTES
- REMADV
- UTILMD
- UTILTS
- UITLTS

Nützliche Umgebungsvariablen für die Pipeline:
- `ONLY_FORMATS=APERAK,INVOIC` – nur diese Formate verarbeiten
- `STOP_AFTER_FORMAT=APERAK` – nach diesem Format anhalten
- `BASELINE_PARSER=true` – deterministischen Basis-Parser bevorzugen

## 2) Erklärung für eine EDIFACT-Nachricht erzeugen (Explain-Team)

Erzeugt zu einer einzelnen EDIFACT-Nachricht eine Erklärung als JSON und als deutsches Markdown. Die Ausgabe wird in `output/` geschrieben und im Dateinamen mit dem erkannten Format versehen.

```bash
npm run explain-kanban -- ./MAKO_SAMPLES/APERAK_2.md
```

Erzeugt u. a.:
- `output/APERAK_APERAK_2.explained.json`
- `output/APERAK_APERAK_2.explained.de.md`

Hinweise:
- Das Explain-Team verwendet standardmäßig Deutsch (de) für das Markdown.
- Falls vorhanden, wird ein generierter Parser aus `artifacts/<FORMAT>/parser.js` genutzt; sonst greift ein Basis-Parser.

### BDEW-Code-Auflösung (Sender/Empfänger)
In jeder Nachricht sind Sender (UNB/02/01) und Empfänger (UNB/03/01) über BDEW-Codes identifiziert. Das Explain-Team löst diese optional in sprechende Namen auf. Dazu wird eine veröffentlichte JSON genutzt:

- Standardquelle: `https://stromhaltig.de/data/marktpartnersuche-export-20250905/table-001.json`
- Optional konfigurierbar via `.env`: `BDEW_CODES_URL=<eigene URL>`
- Lokale Datei bevorzugen: Lege `bdewcodes.json` ins Projekt-Root oder setze `BDEW_CODES_PATH=/pfad/zu/bdewcodes.json`. Das Tool erkennt Tabellenformate `{ headers, rows }` sowie Arrays von Objekten.

Die aufgelösten Namen werden im Markdown hinter den IDs in Klammern angezeigt, z. B. `9900295000008 (Beispiel GmbH)`.

## Weitere Startpunkte und Skripte

- Einzelne Beispiel-Datei mit vorhandenem Parser erklären (legt `explained.json` unter `artifacts/<FORMAT>/` ab):
  ```bash
  npm run explain-one -- ./MAKO_SAMPLES/APERAK_2.md
  ```

- Alle vorhandenen Parser einmal gegen eine Minimaleingabe laufen lassen und Erklärungen schreiben:
  ```bash
  npm run explain
  ```

- Entwicklerlauf mit automatischem Reload:
  ```bash
  npm run dev
  ```

## Ordnerstruktur (Auszug)
- `MAKO_SAMPLES/` – Beispiel-EDIFACT-Nachrichten
- `artifacts/<FORMAT>/` – Artefakte je Format (Spezifikation, Parser, Tests, Logs)
- `output/` – Ausgaben des Explain-Teams (JSON + deutsches Markdown)
- `src/` – Agents, Tools und Orchestrierung (KaibanJS)
- `scripts/` – CLIs für Explain-Workflows

## Fehlerbehebung
- 401/403 bei Qdrant: Prüfe `QDRANT_API_KEY` und dass `QDRANT_URL` sowie `QDRANT_COLLECTION` exakt wie oben gesetzt sind.
- Auth-Fehler bei Gemini: Setze `GEMINI_API_KEY` (oder alternativ `GOOGLE_AI_API_KEY`).
- Keine Parser gefunden: Erst die Pipeline mit `npm start` ausführen, dann Explain-Skripte verwenden.

## Lizenz
Apache-2.0 (siehe `package.json`).
