"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cloneElement, useEffect, useId, type ReactElement, type ReactNode } from "react";

export function Loading() {
  return (
    <div className="spinner" role="status">
      <span className="sr-only">Loading</span>
    </div>
  );
}

/** A page-sized loading state, so it still has a heading and a main landmark. */
export function LoadingPage({ tabs = true }: { tabs?: boolean }) {
  return (
    <main className={tabs ? "page" : "page no-tabs"}>
      <h1 className="sr-only">Loading</h1>
      <Loading />
    </main>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  return message ? (
    <p className="note bad" role="alert">
      {message}
    </p>
  ) : null;
}

/** Sets the page title, which assistive tech announces on navigation and which tabs and history show. */
export function useTitle(title: string | undefined) {
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);
}

/** A labelled input whose hint is read after the label (not as part of it) and linked with aria-describedby. */
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactElement<Record<string, unknown>> }) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {cloneElement(children, { id, ...(hint ? { "aria-describedby": hintId } : {}) })}
      {hint && (
        <span id={hintId} className="field-hint">
          {hint}
        </span>
      )}
    </div>
  );
}

/** Inline "are you sure?" in place of a native dialog, which WhatsApp's in-app browser can suppress. */
export function Confirm({
  question,
  yes,
  no,
  busy,
  onYes,
  onNo,
}: {
  question: string;
  yes: string;
  no: string;
  busy?: boolean;
  onYes: () => void;
  onNo: () => void;
}) {
  return (
    <div className="note" role="group" aria-label={question}>
      <p>{question}</p>
      <div className="row wrap" style={{ marginTop: 8 }}>
        <button className="button" disabled={busy} onClick={onYes}>
          {yes}
        </button>
        <button className="button quiet" disabled={busy} onClick={onNo}>
          {no}
        </button>
      </div>
    </div>
  );
}

const TABS = [
  { href: "", label: "Next match" },
  { href: "/matches", label: "Matches" },
  { href: "/squad", label: "Squad" },
  { href: "/group", label: "Group" },
];

/** Bottom tab bar: reachable with a thumb. The first tab is the home screen of a Group. */
export function TabBar({ groupId }: { groupId: string }) {
  const pathname = usePathname();
  const base = `/g/${groupId}`;
  return (
    <nav className="tabs" aria-label="Sections">
      {TABS.map((tab) => {
        const href = base + tab.href;
        const current = tab.href === "" ? pathname === base : pathname.startsWith(href);
        return (
          <Link key={tab.label} href={href} aria-current={current ? "page" : undefined}>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
