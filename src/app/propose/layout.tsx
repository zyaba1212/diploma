import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Предложения',
};

export default function ProposeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
