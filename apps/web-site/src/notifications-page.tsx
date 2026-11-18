// Notifications inbox and how we contact you (push, SMS, WhatsApp).
import { useEffect, useState } from 'react';
import { ApiError, comms, type Note } from './api';
import { Button, Card, ErrorText, Page } from './ui';

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export function NotificationsPage() {
  const [items, setItems] = useState<Note[] | null>(null);
  const [prefs, setPrefs] = useState<{ push: boolean; sms: boolean; whatsapp: boolean; language: string } | null>(null);
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    comms.inbox().then(r => { setItems(r.notifications); comms.readAll().catch(() => undefined); }).catch(e => setError(e instanceof ApiError ? e.message : 'Couldn’t load.'));
    comms.prefs().then(r => { setPrefs(r.preferences); setNote(r.note); }).catch(() => undefined);
  }, []);
  const toggle = (k: 'sms' | 'whatsapp') => prefs && (setPrefs({ ...prefs, [k]: !prefs[k] }), setSaved(false));
  return (
    <Page title="Notifications">
      <ErrorText error={error} />
      {prefs && (
        <Card className="flex flex-col gap-3">
          <p className="font-bold">How we contact you</p>
          {(['sms', 'whatsapp'] as const).map(k => (
            <label key={k} className="flex items-center justify-between gap-4 min-h-11">
              <span>{k === 'sms' ? 'SMS for bookings, payments and your physio’s arrival' : 'WhatsApp confirmations and reminders'}</span>
              <input type="checkbox" checked={prefs[k]} onChange={() => toggle(k)} className="w-5 h-5 accent-brand" />
            </label>
          ))}
          <p className="text-xs text-sub">{note} App notifications are managed in your phone’s settings.</p>
          <div className="flex items-center gap-3"><Button variant="ghost" onClick={() => comms.savePrefs(prefs).then(() => setSaved(true)).catch(e => setError(e instanceof ApiError ? e.message : 'Couldn’t save.'))}>Save</Button>{saved && <span className="text-sm font-semibold text-success-ink">Saved</span>}</div>
        </Card>
      )}
      {items?.length === 0 && <Card><p className="text-sub">Nothing yet.</p></Card>}
      <div className="flex flex-col gap-2">
        {items?.map(n => (
          <Card key={n.id} className={`!py-4 ${n.read_at ? '' : 'border-brand/40'}`}>
            <p className="text-xs text-sub font-semibold">{when(n.created_at)}</p>
            <p className="font-bold">{n.title}</p>
            {n.body && <p className="text-sub">{n.body}</p>}
          </Card>
        ))}
      </div>
    </Page>
  );
}
