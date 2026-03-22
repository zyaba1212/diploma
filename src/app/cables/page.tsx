import { GlobalNetworkPage } from '@/components/GlobalNetworkPage';

export default function CablesPage() {
  // Minimal route restore: the 3D/2D network (including underground/submarine cables & nodes)
  // is rendered inside `EarthScene`, which is used by `GlobalNetworkPage`.
  return <GlobalNetworkPage />;
}
