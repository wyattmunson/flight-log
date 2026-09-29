import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useDebounced } from '../lib/useDebounced';

interface ComboboxProps<T> {
  label: string;
  value: T | null;
  onChange: (value: T | null) => void;
  /** Search hook result for the debounced query. */
  useSearch: (q: string) => { data?: T[]; isFetching: boolean; isError: boolean };
  getKey: (item: T) => string | number;
  /** Text shown in the input when a value is selected. */
  getLabel: (item: T) => string;
  renderOption: (item: T) => ReactNode;
  placeholder?: string;
  error?: string;
  required?: boolean;
  /** Allow keeping typed text that matches nothing (e.g. an unknown airline name). */
  onFreeText?: (text: string) => void;
  /** Free text to show when no value is selected (e.g. a saved unknown airline name). */
  freeText?: string;
  hint?: ReactNode;
}

/** Accessible typeahead (WAI-ARIA combobox with listbox popup). */
export function Combobox<T>({
  label,
  value,
  onChange,
  useSearch,
  getKey,
  getLabel,
  renderOption,
  placeholder,
  error,
  required,
  onFreeText,
  freeText,
  hint,
}: ComboboxProps<T>) {
  const id = useId();
  const listId = `${id}-list`;
  const [text, setText] = useState(value ? getLabel(value) : (freeText ?? ''));
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const q = useDebounced(open ? text : '', 200);
  const { data = [], isFetching, isError } = useSearch(q);

  // Sync the input when the value changes from outside (edit form load, lookup prefill).
  useEffect(() => {
    if (value) setText(getLabel(value));
    else if (freeText !== undefined) setText(freeText);
    // Only react to a different selected item; typing must not be overwritten.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value ? getKey(value) : null]);

  useEffect(() => setActive(0), [q]);

  const choose = (item: T) => {
    onChange(item);
    setText(getLabel(item));
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, Math.max(data.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && open && data[active]) {
      e.preventDefault();
      choose(data[active]!);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const showList = open && text.trim().length > 0;
  return (
    <div className="relative">
      <label htmlFor={id} className="label">
        {label}
        {required && (
          <span aria-hidden className="text-red-600">
            {' '}
            *
          </span>
        )}
      </label>
      <input
        ref={inputRef}
        id={id}
        className={`input ${error ? 'border-red-500' : ''}`}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && data[active] ? `${id}-opt-${active}` : undefined}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-err` : undefined}
        aria-required={required}
        autoComplete="off"
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          if (value) onChange(null);
          onFreeText?.(e.target.value);
        }}
        onFocus={() => text && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKeyDown}
      />
      {hint && !error && (
        <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">{hint}</div>
      )}
      {error && (
        <p id={`${id}-err`} className="mt-1 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-stone-200 bg-white py-1 text-sm shadow-lg dark:border-stone-700 dark:bg-stone-800"
        >
          {isError && <li className="px-3 py-2 text-red-600">Search failed</li>}
          {!isError && data.length === 0 && (
            <li className="px-3 py-2 text-stone-500">{isFetching ? 'Searching…' : 'No matches'}</li>
          )}
          {data.map((item, i) => (
            <li
              key={getKey(item)}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              className={`cursor-pointer px-3 py-2 ${i === active ? 'bg-brand/10 dark:bg-brand/30' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(item);
              }}
              onMouseEnter={() => setActive(i)}
            >
              {renderOption(item)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
