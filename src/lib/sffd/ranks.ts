// Fire-side ranks (ARCHITECTURE §1, §5), in order. Trades are same-rank only.

export const RANKS = [
  'Firefighter',
  'Paramedic',
  'Lieutenant',
  'Captain',
  'Battalion Chief',
  'Division Chief',
] as const

export type Rank = (typeof RANKS)[number]

export function isRank(value: unknown): value is Rank {
  return typeof value === 'string' && (RANKS as readonly string[]).includes(value)
}

/** Sort position of a rank (0 = Firefighter), -1 if unknown. */
export function rankOrder(rank: string): number {
  return (RANKS as readonly string[]).indexOf(rank)
}

// Common spellings and abbreviations seen on department rosters, keyed by the
// input lower-cased with everything except a–z removed ('FF-PM' → 'ffpm').
const RANK_ALIASES: Readonly<Record<string, Rank>> = {
  firefighter: 'Firefighter',
  ff: 'Firefighter',
  fireman: 'Firefighter',
  paramedic: 'Paramedic',
  pm: 'Paramedic',
  ffpm: 'Paramedic',
  ffp: 'Paramedic',
  medic: 'Paramedic',
  firefighterparamedic: 'Paramedic',
  lieutenant: 'Lieutenant',
  lt: 'Lieutenant',
  lieut: 'Lieutenant',
  captain: 'Captain',
  capt: 'Captain',
  cpt: 'Captain',
  battalionchief: 'Battalion Chief',
  bc: 'Battalion Chief',
  batchief: 'Battalion Chief',
  divisionchief: 'Division Chief',
  dc: 'Division Chief',
  divchief: 'Division Chief',
}

/**
 * Maps free-text rank input to a Rank: exact names (any case) and common
 * abbreviations (FF, PM, FF-PM, Medic, Lt, Capt, CPT, BC, DC). Null if unknown.
 */
export function parseRank(input: string | null | undefined): Rank | null {
  if (typeof input !== 'string') return null
  const key = input.toLowerCase().replace(/[^a-z]/g, '')
  return RANK_ALIASES[key] ?? null
}
