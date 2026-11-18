// 提示用户是在和 AI 互动 (《人工智能拟人化互动服务管理暂行办法》第十八条, plan 2.5): one fixed line under every answer a
// model wrote, so a reply from 账账 or the paper Q&A is never mistaken for a person's or for checked fact.
import { tr } from '../i18n';

export const AI_NOTE = '以上由 AI 生成，可能有误，请自己核对。';
export const AiNote = () => <p className="muted ai-note" data-testid="ai-note">{tr(AI_NOTE)}</p>;
