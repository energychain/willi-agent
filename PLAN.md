# Projektplan – EDIFACT → JSON Agentsystem (KaibanJS)

Dieses Dokument bündelt Anforderungen, Architektur, Umsetzungsdetails, Teststrategie und offene Punkte. Es dient als „Gedächtnis“ für die Implementierung und als Referenz für Weiterentwicklungen.

## 1. Zielbild und Kontext
- Ziel: Für jedes EDIFACT-Format (z. B. INVOIC, ORDERS, UTILMD, MSCONS, APERAK) ein eigenständiges JS-Parser-Skript generieren, das:
  - EDIFACT in strukturiertes JSON überführt
  - Werte anhand der Spezifikation (Qdrant Collection `willi_mako`) in Klartext erklärt
  - Validierungen und sinnvolle Fehlermeldungen liefert
- Qualitätssicherung: Ein Tester-Agent prüft die Parser mit echten Beispielen aus `MAKO_SAMPLES` und mit absichtlich fehlerhaften Nachrichten. Ein Skript gilt erst als gültig, wenn die Tests bestehen.
- Wissensquelle: Qdrant (Collection: `willi_mako`) enthält strukturierte Spezifikationen/Metadaten zu Formaten/Segmenten.
- LLM: Gemini 2.5 Flash; Embeddings: Gemini `text-embedding-004`.

## 2. Anforderungen (Explizit + Implizit)
- A1: Nutzung von KaibanJS (Multi-Agent-Setup) – Done (Gerüst steht).
- A2: Einbindung `.env` (QDRANT_URL, QDRANT_API_KEY, GEMINI_API_KEY, EMBEDDING_PROVIDER etc.) – Done.
- A3: Mehrstufige semantische Suche in Qdrant; Strategie vor Ausführung planen – Done (Strategist + Planner + Semantic Search).
- A4: Pro Format ein Parser-Skript erzeugen (ESM), das `parseEdifactToJson(text)` und `explain(parsedJson)` exportiert – Implementiert im Generator-Tool (LLM-gesteuert).
- A5: Tests mit realen Beispielen und negativen Mutationen – Done (Tester-Tool).
- A6: Parser erst gültig, wenn Tests erfolgreich – Abnahmekriterium fixiert.
- A7: Artefakte je Format persistieren (spec, parser, tests, search-plan) – Done.
- A8: Erweiterbarkeit für eigene Tools (z. B. Preprocessor, Reranker) – Architektur offen.
- A9 (implizit): Robustheit bei abweichenden Qdrant-Metadaten/Strukturen – Fallbacks vorgesehen; Filter ggf. anpassbar.

## 3. Architekturüberblick
- Agents
  - Strategist „Query Strategist“: plant und orchestriert semantische Suchen (Tools: Planner, Semantic Search).
  - Knowledge „Spec Sage“: holt Spezifikationen; kann zusätzliche Suchen durchführen und Segment-Mappings synthetisieren (Tools: Retriever, Semantic Search, Synthesizer).
  - Builder „Parser Smith“: generiert Parsermodul (Tool: Parser Generator, LLM-intern).
  - Tester „QA Hammer“: validiert das Modul (Tool: Tester).
- Tools (Custom)
  - `plan_qdrant_search_strategy` (`searchStrategyPlanner.js`): LLM-Plan für multi-query + Filter.
  - `qdrant_semantic_search` (`qdrantSemanticSearch.js`): Embeddings-basierte Suche mit must/should-Filtern, Reranking.
  - `retrieve_spec_by_format` (`qdrantSpecRetriever.js`): Metadatenbasierte Spezifikationsabfrage (Filter auf `format`, `format_name`, `message_type`).
  - `synthesize_spec_segment` (`specSegmentSynthesizer.js`): fusioniert mehrere Payloads zu einem einheitlichen Segment-/Feld-Mapping.
  - `generate_edifact_parser_module` (`edifactParserGenerator.js`): erzeugt Parser-ESM aus Spec + optionalem Sample.
  - `test_edifact_parser_module` (`edifactTester.js`): lädt Modul temporär, testet echte Samples + negative Mutationen.
- Lib
  - `llm.js`: Gemini Chat (2.5 Flash)
  - `embeddings.js`: Gemini Embeddings `text-embedding-004`
  - `qdrantClient.js`: Qdrant-Client (REST)

## 4. Ablauf (Tasks je Format)
Reihenfolge t0 → t1 → t2 → t3 (Team-Memory an):
1) t0 Plan retrieval (Strategist)
   - Planner erstellt Suchstrategie (3–6 Queries, must/should-Filter)
   - Semantic Search wird ausgeführt; Top-Ergebnisse bilden Kontext (persistiert `search-plan.json`).
2) t1 Fetch spec (Knowledge)
   - Ruft `retrieve_spec_by_format` auf, nutzt ggf. Strategie-Insights
   - Wenn nur Teilinformationen vorliegen: `qdrant_semantic_search` + `synthesize_spec_segment` für Schlüssel-Segmente (UNH, BGM, DTM, NAD …)
   - Ergebnis: konsolidierte Spec (`spec.json`).
3) t2 Generate parser (Builder)
   - LLM-Generator erhält Spec + Beispiel-Sample
   - Erzeugt ESM-Modulcode (persistiert `parser.js.txt`).
4) t3 Test parser (Tester)
   - Testet gegen alle Samples für das Format
   - Mutiert einige Fälle absichtlich
   - Ergebnis: `tests.json` (success/results). Nur wenn success = true ist Skript „gültig“.

## 5. Tool-Verträge (Inputs/Outputs)
- plan_qdrant_search_strategy
  - In: { task: string, format: string, hints?: string[] }
  - Out: { queries: string[], mustFilters: any[], shouldFilters: any[] }
- qdrant_semantic_search
  - In: { queries: string[], mustFilters?: any[], shouldFilters?: any[], topK?: number }
  - Out: { results: Array<{ id, score, payload }> }
- retrieve_spec_by_format
  - In: { format: string }
  - Out: { spec: object|null, pointsMeta: object[] }
- synthesize_spec_segment
  - In: { format: string, segment: string, results: any[] }
  - Out: { segment, fields: [...], validations: [...], (optional) raw }
- generate_edifact_parser_module
  - In: { format: string, spec: any, sample?: string }
  - Out: { moduleCode: string }
- test_edifact_parser_module
  - In: { moduleCode: string, samples: { name: string, text: string }[] }
  - Out: { success: boolean, results: { name, ok, error?, parsedSummary? }[] }

## 6. Parser-Anforderungen
- ESM-Modul mit Exports:
  - `async function parseEdifactToJson(text)`
  - `async function explain(parsedJson)` (fügt Beschreibungen aus Spec an)
- Parser-Logik:
  - Segmentierung (UNH/BGM/NAD/…) – Zeilen, `+` für Komponenten, `:` für Subkomponenten, `?` als Escape, leere Komponenten `++` berücksichtigen
  - OPTIONAL: UNA/Trennzeichen erkennen
- Validierung & Fehler:
  - Pflichtsegmente prüfen (soweit known), Datum/Codelisten prüfen
  - Fehlerformat: `{ code, message, segmentTag, position }`

## 7. Teststrategie
- Happy-Path: alle realen Beispiele je Format aus `MAKO_SAMPLES`
- Negativfälle: mutierte Nachrichten (z. B. falscher Segmenttag, kaputte Komponenten)
- Akzeptanz: Parser gültig, wenn `success=true` und keine kritischen Fehler
- Artefakte: `tests.json` mit Ergebnisdetails

## 8. Qdrant-Suchstrategie (Optimierung)
- Strategieplanung via LLM: Queries + Filter (must/should) abhängig von Format/Segment
- Semantische Suchen parallel je Query; Reranking + Dedupe
- Synthese-Schritt, wenn mehrere Payloads Teilinformationen enthalten
- Fallbacks: wenn keine Treffer – weitere Query-Varianten; wenn Metadaten-Keys abweichen – Filter in Retriever/Planner anpassen

## 9. Edge Cases & Fehlerbilder
- Keine/mehrdeutige Spezifikations-Treffer in Qdrant
- Abweichende Metadaten-Keys (z. B. `msg_type` statt `message_type`)
- Samples in Markdown formatiert (Codeblöcke): Preprocessor sinnvoll
- Sehr große Nachrichten (Performance), viele Wiederholsegmente
- UNA-Varianten, spezielle Trennzeichen, Escape-Muster

## 10. Betrieb & Ausführung
- Voraussetzungen: Node 18+, `.env` mit QDRANT/GEMINI-Keys (nicht committen)
- Install/Run:
  - `npm install --legacy-peer-deps`
  - `npm start`
- Artefakte je Format: `artifacts/<FORMAT>/`
  - `search-plan.json`, `spec.json`, `parser.js.txt`, `tests.json`

## 11. Sicherheit & Compliance
- Keine Secrets im Log/Repo; `.env` geschützt
- Netzaufrufe nur an Qdrant + Google GenAI
- Fehlerausgaben ohne vertrauliche Inhalte

## 12. Offene Punkte / Annahmen
- Annahme: Qdrant-Payloads enthalten strukturierte Felddetails (schema/structure/fields)
- Annahme: Collection-Name `willi_mako` ist korrekt; URL/Key in `.env`
- Offene Punkte:
  - Exakte Metadaten-Keys in Qdrant final verifizieren; ggf. Retriever-Filter anpassen
  - Preprocessor für Markdown-Samples nachrüsten
  - Zusätzliche Validierungsregeln je Format (z. B. Codelisten)

## 13. Nächste Schritte
- [ ] Qdrant-Filter finalisieren (Schlüssel prüfen, ggf. Mapping ergänzen)
- [ ] Preprocessor-Tool für EDIFACT aus Markdown (Erkennung von Codefences/Segmentzeilen)
- [ ] Erweiterte Negativtests (fehlende Pflichtsegmente, falsche DTM-Formate, ungültige Codelisten)
- [ ] CI-Pipeline: pro Format generieren + testen, Artefakte speichern
- [ ] Parser-Registry: validierte Parser als `.mjs` ablegen/verwaltbar machen

## 14. Änderungsprotokoll
- 2025-09-07: Initiale Fassung – Setup, Agents/Tools, Orchestrierung, Suchstrategie.
