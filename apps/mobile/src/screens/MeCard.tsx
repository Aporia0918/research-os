// 设置 → 我和提醒: who you said you are on first open, and when reminders may come. Reminders
// come only at these times, two a day at most, never at night (remind/plan.ts).
import { useEffect, useState } from 'react';
import { tr } from '../i18n';
import { isTime, loadProfile, saveProfile, WHO, type Profile } from '../me/profile';
import { refreshReminders } from '../remind';
import { preferencesKV } from '../storage/kv';

export function MeCard() {
  const [p, setP] = useState<Profile | null>(null);
  const [slot, setSlot] = useState('');
  useEffect(() => { void loadProfile(preferencesKV).then(setP); }, []);
  if (!p) return null;
  async function save(next: Profile) { setP(next); await saveProfile(preferencesKV, next); await refreshReminders(); }
  return (
    <div className="card" data-testid="me-settings">
      <h2>{tr('我和提醒')}</h2>
      <div className="chips" role="radiogroup" aria-label={tr('我是')}>{WHO.filter(w => w.id !== 'other').map(w => (
        <button key={w.id} type="button" role="radio" className="chip" aria-checked={p.who === w.id} onClick={() => void save({ ...p, who: w.id })}>{tr(w.label)}</button>
      ))}</div>
      <label className="row"><input type="checkbox" checked={p.remind} data-testid="me-remind" onChange={x => void save({ ...p, remind: x.target.checked })} />{tr('到期了提醒我讲一讲')}</label>
      {p.remind && <>
        <p className="muted">{tr('只在这些时间提醒，一天最多两条，晚上 10 点到早上 7 点不打扰。')}</p>
        <div className="chips">{p.slots.map(s => (
          <button key={s} type="button" className="chip" aria-label={tr('去掉 {0}', s)} onClick={() => void save({ ...p, slots: p.slots.filter(x => x !== s) })}>{s} ×</button>
        ))}</div>
        <div className="row">
          <input type="time" value={slot} data-testid="me-slot" onChange={x => setSlot(x.target.value)} />
          <button className="ghost" disabled={!isTime(slot)} onClick={() => { void save({ ...p, slots: [...p.slots, slot] }); setSlot(''); }}>{tr('加一个时间')}</button>
        </div>
      </>}
    </div>
  );
}
