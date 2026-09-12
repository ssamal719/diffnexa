# DiffNexa engine

Python package that validates PDFs, extracts them into the canonical document
model, and runs the golden accuracy suite. The comparison engine itself arrives
in Stage 3.

```bash
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
pytest                          # all engine tests
diffnexa golden run             # golden suite + accuracy ratchet (run from repo root)
diffnexa extract some.pdf       # extraction report for any PDF
```

See ../../docs/testing.md for the full testing guide.
