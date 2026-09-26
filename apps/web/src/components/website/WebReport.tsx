"use client";

import { useMemo, type ReactNode } from "react";

import { SectionMap } from "@/components/website/SectionMap";
import { WebWorkspace } from "@/components/website/WebWorkspace";
import type { ChangeAnalysis } from "@/lib/analysis";
import { readView } from "@/lib/content-view";
import type { FocusRequest } from "@/lib/use-change-focus";
import {
  buildWebReport,
  inWorkspaceOrder,
  summariseWeb,
  webFilters,
  webWorkspaceChanges,
  type WebComparison,
} from "@/lib/web-report";

/**
 * Website Change Detector in the Comparison Workspace.
 *
 * Places are the page's own headings — Pricing › Enterprise, not a page
 * number — and the section map at the top narrows the list to one part of the
 * page.
 */
export function WebReport({
  result,
  url,
  analyst,
  analysis = null,
  focus = null,
}: {
  result: WebComparison;
  url: string;
  /** AI Change Analyst, shown under the workspace. */
  analyst?: ReactNode;
  analysis?: ChangeAnalysis | null;
  /** A change to show, asked for from outside the report ("View change"). */
  focus?: FocusRequest;
}) {
  const report = useMemo(() => buildWebReport(result), [result]);
  const changes = useMemo(() => webWorkspaceChanges(inWorkspaceOrder(result.changes), { view: readView(result.view) }), [result]);
  const filters = useMemo(() => webFilters(changes), [changes]);

  return (
    <WebWorkspace
      tool="Website Change Detector"
      result={result}
      headline={summariseWeb(report)}
      summary={report.categories.filter((item) => item.count > 0).map((item) => ({ label: item.label, count: item.count }))}
      emptyNote="This page says the same as it did when you captured your baseline."
      facts={[{ label: "Address", value: <span className="break-all">{url}</span> }]}
      changes={changes}
      filters={filters}
      overviewTitle="Section map"
      overview={(context) => (
        <SectionMap
          sections={report.sections}
          selected={context.filters.section ?? []}
          onToggle={(path) => context.toggleFilter("section", path)}
        />
      )}
      footer="Every change was found by reading the page directly and comparing it with your baseline. No AI was used in the comparison."
      analyst={analyst}
      analysis={analysis}
      focus={focus}
      exportPage={{ url, baseline: null }}
    />
  );
}
