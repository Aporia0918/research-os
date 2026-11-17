// 第一次打开 (plan 2.2, 30 秒): say who you are (or skip), 账账 opens the conversation, you explain one thing you are
// learning, and it says what was clear. That first explanation is booked as an idea of your own (进账), so the user sees
// on day one how the book works.
import { useState } from 'react';
import { tr } from '../i18n';
import { Zhangzhang, type ZzState } from '../jelly/Zhangzhang';
import { book, today } from '../ledger/book';
import { newId } from '../local/store';
import { fromShared } from '../me/shareIn';
import { preset, WHO, type Profile, type Who } from '../me/profile';
import { firstFeedback } from './ledger/shared';

export function Welcome({ onDone }: { onDone: (p: Profile, board: '学习' | '科研') => void }) {
  const [who, setWho] = useState<Who | null>(null);
  const [step, setStep] = useState<'who' | 'talk' | 'reply'>('who');
  const [said, setSaid] = useState('');
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [zz, setZz] = useState<ZzState>('wave');
  const p = who ? preset(who) : null;
  const research = who === 'research';
  const profile = (): Profile => ({ who: who ?? 'other', slots: p?.slots ?? [], remind: p?.remind ?? false });
  const finish = () => onDone(profile(), research ? '科研' : '学习');

  function pick(w: Who) { setWho(w); setZz('smile'); setStep('talk'); }
  async function talk() {
    setBusy(true); setZz('think');
    const q = fromShared(said).question || said.trim();
    await book.add({ clientId: newId(), board: research ? '科研' : '学习', question: q, ownIdea: said.trim(), helpLevel: 'own' }, today());
    const r = await firstFeedback(said);
    setReply(r ?? tr('你先自己讲了一遍，这算一笔进账，思考结余 +1。以后问 AI 之前先说一句自己的想法，账就会轻一档。'));
    setZz('paid'); setBusy(false); setStep('reply');
  }

  return (
    <section className="welcome" data-testid="welcome">
      <div className="hero-wrap">
        <div className="hero-zz"><Zhangzhang state={zz} size={150} /></div>
        <div className="card hero">
          {step === 'who' && <>
            <h1>{tr('你好，我是账账')}</h1>
            <p>{tr('你主要用它来做什么？说一句就好，之后随时能改。')}</p>
            <div className="chips" role="group" aria-label={tr('我是')}>{WHO.map(w => (
              <button key={w.id} type="button" className="chip" onClick={() => pick(w.id)}>{tr(w.label)}</button>
            ))}</div>
          </>}
          {step === 'talk' && <>
            <h1>{research ? tr('最近在读哪篇论文、跑哪个分析？') : tr('最近在学什么？')}</h1>
            <p>{research ? tr('挑一个结论，不看资料讲给我听听？') : tr('挑一个讲给我听听？不用讲全，讲到哪算哪。')}</p>
            <textarea value={said} placeholder={tr('可以用输入法的语音随口讲')} onChange={x => setSaid(x.target.value)} />
            <div className="row">
              <button className="primary" disabled={busy || !said.trim()} onClick={() => void talk()}>{busy ? tr('处理中…') : tr('讲完了')}</button>
              <button className="ghost" onClick={finish}>{tr('先跳过')}</button>
            </div>
          </>}
          {step === 'reply' && <>
            <p className="bubble helper" data-testid="welcome-reply">{reply}</p>
            <p className="muted">{tr('以后问 AI 时记一笔，过几天我来问你「这个你给我讲讲？」，讲顺了就还清。')}</p>
            <button className="primary" onClick={finish}>{tr('开始用')}</button>
          </>}
        </div>
      </div>
    </section>
  );
}
