import { Color } from 'cesium';

export function toColor(value: string): Color {
  if (value.startsWith('rgba(')) {
    const parts = value
      .slice(5, -1)
      .split(',')
      .map((part) => Number(part.trim()));
    return Color.fromBytes(parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] == null ? 255 : Math.round(parts[3] * 255));
  }

  if (value.startsWith('#')) {
    return Color.fromCssColorString(value);
  }

  return Color.fromCssColorString(value);
}
