import type { Metadata, Viewport } from 'next';
import { PRODUCT_NAME, PRODUCT_DESCRIPTION } from '@/config/product';
import 'maplibre-gl/dist/maplibre-gl.css';
import '@/modules/photos/photos.css';
import './globals.css';
import '@/modules/controls/workspace.css';
import '@/modules/controls/panels.css';
import '@/modules/geology/legend.css';
import '@/modules/navigation/navigation.css';
import '@/modules/tracks/tracks.css';
import '@/modules/journey/journey.css';
import '@/modules/journey/route-rail.css';
import '@/modules/position/position.css';
import '@/modules/annotations/annotations.css';
import '@/modules/section/section.css';
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#10212b',
};
export const metadata: Metadata = {
  title: `${PRODUCT_NAME} · 三维地图与沿途天气`,
  description: PRODUCT_DESCRIPTION,
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
