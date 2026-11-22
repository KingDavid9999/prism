"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { resolveSearchRoute } from "@/lib/search";

interface Props {
  initialValue?: string;
}

// Every mounted SearchBar used to add its own document listener, so one "/"
// press ran one handler per search box on screen. A single shared listener is
// installed while any box is mounted. It focuses the most recently mounted box,
// which is what the duplicate listeners produced before.
const mountedInputs = new Set<HTMLInputElement>();

function focusOnSlash(e: KeyboardEvent) {
  if (e.key !== "/") return;
  const tag = (e.target as HTMLElement).tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
  const latest = Array.from(mountedInputs).pop();
  if (!latest) return;
  e.preventDefault();
  latest.focus();
}

export default function SearchBar({ initialValue = "" }: Props) {
  const [query, setQuery] = useState(initialValue);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    if (mountedInputs.size === 0)
      document.addEventListener("keydown", focusOnSlash);
    mountedInputs.add(input);
    return () => {
      mountedInputs.delete(input);
      if (mountedInputs.size === 0)
        document.removeEventListener("keydown", focusOnSlash);
    };
  }, []);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const route = resolveSearchRoute(query);
    if (route) router.push(route);
  }

  return (
    <form onSubmit={handleSearch} className="flex gap-2">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search tx, contract, account, ledger — press / to focus"
        className="flex-1 bg-prism-bg border border-prism-border rounded-lg px-4 py-2 text-sm outline-none focus:border-prism-accent font-mono placeholder:font-sans placeholder:text-prism-muted"
      />
      <button
        type="submit"
        className="bg-prism-accent text-prism-on-accent px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 transition"
      >
        Search
      </button>
    </form>
  );
}
