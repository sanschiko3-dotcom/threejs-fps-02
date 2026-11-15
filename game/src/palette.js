// SOLSTICE YARD palette: dusk at a solar power station. Six colours carry the whole
// look — deep indigo sky, warm amber sun-low light, teal defender cloth, amber striker
// cloth, pale panel glass and concrete grey. Every material in the game picks from here.
export const PALETTE = {
  sky: 0x2a2438,        // dusk indigo, also the fog colour
  ground: 0x453f33,      // dry dirt service yard
  concrete: 0x7a7466,    // walls, hall, control building
  concreteDark: 0x4a463e,
  panel: 0x1d3a4d,       // solar panel glass, catches the amber sun
  panelEdge: 0x8a8f96,
  amber: 0xf0a830,       // striker team + sun accent + muzzle light
  accent: 0xf0a830,      // UI accent, same amber as the strikers
  teal: 0x37b8a5,        // warden team
  ink: 0xe9e6df,         // HUD text, crosshair
  muted: 0x98a0a8,
  hazard: 0xd84a2f,      // bomb, danger, round-loss red
  sun: 0xffb45e,         // low sun disc + key light tint
};

export const CSS = {
  canvas: '#211d2e',
  surface: '#262233',
  hairline: '#3a3550',
  ink: '#e9e6df',
  muted: '#98a0a8',
  accent: '#f0a830',
  teal: '#37b8a5',
  danger: '#d84a2f',
};
