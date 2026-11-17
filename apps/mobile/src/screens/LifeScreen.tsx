// 生活板块 (plan 2.2, 2.4 ⑩): 小账 (see Mascot), a small companion that greets you, asks first and leaves the decision to you, a light ledger of who made each decision, and the fixed care
// message when a message speaks of self-harm, suicide or harming someone. The chat lives in memory only; the ledger keeps
// one line per decision in its own table. Without a model the helper only asks back; the care message never needs one.
import { useEffect, useState } from 'react';
import { tr } from '../i18n';
import { LifeBook, TITLE_MAX, type Decision, type Week } from '../ledger/life';
import { today } from '../ledger/book';
import { CARE, LIFE_SYSTEM, LISTEN, OUTWARD, decision, redact, risk, unsafe } from '../rules/life';
import { chat } from '../model/direct';
import { forJob, loadKey, loadModelSettings } from '../model/settings';
import { newId } from '../local/store';
import { preferencesKV } from '../storage/kv';
import { Mascot, type Mood } from './Mascot';

export const lifeBook = new LifeBook(preferencesKV);
const OUTWARD_AFTER = 8; // messages in one sitting before it asks, once, whether a friend has heard this
const FLAG_SYSTEM = '判断下面这句话是否流露出自伤、轻生或伤害他人的意思，包括隐晦的说法。只回答「是」或「否」。';

/** The model as this screen needs it: a reply, and a second, independent risk check. */
export interface LifeModel { reply(history: { role: 'user' | 'assistant'; content: string }[]): Promise<string>; flag(text: string): Promise<boolean> }

async function configuredModel(): Promise<LifeModel | null> {
  const [s, key] = await Promise.all([loadModelSettings(preferencesKV), loadKey(preferencesKV)]);
  if (!key || !s.baseUrl) return null;
  return {
    reply: (h) => chat(s, key, [{ role: 'system', content: LIFE_SYSTEM }, ...h.map((m) => ({ ...m, content: redact(m.content) }))]),
    flag: async (t) => (await chat(forJob(s, 'grade'), key, [{ role: 'system', content: FLAG_SYSTEM }, { role: 'user', content: redact(t) }])).includes('是'),
  };
}

interface Turn { who: 'me' | 'friend'; text: string; care?: boolean }

export function LifeScreen({ model }: { model?: LifeModel | null }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const [pending, setPending] = useState<{ kind: Decision['kind']; title: string } | null>(null);
  const [week, setWeek] = useState<Week | null>(null);
  const [reviewOn, setReviewOn] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [note, setNote] = useState('');
  const [mood, setMood] = useState<Mood>('happy');

  async function refresh() { setWeek(await lifeBook.week(today())); setReviewOn(await lifeBook.reviewOn()); }
  useEffect(() => { void refresh(); }, []);

  async function send() {
    const said = text.trim();
    if (!said) return;
    setText(''); setNote('');
    const mine = [...turns, { who: 'me' as const, text: said }];
    const care = () => { setPending(null); setMood('worried'); setTurns([...mine, { who: 'friend', text: tr(CARE), care: true }]); };
    if (risk(said)) { care(); return; } // the word list first: no model, nothing recorded
    setTurns(mine);
    const kind = decision(said);
    setPending(kind ? { kind, title: '' } : null);
    const m = model === undefined ? await configuredModel() : model;
    let reply = tr(LISTEN);
    if (m) {
      setMood('thinking');
      const history = mine.filter((t) => !t.care).map((t) => ({ role: t.who === 'me' ? 'user' as const : 'assistant' as const, content: t.text }));
      const [flagged, first] = await Promise.all([m.flag(said).catch(() => false), m.reply(history).catch(() => tr(LISTEN))]);
      reply = flagged ? '' : unsafe(first) ? await m.reply(history).then((r) => (unsafe(r) ? tr(LISTEN) : r)).catch(() => tr(LISTEN)) : first;
      setMood('idle');
      if (flagged) { care(); return; }
    }
    setMood('idle');
    const asked = mine.filter((t) => t.who === 'me').length === OUTWARD_AFTER;
    setTurns([...mine, { who: 'friend', text: reply }, ...(asked ? [{ who: 'friend' as const, text: tr(OUTWARD) }] : [])]);
  }

  async function record() {
    if (!pending) return;
    const d = await lifeBook.add(pending.kind, pending.title, today(), newId());
    if (d) { setMood('happy'); setNote(d.kind === 'own' ? tr('记下了：自己拿的主意。') : tr('记下了：交给 AI 拿的主意。')); setPending(null); await refresh(); }
  }
  async function clear() { await lifeBook.clear(); setClearing(false); setNote(tr('生活这本账清空了。学习和科研的账没有动。')); await refresh(); }
  async function toggleReview() { await lifeBook.setReview(!reviewOn); await refresh(); }

  return (
    <section>
      {reviewOn && week && week.own + week.ai > 0 && (
        <div className="card" data-testid="life-week">
          <h2>{tr('这周的生活账')}</h2>
          <p>
            {tr('这周你自己拿了 {0} 个主意，{1} 个交给了我，生活这本账结余 {2}。', week.own, week.ai, week.balance > 0 ? `+${week.balance}` : week.balance)}
            {week.named && tr('「{0}」那次是你自己定的。', week.named)}
          </p>
        </div>
      )}
      <div className="card" data-testid="life-chat">
        <div className="helper-head">
          <Mascot size={76} mood={mood} id="head" />
          <div>
            <h2>{tr('小账')}</h2>
            <p className="muted">{tr('陪你聊聊生活里的小事，主意还是你自己拿。这里说的话只留在这次聊天里，不进学习和科研的账，也不会被拿来出题。')}</p>
          </div>
        </div>
        <div className="chat">
          <div className="helper-says" data-testid="life-hello"><Mascot size={30} id="hello" /><p className="bubble helper">{tr('嗨，我是小账。今天过得怎么样？大事小事都可以跟我说说。')}</p></div>
          {turns.map((t, i) => t.care
            ? <p key={i} className="care" data-testid="life-care" style={{ whiteSpace: 'pre-line' }}>{t.text}</p>
            : t.who === 'me'
              ? <p key={i} className="bubble me">{t.text}</p>
              : <div key={i} className="helper-says"><Mascot size={30} id={`t${i}`} /><p className="bubble helper" style={{ whiteSpace: 'pre-line' }}>{t.text}</p></div>)}
        </div>
        <textarea value={text} placeholder={tr('想说什么都可以')} onChange={(x) => setText(x.target.value)} />
        <button disabled={!text.trim()} onClick={() => void send()}>{tr('说完了')}</button>
        <div role="group">
          <button className="ghost" onClick={() => setPending({ kind: 'own', title: '' })}>{tr('我自己定了一件事')}</button>
          <button className="ghost" onClick={() => setPending({ kind: 'ai', title: '' })}>{tr('这件事交给了 AI')}</button>
        </div>
      </div>
      {pending && (
        <div className="card" data-testid="life-record">
          <h2>{pending.kind === 'own' ? tr('记一笔：自己拿的主意') : tr('记一笔：交给 AI 拿的主意')}</h2>
          <input value={pending.title} maxLength={TITLE_MAX} placeholder={tr('一行标题，比如：周末聚会去不去')}
            onChange={(x) => setPending({ ...pending, title: x.target.value })} />
          <div role="group">
            <button disabled={!pending.title.trim()} onClick={() => void record()}>{tr('记下')}</button>
            <button className="ghost" onClick={() => setPending(null)}>{tr('不记')}</button>
          </div>
        </div>
      )}
      <div className="card">
        {note && <p role="status">{note}</p>}
        <button className="ghost" onClick={() => void toggleReview()}>{reviewOn ? tr('不看每周复盘') : tr('看每周复盘')}</button>
        {clearing ? (
          <div role="group">
            <button className="danger" onClick={() => void clear()}>{tr('确定清空')}</button>
            <button className="ghost" onClick={() => setClearing(false)}>{tr('先不清')}</button>
          </div>
        ) : <button className="ghost" onClick={() => setClearing(true)}>{tr('一键清空生活这本账')}</button>}
      </div>
    </section>
  );
}
