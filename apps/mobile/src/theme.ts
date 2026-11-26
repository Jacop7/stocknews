// Design tokens taken from reference/prototype.html.
export const color = {
  primary: '#4f46e5',
  primarySoft: '#eef0ff',
  primaryText: '#4338ca',
  background: '#f5f6f8',
  surface: '#ffffff',
  border: '#e8e8ee',
  divider: '#f0f0f4',
  text: '#16161e',
  textBody: '#5a5a72',
  textMuted: '#8e8ea0',
  benefit: '#198754',
  benefitSoft: '#e9f8ef',
  damage: '#d64545',
  damageSoft: '#fff0f0',
  caution: '#986a1e',
  cautionSoft: '#fff6e9',
  scrim: 'rgba(17,17,28,0.45)',
} as const;

export const radius = { card: 16, chip: 20, small: 8 } as const;

export const layout = { gutter: 16, maxWidth: 768 } as const;
