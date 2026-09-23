# DOCX Compare golden pairs

Each folder is one pair: `before.docx`, `after.docx` and `expected.yaml`.

- The two documents are real Word files, built by `_build/build_pairs.py` with
  python-docx, so they carry Word's own styles, list numbering and tables. They
  are committed as files; the build script is kept so a pair can be rebuilt or a
  new one added the same way.
- `expected.yaml` is written by hand. It says what really changed, the group a
  reader will find each change under (Text changes, Headings, Lists, Tables,
  Numbers, Dates, Structure, Other) and where its evidence must point, in the
  words the page shows ("Table 1, row 2, column 2").

A pair fails if an expected change is missed, anything else is reported, a
change is in the wrong group, its evidence points elsewhere, or the groups do
not add up to the changes found. Scores are held by `../baseline.json` like
every other suite.

To add a pair: add it to `_build/build_pairs.py`, run the script from
`apps/engine` (`python ../../golden/docx-pairs/_build/build_pairs.py`), write
its `expected.yaml` by hand, then run `diffnexa golden run`.
