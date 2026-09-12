"""The only place AI output meets comparison results."""

from __future__ import annotations

from dataclasses import dataclass

from diffnexa_engine.contracts.changes import AIAnnotation, ComparisonResult


@dataclass(frozen=True)
class DroppedAnnotation:
    annotation: AIAnnotation
    reason: str


@dataclass(frozen=True)
class AttachOutcome:
    result: ComparisonResult
    dropped: tuple[DroppedAnnotation, ...]


def attach_annotations(
    result: ComparisonResult, annotations: list[AIAnnotation] | tuple[AIAnnotation, ...]
) -> AttachOutcome:
    """Attach AI annotations to a result without touching its changes.

    Any annotations already on the result are replaced by the ones given here.

    Annotations for unknown change IDs, and duplicates for the same change, are
    dropped and reported. The changes tuple is carried over unchanged.
    """
    known = {change.id for change in result.changes}
    kept: list[AIAnnotation] = []
    dropped: list[DroppedAnnotation] = []
    seen: set[str] = set()
    for ann in annotations:
        if ann.change_id not in known:
            dropped.append(DroppedAnnotation(ann, "refers to a change the engine did not detect"))
        elif ann.change_id in seen:
            dropped.append(DroppedAnnotation(ann, "duplicate annotation for the same change"))
        else:
            seen.add(ann.change_id)
            kept.append(ann)

    data = result.model_dump()
    data["annotations"] = [a.model_dump() for a in kept]
    new_result = ComparisonResult.model_validate(data)
    return AttachOutcome(result=new_result, dropped=tuple(dropped))
