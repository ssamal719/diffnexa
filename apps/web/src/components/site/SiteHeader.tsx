"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type FocusEvent } from "react";

import { Container } from "@/components/site/Container";
import { LogoMark } from "@/components/site/Logo";
import { GROUPS, toolsIn, type ToolGroup } from "@/lib/tools";

const GROUP_ORDER: ToolGroup[] = ["compare", "monitor"];

const MORE = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/ai-change-analyst", label: "AI Change Analyst" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

/**
 * The site header: the brand, every tool in two groups — files you compare,
 * and web pages you check against a baseline — then how DiffNexa works, AI
 * Change Analyst, About and Contact. Legal pages are in the footer.
 *
 * Every tool is an ordinary link that is always in the page's HTML, so it can
 * be reached by keyboard, by screen reader and by a search engine. On a
 * desktop each group opens as a menu; on a phone one Menu button shows the
 * whole list, so nothing is squeezed into a row too narrow for it.
 */
export function SiteHeader() {
  const pathname = usePathname() ?? "";
  const id = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const [openGroup, setOpenGroup] = useState<ToolGroup | null>(null);
  const [seenPath, setSeenPath] = useState(pathname);
  const headerRef = useRef<HTMLElement>(null);
  const buttons = useRef(new Map<ToolGroup, HTMLButtonElement>());

  // Going to another page closes any open menu.
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setMenuOpen(false);
    setOpenGroup(null);
  }

  // Escape closes what is open and returns focus to the button that opened it;
  // a click anywhere else closes it too.
  useEffect(() => {
    if (!openGroup && !menuOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (openGroup) {
        buttons.current.get(openGroup)?.focus();
        setOpenGroup(null);
      } else {
        setMenuOpen(false);
      }
    }
    function onClick(event: MouseEvent) {
      if (!headerRef.current?.contains(event.target as Node)) {
        setOpenGroup(null);
        setMenuOpen(false);
      }
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [openGroup, menuOpen]);

  function closeWhenFocusLeaves(group: ToolGroup) {
    return (event: FocusEvent<HTMLLIElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
        setOpenGroup((current) => (current === group ? null : current));
      }
    };
  }

  return (
    <header ref={headerRef} className="border-b border-rule bg-paper">
      <Container className="flex min-h-16 flex-wrap items-center gap-x-6">
        <Link href="/" className="flex items-center gap-2.5 py-3 text-[1.15rem] font-semibold tracking-tight" aria-label="DiffNexa home">
          <LogoMark />
          <span>DiffNexa</span>
        </Link>

        <button
          type="button"
          aria-expanded={menuOpen}
          aria-controls={`${id}-nav`}
          onClick={() => setMenuOpen((open) => !open)}
          className="ml-auto inline-flex items-center gap-2 rounded-[6px] border border-rule-strong px-3 py-1.5 text-[0.95rem] font-medium lg:hidden"
        >
          <span aria-hidden="true" className="text-[1.1rem] leading-none">
            {menuOpen ? "×" : "☰"}
          </span>
          Menu
        </button>

        <nav
          id={`${id}-nav`}
          aria-label="Main"
          className={[
            "w-full border-t border-rule py-3 lg:ml-auto lg:block lg:w-auto lg:border-t-0 lg:py-0",
            menuOpen ? "block" : "hidden",
          ].join(" ")}
        >
          <ul className="flex flex-col gap-4 lg:flex-row lg:items-center lg:gap-1">
            {GROUP_ORDER.map((group) => {
              const tools = toolsIn(group);
              const open = openGroup === group;
              const here = tools.some((tool) => tool.href === pathname);
              return (
                <li key={group} className="relative" onBlur={closeWhenFocusLeaves(group)}>
                  <button
                    type="button"
                    ref={(element) => {
                      if (element) buttons.current.set(group, element);
                    }}
                    aria-expanded={open}
                    aria-controls={`${id}-${group}`}
                    onClick={() => setOpenGroup(open ? null : group)}
                    className={[
                      "hidden items-center gap-1.5 rounded-[6px] px-3 py-2 text-[0.95rem] font-medium whitespace-nowrap hover:bg-surface lg:inline-flex lg:px-2.5 xl:px-3",
                      here ? "text-signal" : "text-ink",
                    ].join(" ")}
                  >
                    {GROUPS[group].label}
                    <span aria-hidden="true" className="text-[0.7rem] text-ink-soft">
                      {open ? "▲" : "▼"}
                    </span>
                  </button>
                  <p className="px-1 pb-1 text-[0.75rem] font-semibold tracking-wide text-ink-soft uppercase lg:hidden">
                    {GROUPS[group].label}
                  </p>
                  <ul
                    id={`${id}-${group}`}
                    className={[
                      "grid gap-0.5 lg:absolute lg:left-0 lg:top-full lg:z-40 lg:mt-2 lg:w-[22rem] lg:rounded-[8px] lg:border lg:border-rule lg:bg-paper lg:p-2 lg:shadow-[0_8px_24px_rgba(20,32,44,0.12)]",
                      open ? "lg:grid" : "lg:hidden",
                    ].join(" ")}
                  >
                    {tools.map((tool) => {
                      const current = tool.href === pathname;
                      return (
                        <li key={tool.href}>
                          <Link
                            href={tool.href}
                            aria-current={current ? "page" : undefined}
                            onClick={() => setOpenGroup(null)}
                            className={[
                              "block rounded-[6px] px-3 py-2 hover:bg-surface",
                              current ? "bg-signal-soft" : "",
                            ].join(" ")}
                          >
                            <span className={`block text-[0.95rem] font-medium ${current ? "text-signal" : "text-ink"}`}>
                              {tool.name}
                            </span>
                            <span className="block text-[0.8rem] text-ink-soft">{tool.menuLine}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
            {MORE.map((item) => {
              const current = item.href === pathname;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={current ? "page" : undefined}
                    className={[
                      "block rounded-[6px] px-3 py-2 text-[0.95rem] font-medium whitespace-nowrap hover:bg-surface lg:px-2.5 xl:px-3",
                      current ? "text-signal" : "text-ink",
                    ].join(" ")}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </Container>
    </header>
  );
}
