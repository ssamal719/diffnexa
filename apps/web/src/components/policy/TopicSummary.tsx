"use client";

import {
  STATUS_WORDING,
  changedTopics,
  notFoundTopics,
  unchangedTopics,
  type PolicyComparison,
  type PolicyTopicSummary,
} from "@/lib/policy-report";

/**
 * Which parts of the agreement moved, and which did not.
 *
 * Three states are kept apart because they are different statements. A topic
 * with changes is what the reader came for. A topic found in the page with no
 * changes is useful news. A topic not found at all is not the same as
 * unchanged, and presenting it as such would be a claim the system cannot
 * support — so it is listed separately and worded plainly.
 */
export function TopicSummary({
  result,
  selected,
  onSelect,
}: {
  result: PolicyComparison;
  selected: string | null;
  onSelect: (topicId: string | null) => void;
}) {
  const changed = changedTopics(result);
  const unchanged = unchangedTopics(result);
  const missing = notFoundTopics(result);

  return (
    <section aria-labelledby="topics-heading">
      <h3 id="topics-heading" className="text-[0.9rem] font-medium">
        Parts of this document
      </h3>

      {changed.length > 0 ? (
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {changed.map((topic) => (
            <li key={topic.id}>
              <button
                type="button"
                aria-pressed={selected === topic.id}
                onClick={() => onSelect(selected === topic.id ? null : topic.id)}
                className={[
                  "w-full rounded-[var(--radius-panel)] border p-3 text-left",
                  selected === topic.id
                    ? "border-signal bg-signal-soft"
                    : "border-rule bg-paper hover:border-rule-strong",
                ].join(" ")}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{topic.label}</span>
                  <span className="tabular text-[0.85rem] text-ink-soft">
                    <span className="sr-only">: </span>
                    {topic.changeCount}
                    <span className="sr-only">
                      {" "}
                      change{topic.changeCount === 1 ? "" : "s"}.{" "}
                    </span>
                  </span>
                </span>
                <span className="mt-0.5 block text-[0.8rem] text-ink-soft">
                  {STATUS_WORDING.changed}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-ink-soft">
          No changes were matched to a named part of this document.
        </p>
      )}

      {unchanged.length > 0 && (
        <TopicList
          title="Found in this document, with no detected changes"
          topics={unchanged}
          note="DiffNexa found wording for these and detected no changes in it."
        />
      )}

      {missing.length > 0 && (
        <TopicList
          title="Not found on this page"
          topics={missing}
          note="No wording for these was recognised. That is not the same as saying they did not change."
        />
      )}
    </section>
  );
}

function TopicList({
  title,
  topics,
  note,
}: {
  title: string;
  topics: PolicyTopicSummary[];
  note: string;
}) {
  return (
    <div className="mt-4">
      <h4 className="text-[0.85rem] font-medium text-ink-soft">{title}</h4>
      <ul className="mt-1.5 flex flex-wrap gap-1.5">
        {topics.map((topic) => (
          <li
            key={topic.id}
            className="rounded-full border border-rule bg-surface px-2.5 py-0.5 text-[0.82rem] text-ink-soft"
          >
            {topic.label}
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-[0.78rem] text-ink-soft">{note}</p>
    </div>
  );
}
