import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Кабинет',
};

export default function CabinetLayout({ children }: { children: React.ReactNode }) {
  return children;
}
