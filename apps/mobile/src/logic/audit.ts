// 规则体检: before anything runs, the computer reads the training script (parses it, never runs it) and flags the
// common leakage patterns. The server sends stable codes; the phone words them. Pure helpers, no I/O.
import { trObj } from '../i18n';

export type Light = 'red' | 'yellow' | 'green' | 'error';
export interface Finding { code: string; rule: string; severity: 'red' | 'yellow'; line: number }
export interface AuditReport { file: string; status: Light; findings: Finding[]; error?: { code: string; message: string; line: number | null } }

const CODES: Record<string, { what: string; fix: string }> = trObj({
  'R1.random_split': { what: '按行随机划分，同一个人的数据可能同时在训练集和测试集里。', fix: '按人划分：用 GroupShuffleSplit 或 GroupKFold，groups 填受试者列。' },
  'R1.random_cv': { what: '交叉验证不看受试者，同一个人的数据会落在不同折里。', fix: '换成 GroupKFold（或 StratifiedGroupKFold），并传 groups。' },
  'R1.default_cv': { what: 'cv 只写了数字或没写，等于普通 K 折，不看受试者。', fix: '传 cv=GroupKFold(n) 和 groups=受试者列。' },
  'R1.validation_split': { what: 'validation_split 直接取最后几行当验证集，不看受试者。', fix: '自己按人切出验证集，再用 validation_data 传入。' },
  'R1.resplit_joined_parts': { what: '训练和验证/测试部分被合并后又不分组地重新划分。', fix: '保留原来按人划分的部分，或合并后再按人划分。' },
  'R2.before_split': { what: '这一步在划分之前用全部数据拟合，测试集的统计量漏进了训练。', fix: '放进 Pipeline，只在训练部分上 fit。' },
  'R2.fit_on_test': { what: '这一步在测试数据上拟合了。', fix: '只在训练部分 fit，测试部分只做 transform。' },
  'R2.outside_pipeline': { what: '这一步在 Pipeline 外拟合，拟合的数据看不出只是训练部分。', fix: '把这一步和模型放进同一个 Pipeline，交叉验证时会在每折里重新拟合。' },
  'R2.manual_stats_before_split': { what: '手写的标准化用了全部数据的均值、标准差或最大值，之后才划分。', fix: '只用训练部分算统计量，再套到测试部分。' },
  'R2.select_before_split': { what: '特征选择用了全部行（含测试标签），之后才划分或交叉验证。', fix: '把特征选择放进 Pipeline，在每个训练折里做。' },
  'R2.reduce_before_split': { what: '降维（PCA、UMAP 等）在划分前用全部数据拟合。', fix: '只在训练部分拟合降维，作为 Pipeline 的一步。' },
  'R2.impute_before_split': { what: '缺失值用全部行的统计量填补，之后才划分。', fix: '只在训练部分拟合填补器，例如放进 Pipeline。' },
  'R2.target_before_split': { what: '标签用全部行的统计量做了变换（标准化等）。', fix: '只用训练标签拟合变换，再套到测试标签。' },
  'R2.confound_before_split': { what: '混杂变量（年龄、性别、站点等）用全部行回归掉了。', fix: '只在训练部分拟合回归系数，再用到测试部分。' },
  'R2.harmonise_before_split': { what: '站点或批次校正（ComBat 类）在划分前用了全部行。', fix: '只在训练部分学习校正，再套到测试部分。' },
  'R2.augment_before_split': { what: '划分前做了数据增强，近似副本会同时出现在训练和测试里。', fix: '划分之后只对训练部分做增强。' },
  'R3.fake_data': { what: 'X 或 y 是随机生成的，脚本没有读任何数据文件。', fix: '读入真实数据；如果这是演示，请标明。' },
  'R4.search_on_test': { what: '超参数搜索在测试集上拟合。', fix: '在训练部分上做搜索，测试集只在最后用一次。' },
  'R4.early_stop_on_test': { what: '测试集被当成早停或评估集。', fix: '从训练部分另留一份验证集做早停。' },
  'R4.test_in_loop': { what: '在反复重训的循环里看测试分数，等于用测试集挑设置。', fix: '在训练部分用交叉验证挑设置，测试集只评估一次。' },
  'R5.before_split': { what: '划分前做了过采样或欠采样（SMOTE 等）。', fix: '只对训练部分重采样，或用 imblearn 的 Pipeline。' },
  'R5.duplicated_before_split': { what: '划分前复制或追加了行，副本可能同时在训练和测试里。', fix: '只在训练部分复制，或按原始行分组划分。' },
  'R5.on_test': { what: '测试部分被重采样了，分数算在合成或重复的行上。', fix: '测试部分保持原样，只对训练部分重采样。' },
  'PARSE.skipped_line': { what: 'Python 读不懂这一行，已跳过，其余部分照常检查。', fix: '检查这一行的语法。' },
});

/** Chinese wording for a finding; an unknown code (a newer computer) still shows its code instead of nothing. */
export function describeFinding(f: Finding): { what: string; fix: string } {
  return CODES[f.code] ?? { what: f.code, fix: '' };
}

const HEADLINE: Record<Light, string> = trObj({
  red: '规则体检：发现会让分数虚高的写法',
  yellow: '规则体检：有几处需要你确认',
  green: '规则体检：没有发现常见的泄漏写法',
  error: '规则体检：脚本读不了',
});
export function auditHeadline(r: AuditReport): { tone: 'ok' | 'bad' | 'warn'; title: string } {
  return { tone: r.status === 'green' ? 'ok' : r.status === 'red' ? 'bad' : 'warn', title: HEADLINE[r.status] };
}
