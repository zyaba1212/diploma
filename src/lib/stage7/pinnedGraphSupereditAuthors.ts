import { prisma } from '@/lib/prisma';
import { usernameIsPinnedNetworkCurator } from '@/lib/pinnedNetworkCurator';

/**
 * У пользователя с этим pubkey в профиле ник из списка кураторов закреплённых сетей.
 */
export async function pubkeyHasPinnedNetworkCuratorUsername(pubkey: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { pubkey },
    select: { username: true },
  });
  return usernameIsPinnedNetworkCurator(user?.username);
}

/** @deprecated используйте {@link pubkeyHasPinnedNetworkCuratorUsername} */
export async function isPinnedGraphSupereditAuthor(authorPubkey: string): Promise<boolean> {
  return pubkeyHasPinnedNetworkCuratorUsername(authorPubkey);
}
