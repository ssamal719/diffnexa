"""Find golden pairs on disk.

A pair is a folder containing old.pdf, new.pdf and expected.yaml. Folders whose
name starts with "_" (such as the template) are ignored.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from diffnexa_engine.golden.spec import GoldenSpec, SpecError, load_spec


@dataclass(frozen=True)
class GoldenPair:
    name: str
    directory: Path
    spec: GoldenSpec
    old_pdf: Path
    new_pdf: Path


def discover_pairs(root: Path) -> list[GoldenPair]:
    if not root.exists():
        return []
    pairs: list[GoldenPair] = []
    for directory in sorted(p for p in root.iterdir() if p.is_dir()):
        if directory.name.startswith((".", "_")):
            continue
        spec_path = directory / "expected.yaml"
        old_pdf, new_pdf = directory / "old.pdf", directory / "new.pdf"
        missing = [p.name for p in (spec_path, old_pdf, new_pdf) if not p.exists()]
        if missing:
            raise SpecError(f"{directory}: missing {', '.join(missing)}")
        spec = load_spec(spec_path)
        pairs.append(GoldenPair(spec.pair, directory, spec, old_pdf, new_pdf))
    return pairs
