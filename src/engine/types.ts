/**
 * 八男杀规则引擎 —— 基础类型。
 *
 * 本模块不依赖 React、DOM、WebSocket、SQLite；不读取系统时间；
 * 不直接调用 Math.random()。时间与随机都从运行器注入。
 */

export type Suit = '♠' | '♥' | '♣' | '♦';

/** 印在牌面上的三大类型 + 装备子类。 */
export type CardTypeText = '基本' | '锦囊' | '延时锦囊' | '武器' | '防具' | '坐骑';

/** 结构化大类。 */
export type CardCategory = 'basic' | 'trick' | 'delayedTrick' | 'equip';

/** 装备子栏。 */
export type EquipSlot = 'weapon' | 'armor' | 'offenseMount' | 'defenseMount';

export type Nature = 'normal' | 'fire' | 'thunder';

export type RoleId = 'lord' | 'loyalist' | 'rebel' | 'traitor';

export type PhaseId = 'prepare' | 'judge' | 'draw' | 'play' | 'discard' | 'end';

/** 稳定牌实例。cardId 不随洗牌、改点数、转移或记录为“星”而改变。 */
export interface CardInstance {
  /** 全局唯一 cardId（沿用配牌表编号，例如 "2-♥05"）。 */
  id: string;
  /** 属于第几副。 */
  deck: number;
  suit: Suit;
  /** 1..13，A=1 J=11 Q=12 K=13。这是印刷值，不因临时改点数而改变。 */
  rank: number;
  /** 印刷牌名。 */
  name: string;
  /** 印刷类型文字。 */
  type: CardTypeText;
}

/** 由于技能或转化造成的“当前牌面”，与印刷值分开。 */
export interface CardView {
  id: string;
  name: string;
  suit: Suit | null;
  rank: number | null;
  nature: Nature;
  virtual: boolean;
}

export interface EquipState {
  weapon: string | null;
  armor: string | null;
  offenseMount: string | null;
  defenseMount: string | null;
}

export interface PlayerState {
  seat: number;
  id: string;
  displayName: string;
  characterId: string;
  familyId: string;
  role: RoleId;
  roleRevealed: boolean;
  alive: boolean;
  /** 体力值，可为负数（例如安眠、楚神等状态下）。 */
  hp: number;
  maxHp: number;
  faceDown: boolean;
  chained: boolean;
  /** 防具区被废除（紫殇）。 */
  armorZoneAbolished: boolean;
  hand: string[];
  equip: EquipState;
  /** 判定区的延时锦囊，按置入顺序存放；结算按后置入先结算。 */
  judge: string[];
  /** 武将牌旁的“财”。 */
  cai: string[];
  /** 每回合重置的计数（杀次数、酒次数、弃置记录等）。 */
  turnFlags: Record<string, number | boolean>;
  /** 每轮重置的计数。 */
  roundFlags: Record<string, number | boolean>;
  /** 整局累计的技能记录。 */
  skillFlags: Record<string, number | boolean | string | string[]>;
  /** 当前生效的持续修正。 */
  modifiers: Modifier[];
  /** 电脑 / 真人。 */
  control: 'human' | 'bot';
}

export interface Modifier {
  id: string;
  source: string;
  kind: string;
  data: Record<string, unknown>;
  /** 到期时机；引擎在对应稳定点统一清理。 */
  expires: Expiry;
}

export type Expiry =
  | { when: 'turnEnd'; seat: number; turnSerial: number }
  | { when: 'roundEnd'; round: number }
  | { when: 'gameEnd' }
  | { when: 'manual' };

/** 全局事件记录；用于技能触发与日志，不用于对外发送。 */
export interface GameEvent {
  seq: number;
  type: string;
  parentSeq: number | null;
  useId: string | null;
  sourceSeat: number | null;
  targetSeats: number[];
  actorSeat: number | null;
  reason: string | null;
  amount: number | null;
  data: Record<string, unknown>;
}

export interface LogEntry {
  seq: number;
  /** 公共日志对所有人生效；私有日志只发给 ownerSeat。 */
  visibility: 'public' | 'private';
  ownerSeat: number | null;
  text: string;
  severity: 'info' | 'use' | 'damage' | 'life' | 'death' | 'system';
  turnSerial: number;
}

/** 本次用牌。 */
export interface CardUse {
  useId: string;
  /** 参与本次用牌的实体牌 id 列表；虚拟牌可能为空。 */
  cardIds: string[];
  /** 当前牌名（可能来自转化或视为使用）。 */
  name: string;
  category: CardCategory;
  suit: Suit | null;
  rank: number | null;
  /** 属性：普通 / 火 / 雷。 */
  nature: Nature;
  virtual: boolean;
  /** 使用者席位。 */
  userSeat: number;
  /** 原始声明目标。 */
  declaredTargets: number[];
  /** 仍然有效的目标。 */
  targets: number[];
  /** 是否禁止被响应（闪 / 无懈）。 */
  unrespondable: boolean;
  /** 是否禁止无懈可击。 */
  noNullify: boolean;
  /** 是否为“打出”而非“使用”。 */
  played: boolean;
  /** 对每个目标的伤害修正。 */
  damageBonus: Record<string, number>;
  /** 增加的目标数量等附加数据。 */
  extra: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* 结算栈                                                              */
/* ------------------------------------------------------------------ */

export type StepOutcome =
  | { t: 'next' }
  | { t: 'push'; frame: Frame }
  | { t: 'done'; result?: unknown }
  | { t: 'wait'; pending: Pending }
  | { t: 'replace'; frame: Frame };

/**
 * 结算帧。必须完全可序列化：不使用闭包、Promise 或类实例。
 */
export interface Frame {
  id: string;
  kind: string;
  /** 当前子步骤，由该 kind 的 driver 解释。 */
  step: string;
  data: Record<string, any>;
  /** 本帧结束（done）时，把结果写回父帧 data 的哪个键。 */
  returnKey?: string;
  /** 诊断用：创建时的简述。 */
  note?: string;
}

export type PendingKind = 'playPhase' | 'choice';

export interface Pending {
  promptId: string;
  revision: number;
  kind: PendingKind;
  actorSeat: number;
  /** 交互类型，供界面选择组件。 */
  type: string;
  title: string;
  detail: string;
  /** 允许的选项（手牌 / 技能 / 目标席位 / 通用选项）。 */
  options: OptionDescriptor;
  /** 是否可以放弃。 */
  cancelable: boolean;
  /** 界面显示用；权威时间由运行器负责。 */
  timeoutMs: number;
  /** 超时后由运行器提交的默认回答。 */
  defaultAnswer: unknown;
  /** 该提示属于哪个帧。 */
  frameId: string;
}

export interface OptionDescriptor {
  /** 可选的手牌 / 装备 / 区域牌。 */
  selectableCards: SelectableCard[];
  minCards: number;
  maxCards: number;
  /** 是否要求选择目标席位。 */
  targetSeats: number[] | null;
  minTargets: number;
  maxTargets: number;
  /** 可选择发动的技能。 */
  skills: SkillOption[];
  /** 通用枚举选项（例如“相同 / 不同”“失去体力 / 减上限”）。 */
  enumOptions: EnumOption[];
  /** 允许的虚拟牌名（转化用）。 */
  asNames: string[];
  /** 是否允许结束 / 通过。 */
  allowPass: boolean;
  passLabel: string;
}

export interface SelectableCard {
  cardId: string;
  /** 只对拥有者可见的牌面；对其他人为 null。 */
  name: string | null;
  suit: Suit | null;
  rank: number | null;
  from: 'hand' | 'equip' | 'judge' | 'cai' | 'special';
  slot?: EquipSlot;
  /** 用于展示的临时背面槽位（λ 混匀）。 */
  faceDownSlot?: number;
  label?: string;
}

export interface SkillOption {
  skillId: string;
  label: string;
  detail: string;
  enabled: boolean;
  disabledReason?: string;
}

export interface EnumOption {
  value: string;
  label: string;
  enabled: boolean;
  disabledReason?: string;
}

/* ------------------------------------------------------------------ */
/* 命令                                                                */
/* ------------------------------------------------------------------ */

export interface ActorContext {
  /** 由运行器注入；客户端不可信地自报 actor 无效。 */
  seat: number;
  playerId: string;
  /** 幂等标识。 */
  commandId: string;
}

export type Command =
  | { type: 'PLAY_CARD'; cardIds: string[]; as?: string; targets: number[] }
  | { type: 'ACTIVATE_SKILL'; skillId: string; choice?: Record<string, unknown> }
  | { type: 'RECAST'; cardIds: string[] }
  | { type: 'ANSWER_PROMPT'; promptId: string; promptRevision: number; answer: Answer }
  | { type: 'END_PLAY_PHASE' }
  | { type: 'SYSTEM_TIMEOUT'; promptId: string; promptRevision: number };

export interface Answer {
  cardIds?: string[];
  as?: string;
  targets?: number[];
  skills?: string[];
  enums?: string[];
  choice?: Record<string, unknown>;
  pass?: boolean;
}

export interface Transition {
  ok: boolean;
  error?: string;
  /** 本次转换产生的公共 / 私有日志增量。 */
  logs: LogEntry[];
}

/* ------------------------------------------------------------------ */
/* 确定性随机                                                          */
/* ------------------------------------------------------------------ */

export interface RngState {
  /** xoshiro128** 的四个 32 位种子。 */
  s: [number, number, number, number];
}

/* ------------------------------------------------------------------ */
/* 游戏状态                                                            */
/* ------------------------------------------------------------------ */

export interface TurnState {
  /** 从 1 开始，每绕原座次一圈 +1。 */
  round: number;
  /** 当前回合角色席位；若无存活角色则为 null。 */
  currentSeat: number | null;
  phase: PhaseId | null;
  /** 回合序号，用于到期判定。 */
  turnSerial: number;
  /** 座次锚点：本轮的起始座位。 */
  anchorSeat: number;
  /** 已跳过阶段的集合。 */
  skipped: PhaseId[];
  /** 每张牌 / 每个时点的触发记录，防止同一事件重复触发。 */
  fired: Record<string, true>;
}

export interface GameState {
  gameId: string;
  engineVersion: string;
  rulesVersion: string;
  contentVersion: string;
  seed: string;
  rng: RngState;

  playerCount: number;
  players: PlayerState[];
  /** 按座次排列的 playerId。 */
  seatOrder: string[];

  cards: Record<string, CardInstance>;
  deck: string[];
  discard: string[];
  processing: string[];

  /** 本局已注册的牌名集合（D18：诈骗声明范围）。 */
  enabledCardNames: string[];

  turn: TurnState;
  stack: Frame[];
  pending: Pending | null;

  log: LogEntry[];
  events: GameEvent[];
  /** 正在进行中的用牌。 */
  activeUses: Record<string, CardUse>;
  /** 待发送给各玩家的事件增量（按稳定点切割）。 */
  logCursor: number;

  useSeq: number;
  eventSeq: number;
  frameSeq: number;
  promptSeq: number;

  status: 'setup' | 'running' | 'finished' | 'techPause';
  /** 最近一次命令被拒绝的原因（仅运行器读取，不进入持久语义）。 */
  lastCommandError: string | null;
  /** 技术暂停诊断。 */
  techPause?: { frameKind: string; frameStep: string; steps: number; detail: string };
  winner: 'lord' | 'rebel' | 'traitor' | 'draw' | null;

  /** 每个稳定点的状态哈希，用于停滞检测。 */
  lastHashes: string[];
  /** 卡牌层引用（每次项目构建注入，不参与序列化断言）。 */
  version: number;

  /** 建局输入，与 replay 一起构成完整的复现凭据。 */
  setup: GameSetupRecord;
  /** 全部被接受的命令，含超时自动提交。用于确定性回放与复现比对。 */
  replay: ReplayEntry[];
}

/* ------------------------------------------------------------------ */
/* 复现凭据                                                            */
/* ------------------------------------------------------------------ */

/** 建局所需的全部输入。填齐后 createGame 的输出完全确定。 */
export interface GameSetupRecord {
  seed: string;
  playerCount: number;
  selfSeat: number;
  /** 按座位排列的 characterId。 */
  characters: string[];
  /**
   * 调用方显式指定的身份表。只有在建局时传了 roles 才会记录；
   * 回放必须原样传回，否则会走「随机分配身份」分支并多消耗一次随机数，
   * 导致后续洗牌序列错位。
   */
  rolesInput?: RoleId[];
  /** 已解析的身份表（主公位置已固定）。仅供人工诊断，不参与回放。 */
  roles: RoleId[];
  riggedHands?: Record<number, string[]>;
  displayNames?: Record<number, string>;
}

/** 一条被接受的命令。 */
export interface ReplayEntry {
  /** 命令序号，从 0 开始。 */
  i: number;
  /** 提交时的轮次与阶段，便于人工阅读。 */
  round: number;
  phase: PhaseId | null;
  seat: number;
  command: Command;
  /** 该命令是否由倒计时超时自动提交。 */
  timeout: boolean;
}


/* ------------------------------------------------------------------ */
/* 对外视图                                                            */
/* ------------------------------------------------------------------ */

export interface PlayerView {
  gameId: string;
  playerCount: number;
  status: GameState['status'];
  /** 自己的座位。 */
  selfSeat: number;
  turn: {
    round: number;
    currentSeat: number | null;
    phase: PhaseId | null;
  };
  players: PlayerViewItem[];
  /** 自己的手牌（完整牌面）。 */
  hand: CardView[];
  /** 自己装备区的牌。 */
  equip: Partial<Record<EquipSlot, CardView>>;
  /** 自己判定区的牌。 */
  judge: CardView[];
  /** 自己的“财”。 */
  cai: CardView[];
  /** 公共弃牌堆顶部若干张。 */
  discardTop: CardView[];
  pending: Pending | null;
  /** 当前可选动作描述。 */
  actions: ActionDescriptor[];
  log: LogEntry[];
  winner: GameState['winner'];
  /** 自己已确认的身份（别人只有主公或死亡后公开）。 */
  knownRoles: Record<number, RoleId>;
  version: number;
}

export interface PlayerViewItem {
  seat: number;
  id: string;
  displayName: string;
  characterId: string;
  characterName: string;
  alive: boolean;
  hp: number;
  maxHp: number;
  handCount: number;
  faceDown: boolean;
  chained: boolean;
  armorZoneAbolished: boolean;
  /** 公开的装备牌名。 */
  equip: Partial<Record<EquipSlot, { name: string; suit: Suit; rank: number; virtual?: boolean }>>;
  judgeCount: number;
  judgeNames: string[];
  caiCount: number;
  role: RoleId | null;
  isSelf: boolean;
  control: 'human' | 'bot';
  /** 公开的技能列表。 */
  skills: { skillId: string; name: string }[];
  /** 公开标记。 */
  marks: { key: string; label: string; value: string }[];
}

export interface ActionDescriptor {
  id: string;
  kind: 'useCard' | 'activateSkill' | 'endPhase' | 'pass' | 'answer' | 'recast';
  label: string;
  /** 需要哪些实体牌（为空表示虚拟牌或纯技能）。 */
  cardIds: string[];
  /** 使用时的虚拟牌名。 */
  asName?: string;
  skillId?: string;
  /** 目标要求；null 表示不需要目标。 */
  targetSpec: { min: number; max: number; legal: number[] } | null;
  /** 是否可以取消。 */
  cancelable: boolean;
  /** 为什么这个动作需要额外选择。 */
  note?: string;
  /** 需要附加枚举选项时给出。 */
  enumOptions?: EnumOption[];
  detail?: string;
}
