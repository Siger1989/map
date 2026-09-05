import type { Metadata, Viewport } from 'next';
import 'maplibre-gl/dist/maplibre-gl.css';
import './globals.css';
import '@/modules/controls/workspace.css';
import '@/modules/controls/panels.css';
import '@/modules/geology/legend.css';
import '@/modules/navigation/navigation.css';
import '@/modules/tracks/tracks.css';
import '@/modules/journey/journey.css';
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#10212b',
};
export const metadata: Metadata = {
  title: '观云 · 三维天气观察',
  description: '在真实三维地形上观察卫星影像、海拔等高线与天气变化。',
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
