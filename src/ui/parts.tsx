"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function Loading() {
  return <div className="spinner" role="status" aria-label="Loading" />;
}

export function ErrorNote({ message }: { message: string | null }) {
  return message ? (
    <p className="note bad" role="alert">
      {message}
    </p>
  ) : null;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="stack">
      <h2>{title}</h2>
      {children && <p className="muted">{children}</p>}
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
