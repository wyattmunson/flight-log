import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SortableTable } from '../src/components/SortableTable';

const rows = [
  { code: 'JFK', visits: 4 },
  { code: 'BOS', visits: 1 },
  { code: 'SFO', visits: 3 },
];

describe('SortableTable', () => {
  it('sorts by the initial column and toggles on header click', async () => {
    const user = userEvent.setup();
    render(
      <SortableTable
        caption="Airports"
        rows={rows}
        rowKey={(r) => r.code}
        initialSort={{ key: 'visits', dir: 'desc' }}
        columns={[
          { key: 'code', label: 'Code', value: (r) => r.code },
          { key: 'visits', label: 'Visits', value: (r) => r.visits, numeric: true },
        ]}
      />,
    );
    const codes = () =>
      screen
        .getAllByRole('row')
        .slice(1)
        .map((r) => within(r).getAllByRole('cell')[0]!.textContent);
    expect(codes()).toEqual(['JFK', 'SFO', 'BOS']);
    expect(screen.getByRole('columnheader', { name: /Visits/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );

    await user.click(screen.getByRole('button', { name: /Code/ }));
    expect(codes()).toEqual(['BOS', 'JFK', 'SFO']);
    await user.click(screen.getByRole('button', { name: /Code/ }));
    expect(codes()).toEqual(['SFO', 'JFK', 'BOS']);
  });
});
