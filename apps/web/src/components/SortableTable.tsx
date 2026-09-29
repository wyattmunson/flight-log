import { useMemo, useState, type ReactNode } from 'react';

export interface Column<T> {
  key: string;
  label: string;
  value: (row: T) => string | number | null;
  render?: (row: T) => ReactNode;
  numeric?: boolean;
}

/** Small client-side sortable table (used for full stats tables). */
export function SortableTable<T>({
  rows,
  columns,
  initialSort,
  caption,
  rowKey,
}: {
  rows: T[];
  columns: Column<T>[];
  initialSort: { key: string; dir: 'asc' | 'desc' };
  caption: string;
  rowKey: (row: T) => string | number;
}) {
  const [sort, setSort] = useState(initialSort);
  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    return [...rows].sort((a, b) => {
      const va = col.value(a);
      const vb = col.value(b);
      if (va === vb) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      const cmp =
        typeof va === 'number' && typeof vb === 'number'
          ? va - vb
          : String(va).localeCompare(String(vb));
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [rows, columns, sort]);

  return (
    <table className="w-full text-sm">
      <caption className="sr-only">{caption}</caption>
      <thead className="sticky top-0 bg-white text-left text-xs uppercase text-stone-500 dark:bg-stone-900 dark:text-stone-400">
        <tr>
          {columns.map((c) => {
            const dir =
              sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
            return (
              <th
                key={c.key}
                scope="col"
                aria-sort={dir}
                className={`py-1.5 pr-3 font-medium ${c.numeric ? 'text-right' : ''}`}
              >
                <button
                  type="button"
                  className="uppercase"
                  onClick={() =>
                    setSort((s) =>
                      s.key === c.key
                        ? { key: c.key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
                        : { key: c.key, dir: c.numeric ? 'desc' : 'asc' },
                    )
                  }
                >
                  {c.label}
                  <span aria-hidden className="ml-0.5 text-[10px]">
                    {dir === 'ascending' ? '▲' : dir === 'descending' ? '▼' : ''}
                  </span>
                </button>
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {sorted.map((row) => (
          <tr key={rowKey(row)} className="border-t border-stone-100 dark:border-stone-800">
            {columns.map((c) => (
              <td
                key={c.key}
                className={`py-1.5 pr-3 ${c.numeric ? 'text-right tabular-nums' : ''}`}
              >
                {c.render ? c.render(row) : (c.value(row) ?? '—')}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
