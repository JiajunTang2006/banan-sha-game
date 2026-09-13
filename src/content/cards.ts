import type { CardCategory, CardTypeText, EquipSlot, Nature } from '@engine/types';

/** 牌面定义：与配牌表的印刷值对应，是“本局已启用实体牌定义集合”的来源。 */
export interface CardDef {
  name: string;
  category: CardCategory;
  typeText: CardTypeText;
  slot?: EquipSlot;
  /** 武器攻击范围。 */
  range?: number;
  nature: Nature;
  desc: string;
  /** 是否可重铸。 */
  recastable?: boolean;
}

const D = (d: CardDef) => d;

export const CARD_DEFS: CardDef[] = [
  /* ---------------- 基本牌 ---------------- */
  D({ name: '普通杀', category: 'basic', typeText: '基本', nature: 'normal', desc: '出牌阶段对攻击范围内一名其他角色使用；目标须使用 1 张【闪】，否则受到 1 点普通伤害。每阶段限一次。' }),
  D({ name: '火杀', category: 'basic', typeText: '基本', nature: 'fire', desc: '同【普通杀】，造成火焰伤害。' }),
  D({ name: '雷杀', category: 'basic', typeText: '基本', nature: 'thunder', desc: '同【普通杀】，造成雷电伤害。' }),
  D({ name: '闪', category: 'basic', typeText: '基本', nature: 'normal', desc: '在需要时响应【杀】或【万箭齐发】；不能主动使用。' }),
  D({ name: '桃', category: 'basic', typeText: '基本', nature: 'normal', desc: '出牌阶段对受伤的自己使用，或求救时对濒死者使用，回复 1 点体力。' }),
  D({ name: '酒', category: 'basic', typeText: '基本', nature: 'normal', desc: '出牌阶段对自己使用，本回合下一张【杀】对每个目标的首个伤害 +1；每阶段限一次。濒死时仅可自救回复 1 点。' }),

  /* ---------------- 单体锦囊 ---------------- */
  D({ name: '决斗', category: 'trick', typeText: '锦囊', nature: 'normal', desc: '指定一名其他角色，自目标起双方轮流打出【杀】，先不打出者受到对方造成的 1 点普通伤害。' }),
  D({ name: '无中生有', category: 'trick', typeText: '锦囊', nature: 'normal', desc: '以自己为唯一目标，摸 2 张牌。' }),
  D({ name: '顺手牵羊', category: 'trick', typeText: '锦囊', nature: 'normal', desc: '选择距离为 1 且有牌的其他角色，获得其区域内 1 张牌。' }),
  D({ name: '过河拆桥', category: 'trick', typeText: '锦囊', nature: 'normal', desc: '选择有牌的其他角色，弃置其区域内 1 张牌。' }),

  /* ---------------- 群体锦囊 ---------------- */
  D({ name: '南蛮入侵', category: 'trick', typeText: '锦囊', nature: 'normal', desc: '所有其他角色逐一打出【杀】，否则受到你造成的 1 点普通伤害。' }),
  D({ name: '万箭齐发', category: 'trick', typeText: '锦囊', nature: 'normal', desc: '所有其他角色逐一使用【闪】，否则受到你造成的 1 点普通伤害。' }),

  /* ---------------- 无懈可击 ---------------- */
  D({ name: '无懈可击', category: 'trick', typeText: '锦囊', nature: 'normal', desc: '一张锦囊对一个目标生效前，令其对该目标无效；可被另一张【无懈可击】反制。' }),

  /* ---------------- 铁索连环 ---------------- */
  D({ name: '铁索连环', category: 'trick', typeText: '锦囊', nature: 'normal', desc: '指定 1—2 名角色，分别切换其横置状态；也可不选目标直接重铸。', recastable: true }),

  /* ---------------- 延时锦囊 ---------------- */
  D({ name: '乐不思蜀', category: 'delayedTrick', typeText: '延时锦囊', nature: 'normal', desc: '置于一名其他角色判定区。其判定阶段判定：非红桃则跳过该回合出牌阶段。' }),

  /* ---------------- 武器 ---------------- */
  D({ name: '寒冰剑', category: 'equip', typeText: '武器', slot: 'weapon', range: 2, nature: 'normal', desc: '范围 2。你的【杀】将对目标造成伤害时，可防止此伤害，改为依次弃置其至多两张牌。' }),
  D({ name: '方天画戟', category: 'equip', typeText: '武器', slot: 'weapon', range: 4, nature: 'normal', desc: '范围 4。你使用的【杀】若消耗了你当时全部手牌（至少 1 张），可额外指定至多 2 名攻击范围内的其他角色。' }),
  D({ name: '诸葛连弩', category: 'equip', typeText: '武器', slot: 'weapon', range: 1, nature: 'normal', desc: '范围 1。你使用【杀】无次数限制。' }),
  D({ name: '长刀', category: 'equip', typeText: '武器', slot: 'weapon', range: 3, nature: 'normal', desc: '范围 3。无附加效果。' }),

  /* ---------------- 防具 ---------------- */
  D({ name: '八卦阵', category: 'equip', typeText: '防具', slot: 'armor', nature: 'normal', desc: '每当你需要使用【闪】时，可判定一次；红色视为使用 1 张【闪】。' }),
  D({ name: '藤甲', category: 'equip', typeText: '防具', slot: 'armor', nature: 'normal', desc: '普通【杀】【南蛮入侵】【万箭齐发】对你无效；你受到火焰伤害时伤害 +1。' }),

  /* ---------------- 坐骑 ---------------- */
  D({ name: '进攻坐骑', category: 'equip', typeText: '坐骑', slot: 'offenseMount', nature: 'normal', desc: '你计算与其他角色的距离 −1。' }),
  D({ name: '防御坐骑', category: 'equip', typeText: '坐骑', slot: 'defenseMount', nature: 'normal', desc: '其他角色计算与你的距离 +1。' }),

  /* ---------------- 专属备牌（首发 8 将不使用，登记以便 D18 与后续批次） ---------------- */
  D({ name: '君临天下', category: 'trick', typeText: '锦囊', nature: 'normal', desc: '指定所有其他角色，目标弃置 1 张手牌或装备，否则受到 1 点普通伤害。仅【神谕】洗入牌堆。' }),
  D({ name: '助听器', category: 'equip', typeText: '防具', slot: 'armor', nature: 'normal', desc: '唯一。防止你受到的火焰与雷电伤害；离开你的装备区时你失去 1 点体力。' }),
  D({ name: '戟把', category: 'equip', typeText: '武器', slot: 'weapon', range: 18, nature: 'normal', desc: '唯一，范围 18。你使用【杀】指定唯一目标后，可获得其装备区内的武器牌。' }),
];

export const CARD_DEF_BY_NAME: Record<string, CardDef> = Object.fromEntries(
  CARD_DEFS.map((d) => [d.name, d]),
);

export function cardDef(name: string): CardDef {
  const d = CARD_DEF_BY_NAME[name];
  if (!d) throw new Error('未登记的牌名：' + name);
  return d;
}

/** 三大类型（用于【化合】声明）。 */
export const BIG_TYPES = ['基本牌', '锦囊牌', '装备牌'] as const;

export function bigTypeOf(category: CardCategory): (typeof BIG_TYPES)[number] {
  if (category === 'basic') return '基本牌';
  if (category === 'trick' || category === 'delayedTrick') return '锦囊牌';
  return '装备牌';
}

/** 所有可能的杀牌名。 */
export const SHA_NAMES = ['普通杀', '火杀', '雷杀'];

export function isSha(name: string): boolean {
  return SHA_NAMES.includes(name);
}

export function natureOfSha(name: string): Nature {
  if (name === '火杀') return 'fire';
  if (name === '雷杀') return 'thunder';
  return 'normal';
}
