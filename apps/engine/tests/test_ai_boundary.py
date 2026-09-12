"""AI may only annotate changes the deterministic engine found. It can never create one."""

import ast
from pathlib import Path

import pytest
from pydantic import ValidationError

import diffnexa_engine.ai as ai_pkg
from diffnexa_engine.ai.boundary import attach_annotations
from diffnexa_engine.contracts import AIAnnotation

from .test_contracts_evidence import modified, result

FORBIDDEN_NAMES = {"Change", "Evidence", "ChangeKind", "ChangeCategory"}


def test_unknown_change_ids_are_dropped():
    base = result([modified()])
    good = AIAnnotation(change_id="c1", confidence=0.8, title="Vacancy count increased")
    invented = AIAnnotation(change_id="c42", confidence=0.99, title="Salary doubled")
    outcome = attach_annotations(base, [good, invented])
    assert [a.change_id for a in outcome.result.annotations] == ["c1"]
    assert [d.annotation.change_id for d in outcome.dropped] == ["c42"]


def test_duplicates_are_dropped():
    base = result([modified()])
    a = AIAnnotation(change_id="c1", confidence=0.8)
    outcome = attach_annotations(base, [a, a])
    assert len(outcome.result.annotations) == 1 and len(outcome.dropped) == 1


def test_changes_are_untouched_by_annotations():
    base = result([modified()])
    outcome = attach_annotations(base, [AIAnnotation(change_id="c1", confidence=0.5)])
    assert outcome.result.changes == base.changes


def test_annotation_type_has_no_way_to_state_values_or_evidence():
    fields = set(AIAnnotation.model_fields)
    assert not fields & {"old_value", "new_value", "evidence", "kind", "category", "id", "seq"}
    with pytest.raises(ValidationError):
        AIAnnotation(change_id="c1", confidence=0.5, new_value="999")


def test_changes_cannot_be_mutated_after_creation():
    change = modified()
    with pytest.raises(ValidationError):
        change.new_value = "999"  # type: ignore[misc]


def test_ai_package_never_imports_or_builds_changes():
    """Static check over every file in diffnexa_engine/ai/."""
    package_dir = Path(ai_pkg.__file__).parent
    offenders = []
    for path in package_dir.rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                names = {alias.name for alias in node.names}
                if names & FORBIDDEN_NAMES or "*" in names:
                    offenders.append(f"{path.name}: imports {sorted(names & FORBIDDEN_NAMES) or '*'}")
            elif isinstance(node, ast.Name) and node.id in FORBIDDEN_NAMES:
                offenders.append(f"{path.name}: uses {node.id}")
            elif isinstance(node, ast.Attribute) and node.attr in FORBIDDEN_NAMES:
                offenders.append(f"{path.name}: uses .{node.attr}")
    assert offenders == []
