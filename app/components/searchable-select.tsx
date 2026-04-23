"use client";

import { useEffect, useRef, useState } from "react";

type Option = {
  value: string;
  label: string;
};

type SearchableSelectProps = {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  style?: React.CSSProperties;
  inputStyle?: React.CSSProperties;
  optionStyle?: React.CSSProperties;
};

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Type to search...",
  style,
  inputStyle,
  optionStyle,
}: SearchableSelectProps) {
  const [query, setQuery] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const hasQuery = query.trim().length > 0;

  const filtered = hasQuery
    ? options.filter((o) =>
        o.label.toLowerCase().includes(query.toLowerCase()),
      )
    : [];

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!hasQuery || !listRef.current) return;
    const items = listRef.current.children;
    if (items[highlightIndex]) {
      (items[highlightIndex] as HTMLElement).scrollIntoView({ block: "nearest" });
    }
  }, [highlightIndex, hasQuery]);

  function handleSelect(optionValue: string) {
    onChange(optionValue);
    setQuery("");
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!hasQuery) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((prev) => Math.min(prev + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[highlightIndex]) {
        handleSelect(filtered[highlightIndex].value);
      }
    } else if (e.key === "Escape") {
      setQuery("");
    }
  }

  const selectedOption = options.find((o) => o.value === value);

  return (
    <div ref={containerRef} style={{ position: "relative", ...style }}>
      <input
        type="text"
        value={query}
        placeholder={
          value
            ? `${selectedOption?.label || value} — type to search another`
            : placeholder
        }
        onChange={(e) => {
          setQuery(e.target.value);
          setHighlightIndex(0);
        }}
        onKeyDown={handleKeyDown}
        style={{
          width: "100%",
          padding: "7px 10px",
          border: "1px solid #e2e8f0",
          borderRadius: "6px",
          fontSize: "14px",
          boxSizing: "border-box",
          backgroundColor: "white",
          color: "#1e293b",
          minHeight: "36px",
          ...inputStyle,
        }}
      />

      {hasQuery && (
        <ul
          ref={listRef}
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            maxHeight: "240px",
            overflowY: "auto",
            backgroundColor: "white",
            border: "1px solid #e2e8f0",
            borderTop: "none",
            borderRadius: "0 0 6px 6px",
            margin: 0,
            padding: 0,
            listStyle: "none",
            zIndex: 50,
            boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
          }}
        >
          {filtered.length === 0 && (
            <li
              style={{
                padding: "8px 10px",
                fontSize: "13px",
                color: "#94a3b8",
              }}
            >
              No results
            </li>
          )}
          {filtered.map((option, i) => (
            <li
              key={option.value}
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelect(option.value);
              }}
              onMouseEnter={() => setHighlightIndex(i)}
              style={{
                padding: "8px 10px",
                fontSize: "13px",
                cursor: "pointer",
                color: "#1e293b",
                backgroundColor:
                  i === highlightIndex
                    ? "#eff6ff"
                    : option.value === value
                      ? "#f8fafc"
                    : "white",
                borderBottom: "1px solid #f1f5f9",
                ...optionStyle,
              }}
            >
              {option.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
