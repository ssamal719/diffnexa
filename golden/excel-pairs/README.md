# Excel Compare golden pairs

Each folder is one pair: `before.xlsx`, `after.xlsx` and `expected.yaml`.

- The workbooks are built by `_build/build_pairs.py` with openpyxl and then
  opened, calculated and saved by LibreOffice Calc, so every formula carries its
  stored result as a file saved by Excel does. They are committed as files; the
  build script is kept so a pair can be rebuilt or a new one added the same way.
- `expected.yaml` is written by hand. It lists each change, its group (Values,
  Formulas, Structure, Links) and the sheet and cell a reader is taken to — on
  both sides when rows moved the cell. Pairs holding a damaged, unsupported or
  hostile file state the refusal instead (`expected_error`).

A pair fails if an expected change is missed, anything else is reported, a
change is in the wrong group or at the wrong place, the groups do not add up to
the changes found, or a file that must be refused is not. Scores are held by
`../baseline.json` like every other suite.

To add a pair: add it to `_build/build_pairs.py`, run the script from
`apps/engine` (`python ../../golden/excel-pairs/_build/build_pairs.py <name>`),
write its `expected.yaml` by hand, then run `diffnexa golden run`.
