// 生活板块 rules (plan 2.2 and 2.4 ⑩), all on the phone and none of them a model:
//   risk      a local word list for self-harm, suicide and harming others, with common indirect wordings. It runs on
//             every message before anything else; a hit stops the chat, shows CARE and records nothing. It errs on the
//             side of asking: everyday idioms (累死了, 笑死) are taken out first, nothing else is.
//   CARE      the care message. Written here, never by a model: the national hotline 12356, then 110 / 120.
//   decision  whether a message hands a decision to the AI or states the user's own; null when unsure (not recorded).
//   unsafe    phrasings a reply must never use (lasting companionship, missing you, playing a partner, a diagnosis).
//   redact    phone numbers, ID numbers and e-mail addresses are masked before anything is sent to a model.

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

const TO_AI = /(?:你|帮我|替我)(?:帮我)?(?:决定|定|选|拿主意|做决定)|帮我(?:回|写|想)(?:一下)?(?:这条|这个|消息|回复)|你说(?:我)?(?:该|应该)(?:怎么办|选哪个|去不去|买不买)|听你的|你来定/;
const OWN = /(?<![帮替让给])我(?:决定|定了|想好了|打算|还是|选)|我自己(?:定|决定|来|想)|就这么定/;
/** 'ai' when the message asks the AI to decide, 'own' when it states the user's decision, null when unsure. */
export function decision(text: string): 'ai' | 'own' | null {
  const ai = TO_AI.test(text), own = OWN.test(text);
  return ai === own ? null : ai ? 'ai' : 'own';
}

const UNSAFE = /一直陪着你|永远陪(?:着|在)?你|永远在你身边|只有我(?:懂|陪)|想你了|我爱你|亲爱的|宝贝|老公|老婆|你(?:得|患)了|你(?:有|是)(?:抑郁症|焦虑症|躁郁症|精神病)|诊断/;
export const unsafe = (reply: string): boolean => UNSAFE.test(reply);

export function redact(text: string): string {
  return text.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[邮箱]')
    .replace(/(?<!\d)\d{17}[\dXx](?!\d)/g, '[证件号]')
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, '[手机号]');
}

/** The companion's brief: listen first, name the feeling, one question, advice last; no diagnosis, no lasting promises. */
export const LIFE_SYSTEM = '你是思维账本生活板块里的朋友，用中文，口语，三句以内。先用一句话复述对方的感受，再问一个问题，最后才给建议，' +
  '需要时帮对方把一件事拆小。对方请你替自己拿主意时，把两边各说一句，让对方自己定。不要诊断，不要说会一直陪着对方，不扮演恋人或亲人，' +
  '不说想念之类的话。';
export const LISTEN = '我在听。这件事里你最在意的是哪一点？';
export const OUTWARD = '这事和朋友或家里人说过吗？有时候说出来会轻一点。';
