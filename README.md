# Willi Agent - EDIFACT → JSON via KaibanJS

This project scaffolds a KaibanJS multi-agent workflow that:
- Retrieves EDIFACT format specs from Qdrant (collection: `willi_mako`)
- Generates a per-format JavaScript parser module (EDIFACT → JSON + explanations)
- Tests the module with real samples in `MAKO_SAMPLES/` and adversarial cases

## Prerequisites
- Node.js 18+
- `.env` in project root with Gemini and Qdrant settings (already provided). Do NOT commit it.

## Install

```bash
npm install --legacy-peer-deps
```

## Run (will call Gemini + Qdrant)

```bash
npm start
```

Artifacts per format will be written to `artifacts/<FORMAT>/`:
- `spec.json` — retrieved spec payload
- `parser.js.txt` — generated JS module code
- `tests.json` — test results

## Dev

```bash
npm run dev
```

## Structure
- `src/index.js` — Orchestrates teams per format (knowledge → build → test)
- `src/agents/` — Agent definitions
- `src/tools/` — Custom tools:
  - `qdrantSpecRetriever` — fetch spec by format from Qdrant
  - `edifactParserGenerator` — ask LLM to synthesize parser module
  - `edifactTester` — load module and run sample/adversarial tests
- `src/lib/` — LLM and Qdrant helpers

## Notes
- Keep `.env` private. Add more validations in generator prompt as needed.
- If Qdrant metadata keys differ, adjust `qdrantSpecRetriever` filters.
