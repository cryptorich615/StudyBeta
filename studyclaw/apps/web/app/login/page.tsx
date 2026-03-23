import { redirect } from 'next/navigation';

export default function LoginAliasPage() {
  redirect('/auth?mode=login');
}
