// Address search (Google Places, through our API). Shown only when maps is switched on (MAPS_PROVIDER=google).
import { useEffect, useRef, useState } from 'react';
import { maps, type PlacePick } from './api';

export function AddressSearch({ onPick }: { onPick: (p: PlacePick) => void }) {
  const [text, setText] = useState('');
  const [results, setResults] = useState<{ placeId: string; main?: string; secondary?: string; text?: string }[]>([]);
  const [open, setOpen] = useState(false);
  const session = useRef(crypto.randomUUID()); // one Google billing session per search → pick
  useEffect(() => {
    if (text.trim().length < 3) { setResults([]); return; }
    const t = setTimeout(() => maps.search(text, session.current).then(r => { setResults(r.results); setOpen(true); }).catch(() => setResults([])), 300);
    return () => clearTimeout(t);
  }, [text]);
  async function pick(placeId: string) {
    setOpen(false);
    const r = await maps.place(placeId, session.current);
    session.current = crypto.randomUUID();
    setText(r.place.formatted);
    onPick(r.place);
  }
  return (
    <div className="relative">
      <label className="flex flex-col gap-1.5 text-sm font-semibold text-sub">Search your address
        <input value={text} onChange={e => setText(e.target.value)} onFocus={() => results.length && setOpen(true)} placeholder="Society, building or street in Patna"
          role="combobox" aria-expanded={open} aria-controls="address-results" autoComplete="off" className="h-12 rounded-xl border border-line bg-white px-4 text-base text-ink" />
      </label>
      {open && results.length > 0 && (
        <ul id="address-results" role="listbox" className="absolute z-20 mt-1 w-full rounded-xl border border-line bg-white shadow-lg overflow-hidden">
          {results.map(r => (
            <li key={r.placeId} role="option" aria-selected={false}>
              <button type="button" onClick={() => pick(r.placeId)} className="w-full text-left px-4 py-3 hover:bg-mist">
                <span className="font-semibold">{r.main ?? r.text}</span>{r.secondary && <span className="block text-sm text-sub">{r.secondary}</span>}
              </button>
            </li>
          ))}
          <li className="px-4 py-1.5 text-[11px] text-sub text-right">Powered by Google</li>
        </ul>
      )}
    </div>
  );
}
