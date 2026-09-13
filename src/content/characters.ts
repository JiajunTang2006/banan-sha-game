/**
 * 40 张角色版本卡登记表。
 *
 * `implemented` 只表示“技能已实现并通过规则用例”，与文案、卡面无关。
 * 未实现角色在选将池中明确不可选择，不能用空技能或近似效果冒充完成。
 */

export type Batch = 'C0' | 'C1' | 'C2' | 'C3';

export interface SkillDef {
  skillId: string;
  name: string;
  /** 展示文案，来自 v0.9 原稿整理版。 */
  text: string;
}

export interface CharacterDef {
  characterId: string;
  /** 同一本体的标 / 界 / 谋 / SP / 神版本共享 familyId，全局至多出现一种。 */
  familyId: string;
  name: string;
  title: string;
  hp: number;
  maxHp: number;
  batch: Batch;
  skills: SkillDef[];
  /** 首发 8 将 = true，其余为后续批次内容。 */
  implemented: boolean;
}

const C = (c: CharacterDef) => c;

export const CHARACTERS: CharacterDef[] = [
  C({
    characterId: 'b01',
    familyId: 'wulifan',
    name: '巫力凡',
    title: '概率整活大师',
    hp: 3,
    maxHp: 3,
    batch: 'C0',
    implemented: true,
    skills: [
      {
        skillId: 'b01.lambda',
        name: 'λ法',
        text:
          '出牌阶段，若你至少有两张未记录为“λ”的手牌，你可以摸一张牌并展示之，将其记录为“λ”。然后将你手牌中所有“λ”牌与另外两张手牌扣置混匀，令一名其他角色翻开其中一张，再将这些牌全部收回手牌。若翻开的是“λ”牌，你失去1点体力，且本回合不能再发动此技能。',
      },
    ],
  }),
  C({ characterId: 'b02', familyId: 'wangjunlin', name: '王钧霖', title: '君临全场之王', hp: 4, maxHp: 4, batch: 'C1', implemented: false, skills: [ { skillId: 'b02.shenzhi', name: '神知', text: '出牌阶段限一次，你可以观看一名其他角色的手牌，并获得其中所有【君临天下】。' }, { skillId: 'b02.shenyu', name: '神谕', text: '游戏开始时，将8张【君临天下】加入牌堆并洗混。【君临天下】对你无效。' }, { skillId: 'b02.shenfa', name: '神罚', text: '你使用的【君临天下】结算结束后，你可以摸X张牌，X为此牌本次结算实际造成的伤害总点数。' } ] }),
  C({ characterId: 'b03', familyId: 'sunlaixian', name: '孙来显', title: '阅片节制宗师', hp: 3, maxHp: 3, batch: 'C1', implemented: false, skills: [ { skillId: 'b03.yuepian', name: '阅片', text: '其他角色的准备阶段开始时，若你未于上一回合发动【导管】，你可以观看牌堆顶的两张牌并分配顶底，然后记录+1。' }, { skillId: 'b03.jiezhi', name: '节制', text: '你受到伤害后，若你本回合未发动【阅片】，本回合此后你受到的伤害均被防止。' }, { skillId: 'b03.daoguan', name: '导管', text: '一名角色的准备阶段内，若你的记录至少为1，你可以选择一名其他角色，失去1点体力并清空记录，令本回合你对其造成的伤害+1。' } ] }),
  C({
    characterId: 'b04',
    familyId: 'guyuanhao',
    name: '顾元昊',
    title: '无限干拔射手',
    hp: 4,
    maxHp: 4,
    batch: 'C0',
    implemented: true,
    skills: [
      {
        skillId: 'b04.ganba',
        name: '干拔',
        text: '你的攻击范围+3。你于出牌阶段使用【杀】无次数限制。',
      },
    ],
  }),
  C({ characterId: 'b05', familyId: 'lanyufan', name: '兰羽梵', title: '四系反应导师', hp: 3, maxHp: 3, batch: 'C1', implemented: false, skills: [ { skillId: 'b05.huashen', name: '化神', text: '准备阶段开始时，你可以摸一张牌并展示之，根据花色获得对应技能直到本回合结束。' } ] }),
  C({ characterId: 'b06', familyId: 'qianchuyang', name: '钱楚阳', title: '十秒战术大师', hp: 3, maxHp: 3, batch: 'C1', implemented: false, skills: [ { skillId: 'b06.shanyi', name: '善弈', text: '准备阶段开始时，你可以观看牌堆顶的五张牌，并在10秒内将其以任意顺序放回牌堆顶。' }, { skillId: 'b06.zhisai', name: '直塞', text: '出牌阶段限一次，你可以将一张手牌交给一名其他角色。若此牌为【杀】，其可以立即使用之。' }, { skillId: 'b06.shishang', name: '时殇', text: '你发动【善弈】时，若操作时间超过10秒，你失去1点体力。' } ] }),
  C({ characterId: 'b07', familyId: 'wangyouran', name: '王悠然', title: '黑桃抽象大师', hp: 4, maxHp: 4, batch: 'C1', implemented: false, skills: [ { skillId: 'b07.chouxiang', name: '抽象', text: '一名角色使用或打出一张【杀】后、此【杀】生效前，你可以进行一次判定。若结果为♠，令此【杀】无效。' } ] }),
  C({
    characterId: 'b08',
    familyId: 'wangqingyang',
    name: '王清阳',
    title: '冰神气体专家',
    hp: 4,
    maxHp: 4,
    batch: 'C0',
    implemented: true,
    skills: [
      { skillId: 'b08.bingshen', name: '冰神', text: '若你的武器区为空且未被废除，你视为装备着【寒冰剑】。' },
      { skillId: 'b08.qiti', name: '气体', text: '出牌阶段限一次，你可以将两张花色相同的手牌当【万箭齐发】使用。' },
      { skillId: 'b08.xiaofang', name: '小方', text: '你发动【气体】时，可以令其中至多一张♦手牌在此次花色匹配时视为任意花色。' },
    ],
  }),
  C({ characterId: 'b09', familyId: 'qianwendong', name: '钱文东', title: '通宵改码选手', hp: 3, maxHp: 3, batch: 'C1', implemented: false, skills: [ { skillId: 'b09.aoye', name: '熬夜', text: '其他角色的回合结束时，你可以摸一张牌。你以此法累计每获得三张牌，失去1点体力。' }, { skillId: 'b09.daima', name: '代码', text: '每次判定或拼点限一次，你可以将其中一张牌的点数改为1至13中的任意整数。' } ] }),
  C({ characterId: 'b10', familyId: 'xukewei', name: '徐可为', title: '本格听牌侦探', hp: 3, maxHp: 3, batch: 'C1', implemented: false, skills: [ { skillId: 'b10.benge', name: '本格', text: '游戏开始时，你可以秘密观看所有角色的身份牌。' }, { skillId: 'b10.yike', name: '弈客', text: '准备阶段开始时，你可以观看牌堆顶的三张牌，并将其以任意顺序放回牌堆顶。' }, { skillId: 'b10.yauer', name: '掩耳', text: '出牌阶段，若你可以使用防具，且本局唯一的【助听器】尚未加入游戏或位于牌堆、弃牌堆中，你可以获得此牌并立即使用之。' } ] }),
  C({
    characterId: 'b11',
    familyId: 'liuyutao',
    name: '刘禹韬',
    title: '拱火决斗导演',
    hp: 4,
    maxHp: 4,
    batch: 'C0',
    implemented: true,
    skills: [
      {
        skillId: 'b11.huoba',
        name: '火把',
        text: '出牌阶段限一次，你可以弃置一张手牌或装备区里的牌，选择两名不同角色，令前者视为对后者使用一张【决斗】。此【决斗】不能被【无懈可击】响应。',
      },
    ],
  }),
  C({
    characterId: 'b12',
    familyId: 'qianyiwen',
    name: '钱亦文',
    title: '健身纵欲达人',
    hp: 4,
    maxHp: 4,
    batch: 'C0',
    implemented: true,
    skills: [
      { skillId: 'b12.zishang', name: '紫殇', text: '游戏开始时，废除你的防具区。' },
      { skillId: 'b12.jianshen', name: '健身', text: '当其他角色因你造成的伤害而死亡后，你增加1点体力上限，然后回复1点体力。' },
      { skillId: 'b12.zongyu', name: '纵欲', text: '你可以将一张【桃】当【酒】使用，或将一张【酒】当【桃】使用。' },
    ],
  }),
  C({
    characterId: 'b13',
    familyId: 'chenyuelai',
    name: '陈越来',
    title: '十五点抽卡王',
    hp: 3,
    maxHp: 3,
    batch: 'C0',
    implemented: true,
    skills: [
      { skillId: 'b13.chouka', name: '抽卡', text: '出牌阶段限一次，你可以亮出牌堆顶的三张牌。若其点数之和不大于15，你获得这些牌；否则，将这些牌置入弃牌堆。' },
      { skillId: 'b13.jiangjun', name: '将军', text: '结束阶段开始时，若你本回合未弃置过牌，你回复1点体力。' },
    ],
  }),
  C({ characterId: 'b14', familyId: 'chenjunzhe', name: '陈俊哲', title: '网恋反诈导师', hp: 3, maxHp: 3, batch: 'C1', implemented: false, skills: [ { skillId: 'b14.wanglian', name: '网恋', text: '出牌阶段限一次，你可以弃置两张手牌或装备区里的牌，选择一名其他角色，然后你与其各回复1点体力。' }, { skillId: 'b14.zhapian', name: '诈骗', text: '出牌阶段限一次，你可以摸一张牌并秘密查看，声明一个本局存在的牌名，令一名其他角色猜测。' } ] }),
  C({ characterId: 'b15', familyId: 'zoujiangheng', name: '邹蒋恒', title: '八血游荡老鼠', hp: 6, maxHp: 8, batch: 'C1', implemented: false, skills: [ { skillId: 'b15.changxian', name: '尝鲜', text: '结束阶段开始时，若你的体力值大于场上最低体力值，你须选择失去1点体力或减少1点体力上限。' }, { skillId: 'b15.youdang', name: '游荡', text: '每次进入濒死状态时限一次，若体力上限大于1，可减少1点上限并将体力回复至1点。' }, { skillId: 'b15.laoshu', name: '老鼠', text: '你的基础手牌上限等于你的体力上限。' } ] }),
  C({
    characterId: 'b16',
    familyId: 'chengjunming',
    name: '程俊铭',
    title: '叶障蓄力选手',
    hp: 4,
    maxHp: 4,
    batch: 'C0',
    implemented: true,
    skills: [
      { skillId: 'b16.xiamu', name: '狭目', text: '你计算与其他角色的距离+1。' },
      { skillId: 'b16.yezhang', name: '叶障', text: '结束阶段开始时，若你本回合未造成过伤害，你可以摸两张牌。' },
    ],
  }),
  C({
    characterId: 'b17',
    familyId: 'tangjiajun',
    name: '唐嘉均',
    title: '内卷双闪压迫',
    hp: 3,
    maxHp: 3,
    batch: 'C0',
    implemented: true,
    skills: [
      { skillId: 'b17.neijuan', name: '内卷', text: '你的回合内，每当你非因【内卷】获得一批手牌后，你摸一张牌。' },
      { skillId: 'b17.zenghen', name: '憎恨', text: '你使用【杀】指定一名手牌数大于你的角色为目标时，或手牌数大于你的角色使用【杀】指定你为目标时，该目标须连续使用两张【闪】才能抵消此【杀】。' },
    ],
  }),
  /* ---- C2 界限突破 ---- */
  C({ characterId: 'j01', familyId: 'lanyufan', name: '界兰羽梵', title: '四相圆梦', hp: 3, maxHp: 3, batch: 'C2', implemented: false, skills: [] }),
  C({ characterId: 'j02', familyId: 'qianchuyang', name: '界钱楚阳', title: '十秒盯防', hp: 3, maxHp: 3, batch: 'C2', implemented: false, skills: [] }),
  C({ characterId: 'j03', familyId: 'xukewei', name: '界徐可为', title: '明牌布局', hp: 3, maxHp: 3, batch: 'C2', implemented: false, skills: [] }),
  C({ characterId: 'j04', familyId: 'guyuanhao', name: '界顾元昊', title: '儒雅连杀', hp: 4, maxHp: 4, batch: 'C2', implemented: false, skills: [] }),
  C({ characterId: 'j05', familyId: 'chenyuelai', name: '界陈越来', title: '精准抽卡', hp: 3, maxHp: 3, batch: 'C2', implemented: false, skills: [] }),
  C({ characterId: 'j06', familyId: 'qianwendong', name: '界钱文东', title: '星夜改码', hp: 3, maxHp: 3, batch: 'C2', implemented: false, skills: [] }),
  C({ characterId: 'j07', familyId: 'wulifan', name: '界巫力凡', title: '近身赌局', hp: 3, maxHp: 3, batch: 'C2', implemented: false, skills: [] }),
  C({ characterId: 'j08', familyId: 'wangyouran', name: '界王悠然', title: '空手状元', hp: 4, maxHp: 4, batch: 'C2', implemented: false, skills: [] }),
  /* ---- C3 高级扩展 ---- */
  C({ characterId: 'm01', familyId: 'sunlaixian', name: '谋孙来显', title: '黄钻救场', hp: 3, maxHp: 3, batch: 'C3', implemented: false, skills: [] }),
  C({ characterId: 'm02', familyId: 'qianyiwen', name: '谋钱亦文', title: '十冲绝命', hp: 4, maxHp: 4, batch: 'C3', implemented: false, skills: [] }),
  C({ characterId: 'm03', familyId: 'hejixuan', name: '谋何稷轩', title: '有道无酒', hp: 4, maxHp: 4, batch: 'C3', implemented: false, skills: [] }),
  C({ characterId: 'm04', familyId: 'wulifan', name: '谋巫力凡', title: '爆抽长戟', hp: 4, maxHp: 4, batch: 'C3', implemented: false, skills: [] }),
  C({ characterId: 'm05', familyId: 'tangjiajun', name: '谋唐嘉均', title: '卷王齐发', hp: 3, maxHp: 3, batch: 'C3', implemented: false, skills: [] }),
  C({ characterId: 'm06', familyId: 'songzhengyi', name: '谋宋政毅', title: '肘下垫脚', hp: 4, maxHp: 4, batch: 'C3', implemented: false, skills: [] }),
  C({ characterId: 's01', familyId: 'wulifan', name: 'SP巫力凡', title: '冷暴下头', hp: 4, maxHp: 4, batch: 'C3', implemented: false, skills: [] }),
  C({ characterId: 's02', familyId: 'wangyouran', name: 'SP王悠然', title: '方天无中', hp: 3, maxHp: 3, batch: 'C3', implemented: false, skills: [] }),
  C({ characterId: 's03', familyId: 'songzhengyi', name: 'SP宋政毅', title: '奶茶畏缩', hp: 3, maxHp: 3, batch: 'C3', implemented: false, skills: [] }),
  C({ characterId: 's04', familyId: 'sunchang', name: 'SP孙畅', title: '急眼安眠', hp: 3, maxHp: 3, batch: 'C3', implemented: false, skills: [] }),
  C({ characterId: 's05', familyId: 'qianchuyang', name: 'SP钱楚阳', title: '楚神坠机', hp: 6, maxHp: 6, batch: 'C3', implemented: false, skills: [] }),
  C({ characterId: 's06', familyId: 'chengjunming', name: 'SP程俊铭', title: '七点母荫', hp: 3, maxHp: 3, batch: 'C3', implemented: false, skills: [] }),
  C({ characterId: 'g01', familyId: 'zoujiangheng', name: '神邹蒋恒', title: '遁火觉皇', hp: 2, maxHp: 4, batch: 'C3', implemented: false, skills: [] }),
  C({ characterId: 'g02', familyId: 'wangjunlin', name: '神王钧霖', title: '雷霆甘霖', hp: 2, maxHp: 2, batch: 'C3', implemented: false, skills: [] }),
  C({ characterId: 'g03', familyId: 'mengxiang', name: '神孟想', title: '万贯贿局', hp: 4, maxHp: 4, batch: 'C3', implemented: false, skills: [] }),
];

export const CHARACTER_BY_ID: Record<string, CharacterDef> = Object.fromEntries(
  CHARACTERS.map((c) => [c.characterId, c]),
);

/** 第一阶段（C0）可选择的角色池：只有真正实现了技能的角色。 */
export const DEMO_POOL: CharacterDef[] = CHARACTERS.filter((c) => c.batch === 'C0' && c.implemented);

export function characterOf(id: string): CharacterDef {
  const c = CHARACTER_BY_ID[id];
  if (!c) throw new Error('未登记的角色：' + id);
  return c;
}
