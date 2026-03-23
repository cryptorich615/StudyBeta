import { redirect } from 'next/navigation';

export default function SignupAliasPage() {
  redirect('/auth?mode=signup');
}
