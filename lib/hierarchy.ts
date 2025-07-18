/**
 * SFFD organisational hierarchy.
 *
 * The San Francisco Fire Department is organised into stations,
 * battalions and divisions.  This constant should mirror the
 * real‑world hierarchy used by your department.  Because the full
 * hierarchy is proprietary, only a simple example is provided
 * here.  Replace the contents with the actual station →
 * battalion → division mapping as appropriate.
 */
export const SFFD_HIERARCHY: Record<string, any> = {
  // Example structure:
  'Division 1': {
    Battalion1: ['Station1', 'Station2'],
    Battalion2: ['Station3'],
  },
  'Division 2': {
    Battalion3: ['Station4', 'Station5'],
  },
}