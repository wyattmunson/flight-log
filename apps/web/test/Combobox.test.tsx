import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Combobox } from '../src/components/Combobox';

interface Item {
  id: number;
  code: string;
  name: string;
}
const ITEMS: Item[] = [
  { id: 1, code: 'SFO', name: 'San Francisco International' },
  { id: 2, code: 'OAK', name: 'Oakland San Francisco Bay' },
];
const useSearch = (q: string) => ({
  data: q ? ITEMS.filter((i) => `${i.code} ${i.name}`.toLowerCase().includes(q.toLowerCase())) : [],
  isFetching: false,
  isError: false,
});

function Harness({ onFree }: { onFree?: (t: string) => void }) {
  const [value, setValue] = useState<Item | null>(null);
  return (
    <>
      <Combobox<Item>
        label="From"
        value={value}
        onChange={setValue}
        useSearch={useSearch}
        getKey={(i) => i.id}
        getLabel={(i) => `${i.code} · ${i.name}`}
        renderOption={(i) => i.name}
        onFreeText={onFree}
      />
      <output data-testid="selected">{value?.code ?? 'none'}</output>
    </>
  );
}

describe('Combobox', () => {
  it('is keyboard operable: type, arrow down, enter', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: 'From' });
    await user.type(input, 'francisco');
    const options = await screen.findAllByRole('option');
    expect(options).toHaveLength(2);
    expect(input).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(screen.getByTestId('selected')).toHaveTextContent('OAK');
    expect(input).toHaveValue('OAK · Oakland San Francisco Bay');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('shows "No matches" and reports free text', async () => {
    const user = userEvent.setup();
    const typed: string[] = [];
    render(<Harness onFree={(t) => typed.push(t)} />);
    await user.type(screen.getByRole('combobox'), 'zzz');
    expect(await screen.findByText('No matches')).toBeInTheDocument();
    expect(typed.at(-1)).toBe('zzz');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
