import { redirect } from 'next/navigation';

// Models now live with everything else Arcwork can use.
export default function ModelsPage() {
  redirect('/connections#models');
}
