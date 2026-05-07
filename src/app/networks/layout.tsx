import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Сеть',
};

export default function NetworksLayout({ children }: { children: React.ReactNode }) {
  return children;
}
