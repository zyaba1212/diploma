import { redirect } from 'next/navigation';

/** Legacy route now points to proposals after moderation queue removal. */
export default function ModerateLegacyRedirectPage() {
  redirect('/admin/proposals');
}
