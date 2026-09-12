import { Badge } from "@/components/ui/Badge";
import {
  changeLocation,
  describeType,
  excerptFor,
  type Change,
} from "@/lib/comparison";

/**
 * One detected change.
 *
 * Added, removed and changed are distinguished by a word and a symbol as well
 * as by colour, so the meaning survives greyscale and colour blindness.
 */
const KIND_MARK: Record<Change["kind"], { symbol: string; word: string; className: string }> = {
  added: { symbol: "+", word: "Added", className: "text-added" },
  removed: { symbol: "−", word: "Removed", className: "text-removed" },
  modified: { symbol: "±", word: "Changed", className: "text-signal" },
  moved: { symbol: "→", word: "Moved", className: "text-ink-soft" },
};

export function ChangeCard({ change }: { change: Change }) {
  const mark = KIND_MARK[change.kind];
  const location = changeLocation(change);
  const oldExcerpt = excerptFor(change, "old");
  const newExcerpt = excerptFor(change, "new");

  return (
    <article className="border-t border-rule py-3 first:border-t-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className={`font-semibold ${mark.className}`}>
          <span aria-hidden="true">{mark.symbol} </span>
          {describeType(change.type)}
        </span>
        {change.label && <span className="text-ink-soft">· {change.label}</span>}
        {location && (
          <span className="tabular text-[0.85rem] text-ink-soft">· {location}</span>
        )}
        {change.isNoise && <Badge tone="neutral">Probably not important</Badge>}
      </div>

      {(change.oldValue || change.newValue) && (
        <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-[6rem_1fr]">
          {change.oldValue && (
            <>
              <dt className="text-[0.85rem] text-ink-soft">Previous</dt>
              <dd className="break-words">
                <span className="bg-[#fdf0f0] px-1 py-0.5 line-through decoration-removed/50">
                  {change.oldValue}
                </span>
              </dd>
            </>
          )}
          {change.newValue && (
            <>
              <dt className="text-[0.85rem] text-ink-soft">New</dt>
              <dd className="break-words">
                <span className="bg-[#f1f7f3] px-1 py-0.5 underline decoration-added/50">
                  {change.newValue}
                </span>
              </dd>
            </>
          )}
          {change.delta && (
            <>
              <dt className="text-[0.85rem] text-ink-soft">Difference</dt>
              <dd className="tabular font-medium">{change.delta}</dd>
            </>
          )}
        </dl>
      )}

      {(oldExcerpt || newExcerpt) && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[0.85rem] text-signal">
            Evidence from the documents
          </summary>
          <div className="mt-1 space-y-1 border-l-2 border-rule pl-3 text-[0.85rem] text-ink-soft">
            {oldExcerpt && (
              <p>
                <span className="font-medium text-ink">Previous PDF</span>
                {change.oldPages.length > 0 && (
                  <span className="tabular"> (page {change.oldPages[0]})</span>
                )}
                : “{oldExcerpt}”
              </p>
            )}
            {newExcerpt && (
              <p>
                <span className="font-medium text-ink">New PDF</span>
                {change.newPages.length > 0 && (
                  <span className="tabular"> (page {change.newPages[0]})</span>
                )}
                : “{newExcerpt}”
              </p>
            )}
            {change.noiseReason && <p>Why this is marked unimportant: {change.noiseReason}</p>}
          </div>
        </details>
      )}
    </article>
  );
}
