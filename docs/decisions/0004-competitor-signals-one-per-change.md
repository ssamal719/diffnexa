# 0004 — Competitor Monitor gives each change exactly one signal

**Decided:** September 2026, with Tool #4.

## Decision

Competitor Monitor assigns every change exactly one of nine signals, chosen by a
fixed, documented precedence order, with `Other` when no rule applies. The layer
sits beside the comparison result (like Policy Monitor's clause topics) and
never changes the `Change` contract or the comparison itself.

## Why

- **The report groups by signal.** With one signal per change the groups are a
  partition: they add up to the changes found, so grouping can never hide or
  double-count one. This is tested on every golden pair.
- **Explainable.** One rule decides, and the card says which ("“$18” is an
  amount of money", "it sits in the section “Plans”").
- **Policy Monitor is different on purpose.** A clause can genuinely touch two
  parts of an agreement, and that tool reports topics as extra information
  rather than as groups. A competitor report is read as groups.

## Rejected

- *Several signals per change* — makes the grouped report either repeat changes
  or pick one arbitrarily at display time.
- *Changing the engine to report link-text changes* — would improve call-to-action
  wording coverage, but alters Website Change Detector and Policy Monitor output.
  Recorded as a known limitation instead.
- *Using the page type to steer classification* — the page type is the user's
  label and must not change what is reported.
