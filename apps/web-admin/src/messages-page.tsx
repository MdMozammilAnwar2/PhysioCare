// Messages: which services are switched on, delivery counts, the delivery log, and a test message.
import { useCallback, useEffect, useState } from 'react';
import { ApiError, messagesApi, when, type MessagesData } from './api';
import { Header } from './pages';

const LABEL: Record<string, string> = { memory: 'Test mode', console: 'Development (printed in the API terminal)', none: 'Off', expo: 'On (Expo)', msg91: 'On (MSG91)', exotel: 'On (Exotel)', google: 'On (Google)' };
const STATUS_CLS: Record<string, string> = { sent: 'text-success-ink', failed: 'text-danger-ink', pending: 'text-warning-ink', skipped: 'text-sub' };

export function MessagesPage({ isSuper }: { isSuper: boolean }) {
  const [status, setStatus] = useState('');
  const [channel, setChannel] = useState('');
  const [d, setD] = useState<MessagesData | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { messagesApi.list(status, channel).then(setD).catch(e => setErr(e instanceof ApiError ? e.message : 'Couldn’t load.')); }, [status, channel]);
  useEffect(() => { load(); }, [load]);
  const count = (ch: string, st: string) => d?.summary.find(x => x.channel === ch && x.status === st)?.n ?? 0;
  return (
    <div className="flex flex-col gap-5">
      <Header kicker="Operations" title="Messages" right={isSuper ? <button onClick={() => messagesApi.test().then(r => { setInfo(r.message); load(); }).catch(e => setErr(e instanceof ApiError ? e.message : 'Failed.'))} className="h-10 px-4 rounded-xl bg-brand text-white font-bold text-sm">Send me a test</button> : undefined} />
      {info && <p className="text-sm font-semibold text-success-ink">{info}</p>}
      {err && <p role="alert" className="text-sm font-semibold text-danger-ink">{err}</p>}
      {d && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {(['push', 'sms', 'whatsapp', 'calls', 'maps'] as const).map(k => (
            <div key={k} className="rounded-xl bg-white border border-line px-4 py-3">
              <p className="text-xs text-sub font-semibold capitalize">{k === 'sms' ? 'SMS' : k === 'whatsapp' ? 'WhatsApp' : k}</p>
              <p className={`font-extrabold ${['none', 'console', 'memory'].includes(d.providers[k]) ? 'text-warning-ink' : 'text-success-ink'}`}>{LABEL[d.providers[k]] ?? d.providers[k]}</p>
              {k !== 'calls' && k !== 'maps' && <p className="text-xs text-sub mt-1">7 days: {count(k, 'sent')} sent · {count(k, 'failed')} failed · {count(k, 'pending')} waiting</p>}
              {k === 'calls' && <p className="text-xs text-sub mt-1">7 days: {d.calls.reduce((a, c) => a + c.n, 0)} calls</p>}
            </div>
          ))}
        </div>
      )}
      <p className="text-sm text-sub">Switch services on in the server <code>.env</code>: PUSH_PROVIDER=expo, NOTIFY_SMS_PROVIDER=msg91 (with MSG91_FLOW_* templates), WHATSAPP_PROVIDER=msg91, CALL_PROVIDER=exotel, MAPS_PROVIDER=google.</p>
      <div className="flex gap-2 flex-wrap">
        <select value={channel} onChange={e => setChannel(e.target.value)} className="h-10 rounded-xl border border-line px-2 bg-white"><option value="">All channels</option><option value="push">Push</option><option value="sms">SMS</option><option value="whatsapp">WhatsApp</option></select>
        <select value={status} onChange={e => setStatus(e.target.value)} className="h-10 rounded-xl border border-line px-2 bg-white"><option value="">Any status</option><option value="sent">Sent</option><option value="failed">Failed</option><option value="pending">Waiting</option><option value="skipped">Skipped</option></select>
      </div>
      <div className="rounded-card bg-white border border-line overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-canvas text-sub text-left"><tr>{['When', 'To', 'Message', 'Channel', 'Status', 'Note'].map(h => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr></thead>
          <tbody>
            {d?.deliveries.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-sub">Nothing yet.</td></tr>}
            {d?.deliveries.map(x => (
              <tr key={x.id} className="border-t border-line align-top">
                <td className="px-4 py-2 whitespace-nowrap">{when(x.sent_at ?? x.created_at)}</td>
                <td className="px-4 py-2">{x.name ?? '—'}<div className="text-sub text-xs">{x.phone}</div></td>
                <td className="px-4 py-2">{x.title}<div className="text-sub text-xs font-mono">{x.type}</div></td>
                <td className="px-4 py-2 capitalize">{x.channel}</td>
                <td className={`px-4 py-2 font-bold capitalize ${STATUS_CLS[x.status] ?? ''}`}>{x.status}{x.attempts > 1 ? ` (${x.attempts})` : ''}</td>
                <td className="px-4 py-2 text-sub max-w-xs">{x.status === 'pending' ? `next try ${when(x.next_attempt_at)}` : x.error ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
