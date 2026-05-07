import type { Metadata } from 'next';
import { GlobalNetworkPage } from '@/components/GlobalNetworkPage';

export const metadata: Metadata = {
  title: 'Глобальная сеть',
};

export default function GlobalNetworkRoutePage() {
  return <GlobalNetworkPage />;
}

