import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from './providers';
import { SiteHeader } from '@/components/SiteHeader';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#0b1020',
};

export const metadata: Metadata = {
  title: 'diploma-z96a',
  description: 'WEB3 network visualization on 3D globe and 2D map',
  manifest: '/manifest.webmanifest',
  applicationName: 'diploma-z96a',
  formatDetection: {
    telephone: false,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <Providers>
          <SiteHeader />
          {children}
        </Providers>
      </body>
    </html>
  );
}

