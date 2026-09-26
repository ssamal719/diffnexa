"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import type { ExportFormat } from "@/lib/export";

/**
 * The comparison controls a tool can offer in the Comparison Workspace:
 * Ignore options, Export, Reverse and Linked scrolling.
 *
 * Each is offered only by a tool that gives it real behaviour — a tool passes
 * what the control does, and a control with nothing to do is not drawn. So no
 * button here can ever do nothing.
 */

export type IgnoreOption = {
  id: string;
  label: string;
  /** What choosing it means, with an example. */
  detail: string;
};

export type IgnoreControl = {
  options: IgnoreOption[];
  /** What the comparison on screen actually applied, as the engine reported it. */
  applied: Record<string, boolean>;
  /** Differences the comparison always ignores, stated so they are never mistaken for options. */
  alwaysIgnored: string[];
  /** Content the tool never compares at all. */
  notCompared: string[];
  /** Compare again with these options. */
  onApply: (values: Record<string, boolean>) => void;
};

export type { ExportFormat } from "@/lib/export";

export type WorkspaceControls = {
  ignore?: IgnoreControl;
  exports?: ExportFormat[];
  reverse?: { onReverse: () => void; detail: string };
};

/** The widest a control's panel is; on a narrow screen it is the screen's width less a margin. */
const PANEL_WIDTH = 352;

/** Small line icons for the controls; decorative, so hidden from screen readers. */
function Icon({ name }: { name: "filter" | "download" | "swap" | "link" }) {
  const paths: Record<typeof name, string> = {
    filter: "M3 4h14l-5.5 6.5V16l-3 1.5v-7L3 4z",
    download: "M10 3v9m0 0l-3.5-3.5M10 12l3.5-3.5M4 14.5V17h12v-2.5",
    swap: "M6 4L3 7l3 3M3 7h11M14 10l3 3-3 3M17 13H6",
    link: "M8.5 11.5a3 3 0 004.2 0l2.6-2.6a3 3 0 00-4.2-4.2l-1 1M11.5 8.5a3 3 0 00-4.2 0l-2.6 2.6a3 3 0 004.2 4.2l1-1",
  };
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name]} />
    </svg>
  );
}

const BUTTON =
  "inline-flex items-center gap-1.5 rounded-[3px] border border-rule-strong bg-paper px-2.5 py-1 text-[0.85rem] font-medium hover:bg-surface";

/**
 * A button that opens a small panel beneath it. Escape closes it and returns
 * focus to the button; so does clicking anywhere else.
 */
function Popover({
  label,
  title,
  children,
}: {
  label: ReactNode;
  title: string;
  children: (close: () => void) => ReactNode;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  // Where the panel sits, relative to its button: under the button, moved just enough to stay on screen.
  const [shift, setShift] = useState(0);
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    }
    function onPointer(event: MouseEvent) {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  // Found by id rather than through the ref, because the panel's contents call it while rendering their buttons.
  const close = () => {
    setOpen(false);
    document.getElementById(`${id}-button`)?.focus();
  };

  return (
    <div ref={wrapper} className="relative">
      <button
        ref={button}
        id={`${id}-button`}
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        title={title}
        onClick={() => {
          if (!open && button.current) {
            const edge = 8;
            const box = button.current.getBoundingClientRect();
            const width = Math.min(PANEL_WIDTH, window.innerWidth - 2 * edge);
            const room = window.innerWidth - edge - width;
            setShift(Math.round(Math.max(edge, Math.min(box.left, room)) - box.left));
          }
          setOpen((value) => !value);
        }}
        className={[BUTTON, open ? "border-signal bg-signal-soft text-signal" : ""].join(" ")}
      >
        {label}
        <span aria-hidden="true" className="text-[0.65rem] text-ink-soft">
          {open ? "▲" : "▼"}
        </span>
      </button>
      <div
        id={`${id}-panel`}
        role="group"
        aria-label={title}
        hidden={!open}
        style={{ left: shift, width: `min(${PANEL_WIDTH}px, calc(100vw - 16px))` }}
        className="absolute top-full z-40 mt-1.5 rounded-[8px] border border-rule bg-paper p-3 text-[0.85rem] shadow-[0_8px_24px_rgba(20,32,44,0.14)]"
      >
        {open && children(close)}
      </div>
    </div>
  );
}

function IgnorePanel({ control, close }: { control: IgnoreControl; close: () => void }) {
  const [values, setValues] = useState<Record<string, boolean>>(() => ({ ...control.applied }));
  const changed = control.options.some((option) => Boolean(values[option.id]) !== Boolean(control.applied[option.id]));
  return (
    <div className="space-y-3">
      <fieldset>
        <legend className="font-semibold">Comparison options</legend>
        <p className="mt-0.5 text-[0.8rem] text-ink-soft">
          These change what counts as a difference. Applying them compares the documents again.
        </p>
        <div className="mt-2 space-y-2">
          {control.options.map((option) => (
            <label key={option.id} className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 shrink-0"
                checked={Boolean(values[option.id])}
                onChange={(event) => setValues((current) => ({ ...current, [option.id]: event.target.checked }))}
              />
              <span>
                <span className="font-medium">{option.label}</span>
                <span className="block text-[0.78rem] text-ink-soft">{option.detail}</span>
              </span>
            </label>
          ))}
        </div>
        <button
          type="button"
          disabled={!changed}
          onClick={() => {
            control.onApply(values);
            close();
          }}
          className="mt-3 rounded-[3px] border border-signal bg-signal px-3 py-1.5 text-[0.85rem] font-medium text-white hover:bg-[#0e4467] disabled:border-rule-strong disabled:bg-surface disabled:text-ink-soft"
        >
          Apply and compare again
        </button>
        {!changed && <p className="mt-1 text-[0.75rem] text-ink-soft">These are the options this comparison used.</p>}
      </fieldset>
      {control.alwaysIgnored.length > 0 && (
        <div>
          <p className="font-semibold">Always ignored</p>
          <ul className="mt-0.5 list-disc pl-4 text-[0.8rem] text-ink-soft">
            {control.alwaysIgnored.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
      {control.notCompared.length > 0 && (
        <div>
          <p className="font-semibold">Not compared by this tool</p>
          <ul className="mt-0.5 list-disc pl-4 text-[0.8rem] text-ink-soft">
            {control.notCompared.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Ignore options, Export and Reverse, for the workspace header. Nothing is drawn for controls a tool does not offer. */
export function ComparisonControls({ controls }: { controls?: WorkspaceControls }) {
  if (!controls || (!controls.ignore && !controls.exports?.length && !controls.reverse)) return null;
  return (
    <div role="group" aria-label="Comparison controls" className="flex flex-wrap items-center gap-2 self-center">
      {controls.ignore && (
        <Popover
          label={
            <>
              <Icon name="filter" />
              Ignore options
            </>
          }
          title="Ignore options"
        >
          {(close) => <IgnorePanel control={controls.ignore!} close={close} />}
        </Popover>
      )}
      {controls.exports && controls.exports.length > 0 && (
        <Popover
          label={
            <>
              <Icon name="download" />
              Export
            </>
          }
          title="Export this comparison"
        >
          {(close) => (
            <div>
              <p className="font-semibold">Export this comparison</p>
              <p className="mt-0.5 text-[0.8rem] text-ink-soft">
                Built in your browser from the result on screen: every change, where it is, and its evidence. AI
                explanations are not included.
              </p>
              <ul className="mt-2 space-y-1.5">
                {controls.exports!.map((format) => (
                  <li key={format.id}>
                    <button
                      type="button"
                      onClick={() => {
                        format.download();
                        close();
                      }}
                      className="w-full rounded-[4px] border border-rule px-2.5 py-1.5 text-left hover:border-signal hover:bg-signal-soft"
                    >
                      <span className="block font-medium">{format.label}</span>
                      <span className="block text-[0.78rem] text-ink-soft">{format.detail}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Popover>
      )}
      {controls.reverse && (
        <button type="button" onClick={controls.reverse.onReverse} title={controls.reverse.detail} className={BUTTON}>
          <Icon name="swap" />
          Reverse
          <span className="sr-only">: {controls.reverse.detail}</span>
        </button>
      )}
    </div>
  );
}

/** The Linked scrolling switch: pressed means scrolling one version moves the other. */
export function LinkedToggle({
  linked,
  onChange,
  unit = "paragraph",
}: {
  linked: boolean;
  onChange: (value: boolean) => void;
  /** What is kept in step: "paragraph", "page", "row". */
  unit?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={linked}
      onClick={() => onChange(!linked)}
      title={
        linked
          ? `Linked: moving through one version moves the other to the matching ${unit}. Choosing a change always shows it in both.`
          : "Not linked: each version moves on its own. Choosing a change still shows it in both."
      }
      className={[BUTTON, linked ? "border-signal bg-signal-soft text-signal" : ""].join(" ")}
    >
      <Icon name="link" />
      Linked
      <span className="text-[0.78rem] font-normal">{linked ? "On" : "Off"}</span>
    </button>
  );
}
