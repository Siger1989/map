/** Use the chosen color for the whole panel; choose text with WCAG contrast >= 4.5. */
export function folderTheme(color: string | null) {
  if (!color || !/^#[\da-f]{6}$/i.test(color)) return undefined;
  const channels = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255)
    .map((c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  const lightText = (luminance + 0.05) / 0.05 < 1.05 / (luminance + 0.05);
  return {
    '--folder-background': color,
    '--folder-text': lightText ? '#ffffff' : '#000000',
    '--folder-line': lightText ? '#ffffff45' : '#00000035',
    '--folder-hover': lightText ? '#ffffff18' : '#0000000d',
    colorScheme: lightText ? 'dark' : 'light',
  };
}
