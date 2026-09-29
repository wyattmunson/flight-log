import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db';
import { syncAircraftFamilies } from '../../src/dal/reference';
import { resetUserData } from '../helpers';

beforeEach(resetUserData);

describe('syncAircraftFamilies', () => {
  it('assigns families to unclassified types, leaves unknown ones null, and is idempotent', async () => {
    await prisma.aircraftType.createMany({
      data: [{ name: 'Boeing 777-300 ER' }, { name: 'Airbus A319' }, { name: 'Cessna 172' }],
    });
    const first = await syncAircraftFamilies();
    expect(first.assigned).toBe(2);
    expect(first.unmatched).toEqual(['Cessna 172']);

    const types = await prisma.aircraftType.findMany({ include: { aircraftFamily: true } });
    const byName = Object.fromEntries(types.map((t) => [t.name, t.aircraftFamily?.name ?? null]));
    expect(byName).toEqual({
      'Boeing 777-300 ER': 'Boeing 777',
      'Airbus A319': 'Airbus A320',
      'Cessna 172': null,
    });

    const second = await syncAircraftFamilies();
    expect(second.assigned).toBe(0);
  });

  it('does not overwrite an existing assignment', async () => {
    await syncAircraftFamilies();
    const other = await prisma.aircraftFamily.findUniqueOrThrow({ where: { name: 'Airbus A330' } });
    await prisma.aircraftType.create({
      data: { name: 'Boeing 777-200', aircraftFamilyId: other.id },
    });
    await syncAircraftFamilies();
    const t = await prisma.aircraftType.findUniqueOrThrow({
      where: { name: 'Boeing 777-200' },
      include: { aircraftFamily: true },
    });
    expect(t.aircraftFamily?.name).toBe('Airbus A330');
  });
});
