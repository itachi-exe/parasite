export const PORTRAIT_FORMS = ['human', 'infected', 'parasite', 'fallen'] as const;
export type PortraitForm = (typeof PORTRAIT_FORMS)[number];

export function portraitPath(seat: number, skin: number, form: PortraitForm = 'human'): string {
  const color = Number.isInteger(seat) ? ((seat % 10) + 10) % 10 : 0;
  const trim = Number.isInteger(skin) ? ((skin % 4) + 4) % 4 : 0;
  const pose = PORTRAIT_FORMS.includes(form) ? form : 'human';
  return `/v2/crew/${color}-${trim}-${pose}.webp`;
}
