import { describe, expect, it } from 'vitest';
import { AIRCRAFT_FAMILIES, classifyAircraftFamily } from '../src';

describe('classifyAircraftFamily', () => {
  const cases: [string, string | null][] = [
    ['Boeing 777-200 ER', 'Boeing 777'],
    ['Boeing 777-300 ER', 'Boeing 777'],
    ['Boeing 777-200 LR', 'Boeing 777'],
    ['Boeing 777', 'Boeing 777'],
    ['Boeing 737-800', 'Boeing 737'],
    ['Boeing 737 MAX 8', 'Boeing 737'],
    ['Boeing 737-900ER', 'Boeing 737'],
    ['Boeing 737-300', 'Boeing 737'],
    ['Boeing 747-400', 'Boeing 747'],
    ['Boeing 757-200', 'Boeing 757'],
    ['Boeing 767-300', 'Boeing 767'],
    ['Boeing 787-10', 'Boeing 787'],
    ['Airbus A319', 'Airbus A320'],
    ['Airbus A320', 'Airbus A320'],
    ['Airbus A321', 'Airbus A320'],
    ['Airbus A321neo', 'Airbus A320'],
    ['Airbus A330-300', 'Airbus A330'],
    ['Airbus A350-900', 'Airbus A350'],
    ['Airbus A380-800', 'Airbus A380'],
    ['Airbus A220-300', 'Airbus A220'],
    ['Bombardier CS100', 'Airbus A220'],
    ['Embraer 170', 'Embraer E-Jet'],
    ['Embraer 175', 'Embraer E-Jet'],
    ['Embraer E175', 'Embraer E-Jet'],
    ['Embraer 190', 'Embraer E-Jet'],
    ['Embraer E190-E2', 'Embraer E-Jet E2'],
    ['Embraer RJ145', 'Embraer ERJ'],
    ['Embraer ERJ-135', 'Embraer ERJ'],
    ['Bombardier CRJ200', 'Bombardier CRJ'],
    ['Bombardier CRJ700', 'Bombardier CRJ'],
    ['Bombardier CRJ900', 'Bombardier CRJ'],
    ['DHC-8 Dash 8', 'De Havilland Dash 8'],
    ['ATR 72-600', 'ATR 42/72'],
    ['Cessna 172', null],
    ['', null],
  ];
  it.each(cases)('%s → %s', (name, family) => {
    expect(classifyAircraftFamily(name)).toBe(family);
  });

  it('handles null and undefined', () => {
    expect(classifyAircraftFamily(null)).toBeNull();
    expect(classifyAircraftFamily(undefined)).toBeNull();
  });

  it('has unique family names', () => {
    const names = AIRCRAFT_FAMILIES.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
