import { trObj } from '../i18n';
export const LAST_PAPER_KEY = 'paper.last.v1';
export interface PaperRef { versionId: string; name: string; parseState: string }
const PARSE_ZH: Record<string, string> = trObj({ parsed: '已解析', partial: '部分解析', failed: '解析失败', unsupported: '不支持', needs_ocr: '需要文字识别', queued: '排队中', pending: '等待中', running: '解析中' });
export function PARSE_LABEL(s: string): string { return PARSE_ZH[s] ?? s; }
const METHOD_ZH: Record<string, string> = trObj({ deterministic: '规则', deterministic_fallback: '规则(备用)', rules: '规则', model: '模型' });
export function METHOD_LABEL(s: string): string { return METHOD_ZH[s] ?? s; }
const ANSWER_ZH: Record<string, string> = trObj({ ok: '已回答', answered: '已回答', not_configured: '未配置模型', no_evidence: '没找到相关原文', refused: '无法回答' });
export function ANSWER_STATUS_LABEL(s: string): string { return ANSWER_ZH[s] ?? s; }
