import { View } from 'react-native';
import type { ReactNode } from 'react';
import { color as palette } from '../theme';

export type IconName =
  | 'search' | 'bell' | 'settings' | 'back' | 'close' | 'clear'
  | 'bookmark' | 'bookmarkFilled' | 'home' | 'issues' | 'ranking'
  | 'filter' | 'chevronDown' | 'chevronRight' | 'trash';

// Outline icons drawn with plain Views on a 24-unit grid (same geometry as the
// prototype's SVGs). Deliberately no native SVG dependency: any change to
// apps/mobile/package.json requires a new native runtime and EAS builds
// (scripts/verify-native-release.mjs), which would strand the installed dev builds.
type P = [number, number];

export function Icon({ name, size = 22, color = palette.text, strokeWidth = 1.8 }: {
  name: IconName; size?: number; color?: string; strokeWidth?: number;
}) {
  const k = size / 24;
  const w = Math.max(1, strokeWidth * k);
  let key = 0;
  const line = ([x1, y1]: P, [x2, y2]: P, tint = color): ReactNode => {
    const dx = (x2 - x1) * k, dy = (y2 - y1) * k;
    const length = Math.hypot(dx, dy) + w; // + w: round caps that also close joins
    const cx = ((x1 + x2) / 2) * k, cy = ((y1 + y2) / 2) * k;
    return (
      <View key={key++} style={{
        position: 'absolute', left: cx - length / 2, top: cy - w / 2, width: length, height: w,
        borderRadius: w / 2, backgroundColor: tint, transform: [{ rotate: Math.atan2(dy, dx) + 'rad' }],
      }} />
    );
  };
  const path = (points: P[], tint = color) => points.slice(1).map((p, i) => line(points[i], p, tint));
  const circle = (cx: number, cy: number, r: number, fill?: string): ReactNode => (
    <View key={key++} style={{
      position: 'absolute', left: (cx - r) * k - (fill ? 0 : w / 2), top: (cy - r) * k - (fill ? 0 : w / 2),
      width: 2 * r * k + (fill ? 0 : w), height: 2 * r * k + (fill ? 0 : w), borderRadius: 999,
      ...(fill ? { backgroundColor: fill } : { borderWidth: w, borderColor: color }),
    }} />
  );
  const rect = (x: number, y: number, rw: number, rh: number, r = 0): ReactNode => (
    <View key={key++} style={{
      position: 'absolute', left: x * k - w / 2, top: y * k - w / 2, width: rw * k + w, height: rh * k + w,
      borderWidth: w, borderColor: color, borderRadius: r * k,
    }} />
  );

  let shape: ReactNode = null;
  switch (name) {
    case 'search': shape = <>{circle(10.8, 10.8, 7.2)}{line([16.2, 16.2], [20.8, 20.8])}</>; break;
    case 'back': shape = path([[14, 5], [7, 12], [14, 19]]); break;
    case 'chevronRight': shape = path([[10, 7], [15, 12], [10, 17]]); break;
    case 'chevronDown': shape = path([[7, 10], [12, 15], [17, 10]]); break;
    case 'close': shape = <>{line([6, 6], [18, 18])}{line([18, 6], [6, 18])}</>; break;
    case 'clear': shape = <>{circle(12, 12, 9, color)}{line([9, 9], [15, 15], palette.surface)}{line([15, 9], [9, 15], palette.surface)}</>; break;
    case 'bookmark': shape = path([[12, 16.3], [6, 20.5], [6, 3.5], [18, 3.5], [18, 20.5], [12, 16.3]]); break;
    case 'bookmarkFilled': shape = (
      <>
        <View style={{ position: 'absolute', left: 6 * k, top: 3.5 * k, width: 12 * k, height: 12.8 * k, backgroundColor: color }} />
        <View style={{ position: 'absolute', left: 6 * k, top: 16.3 * k, width: 0, height: 0, borderTopWidth: 4.2 * k, borderTopColor: color, borderRightWidth: 6 * k, borderRightColor: 'transparent' }} />
        <View style={{ position: 'absolute', left: 12 * k, top: 16.3 * k, width: 0, height: 0, borderTopWidth: 4.2 * k, borderTopColor: color, borderLeftWidth: 6 * k, borderLeftColor: 'transparent' }} />
        {path([[12, 16.3], [6, 20.5], [6, 3.5], [18, 3.5], [18, 20.5], [12, 16.3]])}
      </>
    ); break;
    case 'home': shape = <>{path([[4, 20], [4, 10.5], [12, 4], [20, 10.5], [20, 20], [14.5, 20], [14.5, 14], [9.5, 14], [9.5, 20], [4, 20]])}</>; break;
    case 'issues': shape = <>{rect(5, 3.5, 14, 17, 2)}{line([8.5, 8.5], [15.5, 8.5])}{line([8.5, 12], [15.5, 12])}{line([8.5, 15.5], [13, 15.5])}</>; break;
    case 'ranking': shape = <>{line([4, 20], [20, 20])}{rect(6.5, 14, 3.5, 6)}{rect(10, 8, 4, 12)}{rect(14, 11, 3.5, 9)}</>; break;
    case 'filter': shape = <>{line([4, 7], [12.5, 7])}{line([17.5, 7], [20, 7])}{line([4, 17], [6.5, 17])}{line([11.5, 17], [20, 17])}{circle(15, 7, 2)}{circle(9, 17, 2)}</>; break;
    case 'bell': shape = (
      <>
        <View style={{ position: 'absolute', left: 6 * k - w / 2, top: 3 * k - w / 2, width: 12 * k + w, height: 14 * k, borderWidth: w, borderBottomWidth: 0, borderColor: color, borderTopLeftRadius: 6 * k, borderTopRightRadius: 6 * k }} />
        {line([3, 17], [21, 17])}{line([10, 20.5], [14, 20.5])}
      </>
    ); break;
    case 'settings': shape = (
      <>
        {circle(12, 12, 7)}{circle(12, 12, 2.8)}
        {[0, 1, 2, 3, 4, 5].map(i => {
          const a = (i * Math.PI) / 3;
          return line([12 + Math.cos(a) * 7.5, 12 + Math.sin(a) * 7.5], [12 + Math.cos(a) * 9.6, 12 + Math.sin(a) * 9.6]);
        })}
      </>
    ); break;
    case 'trash': shape = <>{line([5, 7], [19, 7])}{path([[10, 7], [10, 4.5], [14, 4.5], [14, 7]])}{path([[7, 7], [7.8, 20], [16.2, 20], [17, 7]])}{line([10.5, 11], [10.5, 16.5])}{line([13.5, 11], [13.5, 16.5])}</>; break;
  }
  return (
    <View accessibilityElementsHidden importantForAccessibility='no-hide-descendants' pointerEvents='none' style={{ width: size, height: size, flexShrink: 0 }}>
      {shape}
    </View>
  );
}
