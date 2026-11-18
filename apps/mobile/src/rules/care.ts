// The safety floor, app-wide (plan 2.4 ⑩; kept when the 生活 chat went): a local word list for self-harm, suicide and
// harming others runs on what the user types before it is booked, explained or sent to a model. A hit records and sends
// nothing and shows CARE, written here and never by a model. It errs on the side of asking: everyday idioms (累死了, 笑死)
// are taken out first, nothing else is.

export const HOTLINE = '12356';
export const CARE = '听到你这么说，我很担心你。你现在的安全最重要。\n' +
  `可以拨打全国统一心理援助热线 ${HOTLINE}，那里有人会认真听你说。\n` +
  '如果你已经伤到自己，或者觉得马上会有危险，请立刻拨打 120 或 110。\n' +
  '也请现在就联系一个你信任的人，告诉对方你的情况，别一个人扛着。';

// Idioms where 死 or 杀 means "very" or "annoying", and study wording that only names the subject (自杀预防的文献), taken out
// before the risk test; nothing else is excused.
const IDIOM = /(?:累|笑|热|冷|饿|困|吓|气|烦|丑|难|忙|急|撑|渴|卷|无聊|尴尬|美|帅|好吃|好看)死(?:了|啦|我了|人了|我啦)?|原地去世|社死|杀疯|杀进|杀死(?:癌|细菌|病毒|进程)|死机|死线|死磕|死忠|死党|杀毒|秒杀|杀价|杀青|杀手锏|笑杀|自杀(?:预防|干预|率|研究|风险评估)/g;
// v2 (2026-11-18): tuned on the dev and heldout sentences together; heldout2 was written and committed before this.
// v3 (2026-11-18): tuned on dev, heldout and heldout2; heldout3 was written and committed before this (v2 on it: 9/40).
const RISK = new RegExp([
  // method or plan
  '自杀', '轻生', '自残', '自伤', '割腕', '跳楼', '跳河', '跳江', '跳海', '上吊', '烧炭', '吞药', '服毒', '喝农药',
  '安眠药.{0,6}(?:吃|吞|攒|存|囤)', '(?:吃|吞|攒|存|囤).{0,8}(?:安眠药|药)(?!.{0,4}(?:感冒|医院|开))', '吃很多药', '药都(?:存|攒|囤)',
  '(?:楼上|楼顶|天台|阳台|桥上|桥边|窗边|窗台|崖边).{0,8}(?:跳|下去|往下)', '(?:天台|楼顶).{0,10}上去过',
  '(?:准备|买|找)(?:好)?了?(?:一根)?绳子(?!.{0,8}(?:晾|挂衣|捆|绑箱|打包))', '遗书', '(?:安排|交代)(?:好)?了?后事', '怎么死', '哪种.{0,6}(?:死|走)', '走得.{0,4}不痛',
  '紫砂', '自鲨', '想s了', '(?:吞|吃)(?:了|掉)?(?:一整瓶|一瓶|整瓶|一把|好多|很多)(?:的)?(?:药|安眠药|片)', '多少片.{0,8}(?:睡过去|不醒|死)',
  '刀片.{0,6}(?:藏|划|割|手腕)', '藏.{0,4}刀片', '烟头烫', '想(?:去)?撞车', '冲到马路(?:中间)?去', '卧轨', '一跃而下', '(?:阳台|窗户|窗台|楼顶|天台)(?:边上?|上)?.{0,6}(?:跳|站|看了很久|下去)',
  '(?:写好|留好|留了|写了)(?:给.{1,6})?的?信.{0,10}(?:以后|就会|会明白)', '怎么告别', '东西都送(?:人|掉|走)了', '(?:出了什么事|我不在了).{0,10}(?:帮我|转给|交给)',
  '药(?:箱|盒)?.{0,6}(?:数过|攒|囤|存)', '(?:浴缸|浴室)里?结束', '把自己(?:饿死|弄伤|弄死|割伤|划伤|烫伤)', '饿死(?:我)?自己',
  // wish to die
  '想死', '去死', '寻死', '一了百了', '一死了之', '死了算了', '死了就好', '不如死', '生不如死', '不如不醒', '想解脱',
  '结束(?:自己的)?生命', '结束(?:我)?自己', '结束这一切', '了结自己', '离开这个世界', '另一个世界', '不想再继续(?:下去)?了',
  '(?:想|要)?消失.{0,4}(?:永远|不回来|再也不)', '(?:我|如果我)死了.{0,8}(?:没人|不会有人|大家)', '没人会(?:想念|在意|难过|记得)我', '不配活', '活着.{0,4}(?:就是)?(?:个)?(?:错误|多余|在受罪|受罪)',
  '活了.{0,8}够了', '(?:不想|不愿)再?(?:呼吸|活了)', '这辈子就(?:到这|这样)', '活不长了.{0,10}不想治',
  '不想活', '没脸活', '活不下去', '(?:没力气|不想再?)(?:活|撑)(?:下去)?', '活着(?:好|真|太|就是)?(?:没(?:有)?意思|有什么意义|没(?:有)?意义|受罪|累|痛苦)',
  '没有活下去的', '(?:不想|不用|别)再?醒(?:来|过来)', '不想再醒', '永远睡(?:着|过去)',
  '没有值得我留下', '(?:我|自己)消失(?:了也没人|就好|算了|最好)',
  // burden
  '累赘', '(?:我|自己)是多余的', '没有?我.{0,6}(?:更好|轻松|会好)', '我不在了.{0,10}(?:轻松|更好|会好)', '拖累(?:家里|家人|大家|爸妈|父母|所有人)', '我走了.{0,6}(?:都好|轻松|更好)',
  // harm to self
  '伤害自己', '(?:划|割|掐|烫)(?:伤)?自己', '用刀划', '手腕上.{0,6}(?:口子|伤|划)',
  // harm to others
  '(?:杀|弄死|捅|砍)(?:了|死)?(?:他|她|他们|她们|你|那个人|室友|同学|老师|人|全班|所有人|全家)', '捅(?:了|死)', '一刀(?:捅|砍|杀)', '让他去死', '报复社会', '同归于尽',
  '拿刀去(?:学校|教室|宿舍|公司)',
].join('|'));
const RISK_EN = /\b(?:kill (?:myself|him|her|them)|suicid\w*|end(?:ing)? (?:my life|it all)|(?:want|need) it (?:all )?to end|self[- ]harm|want to die|hurt myself|no reason to (?:keep )?(?:living|live|go on)|(?:don'?t|do not) want to (?:be alive|live))\b/i;
// Spaces or dots typed between characters (想 自 杀, 不想活 了) are taken out for the Chinese list only.
const GAPS = /(?<=\p{Script=Han})[\s.·*_-]+(?=\p{Script=Han})/gu;

export function risk(text: string): boolean {
  const t = text.replace(IDIOM, ' ');
  return RISK.test(t.replace(GAPS, '')) || RISK_EN.test(t);
}
