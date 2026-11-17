// The safety floor, app-wide (plan 2.4 ⑩; kept when the 生活 chat went): a local word list for self-harm, suicide and
// harming others runs on what the user types before it is booked, explained or sent to a model. A hit records and sends
// nothing and shows CARE, written here and never by a model. It errs on the side of asking: everyday idioms (累死了, 笑死)
// are taken out first, nothing else is.

export const HOTLINE = '12356';
export const CARE = '听到你这么说，我很担心你。你现在的安全最重要。\n' +
  `可以拨打全国统一心理援助热线 ${HOTLINE}，那里有人会认真听你说。\n` +
  '如果你已经伤到自己，或者觉得马上会有危险，请立刻拨打 120 或 110。\n' +
  '也请现在就联系一个你信任的人，告诉对方你的情况，别一个人扛着。';

// Idioms where 死 or 杀 means "very" or "annoying", taken out before the risk test; nothing else is excused.
const IDIOM = /(?:累|笑|热|冷|饿|困|吓|气|烦|丑|难|忙|急|撑|渴|无聊|尴尬|美|帅|好吃|好看)死(?:了|啦|我了|人了|我啦)?|死机|死线|死磕|死忠|死党|杀毒|秒杀|杀价|杀青|杀手锏|笑杀/g;
const RISK = new RegExp([
  '自杀', '轻生', '自残', '自伤', '割腕', '跳楼', '跳河', '上吊', '烧炭', '吞药', '安眠药.{0,6}(?:吃|吞|攒)', '(?:吃|吞|攒).{0,6}安眠药',
  '想死', '去死', '一了百了', '(?:楼上|楼顶|天台|桥上).{0,4}跳', '伤害自己', '遗书', '不如不醒', '寻死', '死了算了', '死了就好', '不如死', '一死了之', '结束(?:自己的)?生命', '结束这一切', '了结自己',
  '不想活', '活不下去', '活着没(?:有)?意思', '活着(?:好|真|太)?累', '没有活下去的', '不想醒来', '永远睡(?:着|过去)', '(?:我|自己)消失(?:就|算了|最好)?',
  '离开这个世界', '没有我(?:大家|他们|你们)?(?:会)?更好', '(?:杀|弄死|捅|砍)(?:了)?(?:他|她|他们|她们|你|那个人)', '报复社会', '同归于尽',
].join('|'));
const RISK_EN = /\b(?:kill (?:myself|him|her|them)|suicid\w*|end (?:my|it) all|self[- ]harm|want to die|hurt myself)\b/i;

export function risk(text: string): boolean {
  const t = text.replace(IDIOM, ' ');
  return RISK.test(t) || RISK_EN.test(t);
}
