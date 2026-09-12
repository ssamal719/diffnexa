# DiffNexa

**Know What Changed.** DiffNexa compares two versions of a document and explains
the changes that matter. The first product is Advanced AI PDF Compare. Website Change Detector is now available.

This repository is at **Stage 1: the foundation**. It can validate and read PDFs,
it enforces that every change must carry evidence, and it has the accuracy test
system that every later stage is measured against. It cannot compare two PDFs
yet — that arrives in Stage 3.

## What's here

| Folder | What it is |
|---|---|
| `apps/web/` | The website and the `/pdf-compare` upload page (Next.js) |
| `apps/engine/` | The PDF engine: validation, extraction, contracts, golden suite (Python) |
| `packages/contracts/` | Shared definitions used by both, so their wording can't drift |
| `golden/` | Accuracy test pairs, the baseline, and the log of baseline changes |
| `docs/` | Architecture, testing guide, stage reports, decisions |

## Run it on your computer

You need [Node.js 23+](https://nodejs.org) and [Python 3.11+](https://python.org).

**The website:**

```bash
cd apps/web
npm install
npm run dev
```

Open http://localhost:3000/pdf-compare.

**The engine:**

```bash
cd apps/engine
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
pytest                             # run the tests
```

**The accuracy suite** (from the repository root):

```bash
diffnexa golden run
```

Then open `reports/golden/index.html`.

**Look inside any PDF:**

```bash
diffnexa extract path/to/file.pdf --out reports/
```

## Full checks

```bash
cd apps/engine && pytest -q && ruff check . && ruff format --check .
cd ../.. && diffnexa golden run && diffnexa schema --check
cd apps/web && npm run check
```

These run automatically on GitHub for every change.

## Documentation

- `docs/architecture.md` — how the system is put together and why
- `docs/testing.md` — how to test everything, in plain language
- `docs/stage-reports/` — what each stage delivered
- `CLAUDE.md` — the rules any AI assistant must follow in this repository
