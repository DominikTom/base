'use client';

import { useState } from 'react';
import { X } from 'lucide-react';

// Prosty edytor tagów (chipy): Enter lub przecinek dodaje, × usuwa.
// Limity zgodne z walidacją API: max 15 tagów × 40 znaków.
export function TagInput({
  tags, onChange, placeholder = 'Dodaj tag i Enter…',
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');

  function commit() {
    const value = draft.trim().replace(/,+$/, '').trim();
    setDraft('');
    if (!value || value.length > 40 || tags.length >= 15) return;
    if (tags.some(t => t.toLowerCase() === value.toLowerCase())) return;
    onChange([...tags, value]);
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5 px-2 py-1.5 rounded-xl bg-surface border border-line focus-within:border-primary/50 focus-within:ring-4 focus-within:ring-primary/10">
      {tags.map(tag => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-primary-soft text-primary-ink"
        >
          {tag}
          <button
            type="button"
            onClick={() => onChange(tags.filter(t => t !== tag))}
            className="hover:text-primary"
            aria-label={`Usuń tag ${tag}`}
          >
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={e => {
          if (e.target.value.endsWith(',')) {
            setDraft(e.target.value);
            commit();
          } else {
            setDraft(e.target.value);
          }
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Backspace' && !draft && tags.length > 0) onChange(tags.slice(0, -1));
        }}
        onBlur={commit}
        placeholder={tags.length === 0 ? placeholder : ''}
        maxLength={40}
        className="flex-1 min-w-[120px] bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none py-0.5"
      />
    </div>
  );
}
