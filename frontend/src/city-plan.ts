export type CityPosition = { x: number; y: number }

// The map renderer consumes this single plan so districts, lots, destinations,
// progression buildings, and rival sites share one coordinate system.
export const cityPlan = {
  width: 100,
  height: 100,
  tierPositions: [
    { x: 11, y: 80 }, { x: 25, y: 80 }, { x: 42, y: 80 }, { x: 58, y: 74 },
    { x: 73, y: 74 }, { x: 80, y: 66 }, { x: 80, y: 55 }, { x: 73, y: 47 },
    { x: 64, y: 41 }, { x: 73, y: 35 }, { x: 80, y: 28 }, { x: 73, y: 23 },
    { x: 68, y: 17 }, { x: 75, y: 12 }, { x: 82, y: 9 },
  ] as CityPosition[],
  // Rival firms share Grand Avenue instead of floating in unrelated districts.
  rivalPositions: [
    { x: 8, y: 43 }, { x: 14, y: 52 }, { x: 20, y: 43 }, { x: 26, y: 52 },
    { x: 32, y: 43 }, { x: 38, y: 52 }, { x: 44, y: 43 }, { x: 50, y: 52 },
    { x: 56, y: 43 }, { x: 62, y: 52 }, { x: 68, y: 43 }, { x: 74, y: 52 },
    { x: 80, y: 43 }, { x: 84, y: 52 },
  ] as CityPosition[],
  scenePositions: {
    'starter-office': { x: 11, y: 80 }, 'reception-docket': { x: 18, y: 70 }, 'client-intake': { x: 25, y: 80 },
    'case-workspace': { x: 29, y: 66 }, 'mentor-conference': { x: 38, y: 60 }, 'case-resolution': { x: 38, y: 74 },
    'firm-shop': { x: 47, y: 83 }, 'research-library': { x: 12, y: 31 }, 'investigation-lab': { x: 22, y: 42 },
    'due-diligence': { x: 31, y: 31 }, 'appeals-chamber': { x: 48, y: 35 }, 'skills-academy': { x: 40, y: 43 },
    'staff-bullpen': { x: 58, y: 70 }, 'hiring-room': { x: 67, y: 79 }, 'operations-office': { x: 75, y: 68 },
    'practice-group-hall': { x: 64, y: 57 }, 'mock-courtroom': { x: 58, y: 45 }, 'portfolio-gallery': { x: 53, y: 61 },
    'records-room': { x: 31, y: 51 }, 'capital-boardroom': { x: 73, y: 41 }, 'partner-office': { x: 72, y: 28 },
    'client-site': { x: 82, y: 57 }, 'courthouse-steps': { x: 58, y: 23 }, 'break-room': { x: 54, y: 84 },
    'rooftop-skyline': { x: 78, y: 14 }, 'managing-partner-floor': { x: 80, y: 24 },
  } as Record<string, CityPosition>,
  districts: [
    { id: 'founders', name: 'Founders Row', short: 'FOUNDERS', symbol: '§', description: 'The complete entry loop: intake, casework, counsel, settlement, and the first visible office upgrade.', center: { x: 24, y: 72 }, hub: { x: 26, y: 63 }, points: '5,54 46,54 50,91 5,91' },
    { id: 'learning', name: 'Learning Quarter', short: 'LEARNING', symbol: '⌕', description: 'Research, argument forensics, passage diligence, skills practice, and prior-attempt records.', center: { x: 22, y: 32 }, hub: { x: 22, y: 27 }, points: '5,11 44,11 44,54 5,54' },
    { id: 'civic', name: 'Civic Center', short: 'CIVIC', symbol: '⚖', description: 'Appeals, mock hearings, and milestone matters that test corrected reasoning independently.', center: { x: 53, y: 31 }, hub: { x: 49, y: 27 }, points: '44,11 64,11 64,55 44,55' },
    { id: 'campus', name: 'Firm Campus', short: 'CAMPUS', symbol: '▦', description: 'The operating firm: staff, hiring, workload, practice groups, portfolio, and recovery rooms.', center: { x: 62, y: 72 }, hub: { x: 63, y: 67 }, points: '49,54 79,54 83,91 49,91' },
    { id: 'executive', name: 'Executive District', short: 'EXECUTIVE', symbol: '▲', description: 'Capital allocation, partner strategy, reflection, and the endgame firm headquarters.', center: { x: 73, y: 29 }, hub: { x: 72, y: 26 }, points: '64,8 84,8 84,54 64,54' },
    { id: 'client', name: 'Client Corridor', short: 'CLIENTS', symbol: '◆', description: 'Field matters and client-facing work along the waterfront business corridor.', center: { x: 82, y: 60 }, hub: { x: 81, y: 55 }, points: '78,41 86,41 86,84 78,84' },
  ],
  roads: [
    { id: 'grand', name: 'Grand Avenue', x: 3, y: 47, w: 82, h: 6.5, orientation: 'horizontal', traffic: 'forward' },
    { id: 'learning', name: 'Library Walk', x: 3, y: 28.5, w: 41, h: 4.5, orientation: 'horizontal', traffic: null },
    { id: 'campus', name: 'Campus Loop', x: 28, y: 71, w: 56, h: 5.5, orientation: 'horizontal', traffic: 'reverse' },
    { id: 'justice', name: 'Justice Avenue', x: 43, y: 7, w: 4.5, h: 82, orientation: 'vertical', traffic: null },
    { id: 'waterfront', name: 'Waterfront Drive', x: 73, y: 16, w: 4.5, h: 72, orientation: 'vertical', traffic: null },
    { id: 'founders', name: 'Founders Loop', x: 24, y: 55, w: 4.5, h: 34, orientation: 'vertical', traffic: null },
  ],
  bridge: { x: 85, y: 47, w: 14, h: 6.5 },
  rail: { x: 0, bottom: 3, w: 87 },
  blocks: [
    { x: 7, y: 15, w: 7, h: 7, kind: 'brick' }, { x: 17, y: 16, w: 5, h: 9, kind: 'stone' }, { x: 26, y: 14, w: 7, h: 8, kind: 'brick' }, { x: 35, y: 17, w: 5, h: 7, kind: 'glass' },
    { x: 8, y: 36, w: 6, h: 8, kind: 'stone' }, { x: 16, y: 37, w: 6, h: 7, kind: 'brick' }, { x: 27, y: 37, w: 6, h: 8, kind: 'glass' }, { x: 35, y: 38, w: 6, h: 7, kind: 'stone' },
    { x: 50, y: 14, w: 5, h: 9, kind: 'civic' }, { x: 57, y: 12, w: 5, h: 11, kind: 'civic' }, { x: 51, y: 38, w: 5, h: 7, kind: 'stone' }, { x: 58, y: 34, w: 4, h: 10, kind: 'civic' },
    { x: 66, y: 11, w: 5, h: 12, kind: 'glass' }, { x: 73, y: 10, w: 5, h: 14, kind: 'tower' }, { x: 79, y: 29, w: 4, h: 10, kind: 'tower' }, { x: 68, y: 31, w: 5, h: 9, kind: 'glass' },
    { x: 7, y: 57, w: 6, h: 8, kind: 'brick' }, { x: 16, y: 56, w: 6, h: 8, kind: 'stone' }, { x: 7, y: 70, w: 6, h: 7, kind: 'brick' }, { x: 31, y: 56, w: 5, h: 7, kind: 'stone' },
    { x: 50, y: 57, w: 5, h: 8, kind: 'campus' }, { x: 58, y: 54, w: 5, h: 9, kind: 'campus' }, { x: 68, y: 55, w: 5, h: 8, kind: 'glass' }, { x: 51, y: 77, w: 5, h: 8, kind: 'campus' },
    { x: 59, y: 79, w: 6, h: 7, kind: 'brick' }, { x: 70, y: 79, w: 5, h: 8, kind: 'campus' }, { x: 79, y: 45, w: 4, h: 8, kind: 'client' }, { x: 80, y: 66, w: 4, h: 8, kind: 'client' },
  ],
} as const
