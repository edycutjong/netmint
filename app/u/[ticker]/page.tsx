import { LookupView } from '../../components/LookupView';
import type { LookupWindow } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  return { title: `${decodeURIComponent(ticker).toUpperCase()}: every tokenised wrapper, net creation checked on chain · NetMint` };
}

export default async function TickerPage({
  params,
  searchParams,
}: {
  params: Promise<{ ticker: string }>;
  searchParams: Promise<{ from?: string; to?: string; window?: string }>;
}) {
  const { ticker } = await params;
  const sp = await searchParams;
  const u = decodeURIComponent(ticker).toUpperCase();
  const w = Number(sp.window ?? 30);
  const win = ([7, 30, 90].includes(w) ? w : 30) as LookupWindow;
  return (
    <main className="page">
      <p className="eyebrow">Every tokenised wrapper of</p>
      <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 44, margin: '0 0 18px', letterSpacing: '0.04em' }}>{u}</h1>
      <LookupView u={u} from={sp.from} to={sp.to} initialWindow={win} />
    </main>
  );
}
