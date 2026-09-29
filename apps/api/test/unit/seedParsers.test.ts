import { describe, expect, it } from 'vitest';
import { parseAirlines, parseAirports } from '../../src/seed/reference';

describe('parseAirports (OurAirports)', () => {
  const csv = `"id","ident","type","name","latitude_deg","longitude_deg","elevation_ft","continent","iso_country","iso_region","municipality","scheduled_service","icao_code","iata_code","gps_code","local_code","home_link","wikipedia_link","keywords"
3878,"KSFO","large_airport","San Francisco International Airport",37.619806,-122.374821,13,"NA","US","US-CA","San Francisco","yes","KSFO","SFO","KSFO","SFO",,,
6523,"00A","heliport","Total RF Heliport",40.070985,-74.933689,11,"NA","US","US-PA","Bensalem","no",,,"K00A","00A",,,
5531,"RJAA","large_airport","Narita International Airport",35.76858,140.388714,141,"AS","JP","JP-12","Narita","yes","RJAA","NRT","RJAA",,,,`;

  it('keeps airports with an IATA or ICAO code and derives the timezone', () => {
    const rows = parseAirports(csv);
    expect(rows.map((r) => r.iataCode)).toEqual(['SFO', 'NRT']);
    expect(rows[0]).toMatchObject({
      id: 3878,
      icaoCode: 'KSFO',
      timezone: 'America/Los_Angeles',
      elevationFt: 13,
    });
    expect(rows[1]!.timezone).toBe('Asia/Tokyo');
  });
});

describe('parseAirlines (OpenFlights)', () => {
  const dat = `-1,"Unknown",\\N,"-","N/A",\\N,\\N,"Y"
24,"American Airlines",\\N,"AA","AAL","AMERICAN","United States","Y"
439,"Alaska Airlines",\\N,"AS","ASA"," Inc.","ALASKA","Y"
2,"135 Airways",\\N,"","GNL","GENERAL","United States","N"`;

  it('parses \\N as null, skips the placeholder row and tolerates extra columns', () => {
    const rows = parseAirlines(dat);
    expect(rows.map((r) => r.id)).toEqual([24, 439, 2]);
    expect(rows[0]).toMatchObject({
      iataCode: 'AA',
      icaoCode: 'AAL',
      country: 'United States',
      active: true,
    });
    expect(rows[1]).toMatchObject({ iataCode: 'AS', active: true });
    expect(rows[2]).toMatchObject({ iataCode: null, icaoCode: 'GNL', active: false });
  });
});
