import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CARD_DEFS } from '@content/cards';
import { isMassCard } from '@engine/play';
import { CHARACTERS, DEMO_POOL, characterOf } from '@content/characters';
import { completeDraft, createGame, initDraft, type DraftState } from '@engine/setup';
import type { ActionDescriptor, CardView, Command, PlayerView, PlayerViewItem, Pending, RoleId, Suit } from '@engine/types';
import { createClient, type GameClient } from './client';
import { promptSubmitState, toggleTarget } from './promptRules';
import { clearGame, downloadText, loadGame, saveGame } from './storage';
import './styles.css';

const ROLE_LABEL: Record<RoleId, string> = { lord: '主公', loyalist: '忠臣', rebel: '反贼', traitor: '内奸' };
const PHASE_LABEL: Record<string, string> = {
  prepare: '准备',
  judge: '判定',
  draw: '摸牌',
  play: '出牌',
  discard: '弃牌',
  end: '结束',
};
const PHASES = ['prepare', 'judge', 'draw', 'play', 'discard', 'end'];
const WIN_TEXT: Record<string, string> = {
  lord: '主公 · 忠臣 获胜',
  rebel: '反贼 获胜',
  traitor: '内奸 获胜',
  draw: '平局',
};

type Screen = 'start' | 'draft' | 'game';
type Toast = { text: string; key: number } | null;

export default function App() {
  const [screen, setScreen] = useState<Screen>('start');
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [view, setView] = useState<PlayerView | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [hasSave, setHasSave] = useState(false);
  const [timerOn, setTimerOn] = useState(true);
  const [showRules, setShowRules] = useState(false);
  const [result, setResult] = useState<{ winner: string; selfWin: boolean; seconds: number; rounds: number } | null>(null);
  const [clientKind, setClientKind] = useState<string>('');

  const clientRef = useRef<GameClient | null>(null);
  const startedAt = useRef<number>(Date.now());

  const flash = useCallback((text: string) => setToast({ text, key: Date.now() }), []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    loadGame('auto').then((r) => setHasSave(Boolean(r && r.meta.turnSerial >= 0 && r.stateJson)));
  }, []);

  /** 建立客户端并载入一份状态。 */
  const boot = useCallback(
    async (stateJson: string, selfSeat: number) => {
      const c = await createClient();
      clientRef.current = c;
      setClientKind(c.kind === 'worker' ? 'Web Worker 裁判' : '主线程裁判（Worker 不可用）');
      c.subscribe(() => setView(c.view() ? { ...c.view()! } : null));
      await c.load(stateJson, selfSeat);
      setView(c.view() ? { ...c.view()! } : null);
    },
    [],
  );

  const persist = useCallback(async () => {
    const c = clientRef.current;
    if (!c || !view) return;
    const snap = await c.snapshot();
    if (!snap) return;
    const me = view.players[view.selfSeat];
    await saveGame({
      meta: {
        slot: 'auto',
        savedAt: new Date().toISOString(),
        selfSeat: view.selfSeat,
        characterName: me?.characterName ?? '',
        playerCount: view.playerCount,
        round: view.turn.round,
        turnSerial: 0,
        engineVersion: '0.1.0',
        rulesVersion: 'v0.9.1',
        contentVersion: 'c0-8chars-104cards',
      },
      stateJson: snap,
    });
    setHasSave(true);
  }, [view]);

  /* ------------------------- 开局流程 ------------------------- */

  const startNew = useCallback(() => {
    const seed = `seed-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
    const d = initDraft(seed, 5, 0);
    setDraft(d);
    setPicked(null);
    setScreen('draft');
  }, []);

  const openDraft = useCallback(async () => {
    if (!draft || !picked) return;
    const chars = completeDraft(draft, picked);
    const { state } = createGame({ seed: draft.seed, playerCount: draft.playerCount, selfSeat: draft.selfSeat, characters: chars });
    const { serialize } = await import('@engine/engine');
    startedAt.current = Date.now();
    setResult(null);
    await boot(serialize(state), draft.selfSeat);
    setScreen('game');
    void persist();
  }, [draft, picked, boot, persist]);

  const continueGame = useCallback(async () => {
    const rec = await loadGame('auto');
    if (!rec) {
      flash('没有找到可继续的存档。');
      return;
    }
    try {
      startedAt.current = Date.now();
      setResult(null);
      await boot(rec.stateJson, rec.meta.selfSeat);
      setScreen('game');
    } catch {
      flash('存档无法恢复，可能来自不同版本。');
    }
  }, [boot, flash]);

  /* ------------------------- 命令 ------------------------- */

  const send = useCallback(
    async (cmd: Command) => {
      const c = clientRef.current;
      if (!c) return;
      const r = await c.send(cmd);
      if (!r.ok && r.error) flash(r.error);
      const v = c.view();
      if (v) setView({ ...v });
      void persist();
    },
    [flash, persist],
  );

  /* ------------------------- 结算检测 ------------------------- */

  useEffect(() => {
    if (screen !== 'game' || !view) return;
    if (view.status === 'finished' && view.winner && !result) {
      const camp = view.winner;
      const myRole = view.knownRoles[view.selfSeat];
      const selfWin =
        (camp === 'lord' && (myRole === 'lord' || myRole === 'loyalist')) ||
        (camp === 'rebel' && myRole === 'rebel') ||
        (camp === 'traitor' && myRole === 'traitor');
      setResult({
        winner: camp,
        selfWin,
        seconds: Math.round((Date.now() - startedAt.current) / 1000),
        rounds: view.turn.round,
      });
    }
    if (view.status === 'techPause') {
      flash('对局进入技术暂停：' + (view.log.slice(-1)[0]?.text ?? ''));
    }
  }, [screen, view, result, flash]);

  /* ------------------------- 渲染 ------------------------- */

  if (screen === 'start') {
    return (
      <div className="app">
        <StartScreen
          hasSave={hasSave}
          onNew={startNew}
          onContinue={continueGame}
          onRules={() => setShowRules(true)}
        />
        {showRules && <RulesModal onClose={() => setShowRules(false)} />}
      </div>
    );
  }

  if (screen === 'draft' && draft) {
    return (
      <div className="app">
        <DraftScreen draft={draft} picked={picked} onPick={setPicked} onConfirm={openDraft} onBack={() => setScreen('start')} />
      </div>
    );
  }

  return (
    <div className="app">
      {view && (
        <GameTable
          view={view}
          clientKind={clientKind}
          timerOn={timerOn}
          onToggleTimer={() => setTimerOn((v) => !v)}
          send={send}
          onExit={() => {
            setScreen('start');
            void loadGame('auto').then((r) => setHasSave(Boolean(r)));
          }}
          onExport={async () => {
            const c = clientRef.current;
            const snap = await c?.snapshot();
            if (!snap) {
              flash('当前没有可导出的对局状态。');
              return;
            }
            // 复现文件只在导出时用到，做成动态导入，避免把完整引擎塞进主包。
            const { deserialize, exportReplay } = await import('@engine/engine');
            const file = exportReplay(deserialize(snap));
            downloadText(`八男杀-复现-${file.gameId}-v${file.finalVersion}.json`, JSON.stringify(file, null, 2));
            flash(`已导出复现文件：${file.gameId}，共 ${file.commandCount} 条命令。`);
          }}
          onAbandon={async () => {
            await clearGame('auto');
            setHasSave(false);
            setScreen('start');
            flash('已删除本地存档。');
          }}
          flash={flash}
        />
      )}
      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
      {result && (
        <ResultModal
          result={result}
          view={view}
          onAgain={startNew}
          onClose={() => setResult(null)}
          onNewGame={startNew}
        />
      )}
      {toast && <div className="toast">{toast.text}</div>}
    </div>
  );
}

/* ================================================================== */
/* 开始页                                                              */
/* ================================================================== */

function StartScreen(props: { hasSave: boolean; onNew: () => void; onContinue: () => void; onRules: () => void }) {
  return (
    <div className="start">
      <div className="start-inner">
        <h1 className="title">八男杀</h1>
        <div className="subtitle">网页试玩 Demo · 第一阶段 · 规则由程序裁定</div>
        <div className="start-seal">八男</div>
        <div className="start-actions">
          <button className="btn primary" onClick={props.onNew}>
            新游戏（1 人对 4 名电脑）
          </button>
          <button className="btn" disabled={!props.hasSave} onClick={props.onContinue}>
            继续上一局
          </button>
          <button className="btn ghost" onClick={props.onRules}>
            规则图鉴
          </button>
        </div>
        <div className="panel">
          <h3>当前启用角色池（8 名首发，实际 {DEMO_POOL.length}）</h3>
          <div className="pool">
            {DEMO_POOL.map((c) => (
              <div className="pool-item" key={c.characterId}>
                <b>{c.name}</b> <span className="muted small">{c.hp}/{c.maxHp}</span>
                <div className="skills">{c.skills.map((s) => s.name).join(' · ')}</div>
              </div>
            ))}
          </div>
          <p className="small muted" style={{ marginTop: 12, marginBottom: 0 }}>
            其余 32 张角色版本卡尚未实现，在选择池中不可见也不可选用。基础牌使用完整 104 张配牌表，
            含装备、延时锦囊、无懈链与属性传导。对局状态每隔一次操作写入本地存档。
          </p>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/* 选将页                                                              */
/* ================================================================== */

function DraftScreen(props: {
  draft: DraftState;
  picked: string | null;
  onPick: (id: string) => void;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const { draft, picked } = props;
  const options = draft.offer?.options ?? [];
  const lordIsMe = draft.lordSeat === draft.selfSeat;
  return (
    <div className="draft">
      <div style={{ textAlign: 'center' }}>
        <h2 style={{ margin: '0 0 4px', color: 'var(--gold-2)', letterSpacing: 3 }}>选择你的角色</h2>
        <div className="muted small">
          座次已随机分配；{lordIsMe ? '你是主公，' : '主公由其他玩家先选，'}同一本体的标 / 界 / 谋 / SP / 神版本全局至多出现一种。
        </div>
      </div>
      <div className="draft-cards">
        {options.map((id) => {
          const c = characterOf(id);
          return (
            <div key={id} className={`char-card${picked === id ? ' selected' : ''}`} onClick={() => props.onPick(id)}>
              <h4>{c.name}</h4>
              <div className="meta">
                {c.title} · 体力 {c.hp}/{c.maxHp}
                {lordIsMe ? ' · 主公 +1' : ''}
              </div>
              {c.skills.map((s) => (
                <div className="skill" key={s.skillId}>
                  <b>【{s.name}】</b>
                  <p>{s.text}</p>
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn ghost" onClick={props.onBack}>
          返回
        </button>
        <button className="btn primary" disabled={!picked} onClick={props.onConfirm}>
          确认选将并开始
        </button>
      </div>
    </div>
  );
}

/* ================================================================== */
/* 游戏桌面                                                            */
/* ================================================================== */

function GameTable(props: {
  view: PlayerView;
  clientKind: string;
  timerOn: boolean;
  onToggleTimer: () => void;
  send: (cmd: Command) => void;
  onExit: () => void;
  onExport: () => void;
  onAbandon: () => void;
  flash: (t: string) => void;
}) {
  const { view, send } = props;
  const [selected, setSelected] = useState<string[]>([]);
  const [active, setActive] = useState<ActionDescriptor | null>(null);
  const [targets, setTargets] = useState<number[]>([]);

  const pending = view.pending;
  const isMyPlay = pending?.kind === 'playPhase';
  const others = useMemo(() => {
    const arr: PlayerViewItem[] = [];
    for (let i = 1; i < view.playerCount; i++) {
      const seat = (view.selfSeat + i) % view.playerCount;
      const p = view.players.find((x) => x.seat === seat);
      if (p) arr.push(p);
    }
    return arr;
  }, [view]);

  const me = view.players[view.selfSeat];

  // 视图变化时清空选择
  useEffect(() => {
    setSelected([]);
    setActive(null);
    setTargets([]);
  }, [pending?.promptId, pending?.revision, view.version]);

  const filtered = useMemo(() => {
    if (!isMyPlay) return [];
    const acts = view.actions.filter((a) => a.kind !== 'endPhase');
    if (selected.length === 0) return acts.filter((a) => a.cardIds.length === 0);
    const set = new Set(selected);
    return acts.filter((a) => a.cardIds.length > 0 && a.cardIds.length === set.size && a.cardIds.every((id) => set.has(id)));
  }, [view.actions, selected, isMyPlay]);

  const toggleCard = (id: string) => {
    setActive(null);
    setTargets([]);
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const chooseAction = (a: ActionDescriptor) => {
    if (a.note) {
      props.flash(a.note);
      return;
    }
    const spec = a.targetSpec;
    if (!spec || spec.legal.length === 0) {
      if (a.kind === 'activateSkill') send({ type: 'ACTIVATE_SKILL', skillId: a.skillId!, choice: choiceFor(a) });
      else if (a.kind === 'recast') send({ type: 'RECAST', cardIds: a.cardIds });
      else send({ type: 'PLAY_CARD', cardIds: a.cardIds, as: a.asName, targets: [] });
      resetSel();
      return;
    }
    const autoAll = a.asName && isMassCard(a.asName);
    setActive(a);
    setTargets(autoAll ? spec.legal.slice(0, spec.max) : []);
  };

  const resetSel = () => {
    setSelected([]);
    setActive(null);
    setTargets([]);
  };

  const confirmAction = () => {
    if (!active) return;
    if (active.kind === 'activateSkill') {
      // 技能必须走技能入口，不能当成普通出牌。
      // 例如【气体】需要在技能帧里记账「本阶段已发动」并把两张手牌作为转化素材。
      send({ type: 'ACTIVATE_SKILL', skillId: active.skillId!, choice: choiceFor(active) });
    } else {
      send({ type: 'PLAY_CARD', cardIds: active.cardIds, as: active.asName, targets });
    }
    resetSel();
  };

  const canConfirm = active?.targetSpec ? targets.length >= active.targetSpec.min && targets.length <= active.targetSpec.max : false;

  return (
    <div className="table">
      <div className="table-main">
        <div className="table-top">
          {others.map((p) => (
            <SeatCard
              key={p.seat}
              p={p}
              current={view.turn.currentSeat === p.seat}
              targetable={Boolean(active?.targetSpec?.legal.includes(p.seat))}
              chosen={targets.includes(p.seat)}
              onToggle={() => {
                if (!active?.targetSpec) return;
                setTargets((prev) => {
                  if (prev.includes(p.seat)) return prev.filter((x) => x !== p.seat);
                  if (prev.length >= active.targetSpec!.max) return prev;
                  return [...prev, p.seat];
                });
              }}
            />
          ))}
        </div>

        <div className="table-center">
          <span>
            第 <b style={{ color: 'var(--gold-2)' }}>{view.turn.round}</b> 轮
          </span>
          <span>当前：{view.players.find((x) => x.seat === view.turn.currentSeat)?.displayName ?? '—'}</span>
          <div className="phase-strip">
            {PHASES.map((ph) => (
              <span key={ph} className={`phase${view.turn.phase === ph ? ' on' : ''}`}>
                {PHASE_LABEL[ph]}
              </span>
            ))}
          </div>
          <span className="muted small">
            {view.discardTop.length > 0
              ? `弃牌堆顶：${view.discardTop.slice(0, 3).map((c) => c.name).join('、')}${
                  view.discardTop.length > 3 ? ` 等 ${view.discardTop.length} 张` : ''
                }`
              : '弃牌堆为空'}
          </span>
        </div>

        <div className="table-bottom">
          {me && (
            <SelfBar p={me} current={view.turn.currentSeat === view.selfSeat} phase={view.turn.phase} />
          )}
          <div className="hand">
            {view.hand.map((c) => {
              const usable = isMyPlay && filtered.some((a) => a.cardIds.length === 1 && a.cardIds[0] === c.id);
              return (
                <HandCard
                  key={c.id}
                  c={c}
                  selected={selected.includes(c.id)}
                  selectable={isMyPlay}
                  dim={isMyPlay && selected.length === 0 && !usable}
                  badge={selected.indexOf(c.id) >= 0 ? selected.indexOf(c.id) + 1 : undefined}
                  onClick={() => isMyPlay && toggleCard(c.id)}
                />
              );
            })}
            {view.hand.length === 0 && <span className="muted small">手牌已空</span>}
          </div>

          <div className="actions">
            {isMyPlay ? (
              <>
                {filtered.map((a) => (
                  <button
                    key={a.id}
                    className={`btn sm${a.note ? '' : active?.id === a.id ? ' primary' : ''}`}
                    title={a.note ?? a.detail ?? ''}
                    disabled={Boolean(a.note)}
                    onClick={() => chooseAction(a)}
                  >
                    {a.label}
                  </button>
                ))}
                {active?.targetSpec && (
                  <>
                    <span className="muted small">
                      选择目标 {targets.length}/{active.targetSpec.max}
                      （至少 {active.targetSpec.min}）
                    </span>
                    <button className="btn sm primary" disabled={!canConfirm} onClick={confirmAction}>
                      确认使用
                    </button>
                    <button className="btn sm ghost" onClick={resetSel}>
                      取消
                    </button>
                  </>
                )}
                {selected.length === 0 && filtered.length === 0 && <span className="muted small">选择手牌或发动技能</span>}
                <button className="btn sm ghost" style={{ marginLeft: 'auto' }} onClick={() => send({ type: 'END_PLAY_PHASE' })}>
                  结束出牌阶段
                </button>
              </>
            ) : (
              <span className="muted small">
                {view.status === 'finished' ? '对局已结束' : `等待 ${view.players.find((x) => x.seat === view.turn.currentSeat)?.displayName ?? '其他玩家'} 操作…`}
              </span>
            )}
          </div>
        </div>

        {pending && pending.kind === 'choice' && (
          <PromptModal pending={pending} view={view} send={send} timerOn={props.timerOn} flash={props.flash} />
        )}
      </div>

      <div className="side">
        <div className="side-head">战斗记录</div>
        <div className="log" ref={(el) => el && (el.scrollTop = el.scrollHeight)}>
          {view.log.map((l) => (
            <div className={`line ${l.severity}`} key={l.seq}>
              {l.text}
            </div>
          ))}
        </div>
        <div className="side-foot">
          <span className="tag gold">{props.clientKind}</span>
          <button className="btn sm ghost" onClick={props.onToggleTimer}>
            倒计时：{props.timerOn ? '开' : '关'}
          </button>
          <button className="btn sm ghost" onClick={props.onExport}>
            导出复现
          </button>
          <button className="btn sm ghost" onClick={props.onExit}>
            返回开始页
          </button>
          <button className="btn sm danger" onClick={props.onAbandon}>
            放弃本局
          </button>
        </div>
      </div>
    </div>
  );
}

function choiceFor(a: ActionDescriptor): Record<string, unknown> {
  if (a.skillId === 'b08.qiti') return { cardIds: a.cardIds };
  return {};
}

function SelfBar({ p, current, phase }: { p: PlayerViewItem; current: boolean; phase: string | null }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <span style={{ color: 'var(--gold-2)', fontWeight: 600 }}>
        {p.displayName} · {p.characterName}
      </span>
      <HpPips hp={p.hp} maxHp={p.maxHp} />
      <span className="muted small">手牌 {p.handCount}</span>
      {p.role && <span className="tag gold">{ROLE_LABEL[p.role]}</span>}
      {current && phase && <span className="tag red">我的{PHASE_LABEL[phase] ?? ''}阶段</span>}
      <span className="skill-bar">
        {p.skills.map((s) => (
          <span className="skill-chip" key={s.skillId}>
            {s.name}
          </span>
        ))}
      </span>
      {p.marks.map((m) => (
        <span className="tag" key={m.key}>
          {m.label} {m.value}
        </span>
      ))}
    </div>
  );
}

function HpPips({ hp, maxHp }: { hp: number; maxHp: number }) {
  const total = Math.max(maxHp, hp, 1);
  const pips = [];
  for (let i = 0; i < total; i++) {
    const on = i < hp;
    pips.push(<span key={i} className={`hp-pip${on ? (i >= maxHp ? ' over' : ' on') : ''}`} />);
  }
  return (
    <span className="hp" title={`体力 ${hp}/${maxHp}`}>
      {pips}
    </span>
  );
}

function SeatCard(props: {
  p: PlayerViewItem;
  current: boolean;
  targetable: boolean;
  chosen: boolean;
  onToggle: () => void;
}) {
  const { p } = props;
  const cls = [
    'seat',
    props.current ? 'current' : '',
    p.alive ? '' : 'dead',
    props.targetable ? 'targetable' : '',
    props.chosen ? 'chosen' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cls} onClick={props.onToggle}>
      <div className="seat-head">
        <span className="seat-name">
          <span className="seat-char">{p.characterName}</span> {p.displayName}
        </span>
        {p.role ? <span className="tag gold">{ROLE_LABEL[p.role]}</span> : <span className="tag">身份未公开</span>}
      </div>
      <HpPips hp={p.hp} maxHp={p.maxHp} />
      <div className="seat-row">
        <span className="equip-chip">手 {p.handCount}</span>
        {Object.entries(p.equip).map(([slot, e]) => (
          <span key={slot} className={`equip-chip ${slot === 'armor' ? 'armor' : slot === 'weapon' ? 'weapon' : ''}`}>
            {e!.name}
          </span>
        ))}
        {p.judgeNames.map((n, i) => (
          <span className="equip-chip" key={`j${i}`} style={{ borderColor: '#7a5a2a', color: '#dcb96c' }}>
            {n}
          </span>
        ))}
        {p.caiCount > 0 && <span className="equip-chip">财 {p.caiCount}</span>}
      </div>
      <div className="seat-row">
        {p.marks.map((m) => (
          <span className="tag" key={m.key}>
            {m.label}
            {m.value !== '●' ? ` ${m.value}` : ''}
          </span>
        ))}
        {!p.alive && <span className="tag red">已死亡</span>}
        {p.chained && <span className="tag red">横置</span>}
        {p.faceDown && <span className="tag">背面</span>}
      </div>
    </div>
  );
}

function HandCard(props: {
  c: CardView;
  selected: boolean;
  selectable: boolean;
  dim: boolean;
  badge?: number;
  onClick: () => void;
}) {
  const { c } = props;
  const red = c.suit === '♥' || c.suit === '♦';
  const cls = [
    'card',
    red ? 'red' : '',
    props.selectable ? 'selectable' : '',
    props.selected ? 'selected' : '',
    props.dim ? 'disabled' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div
      className={cls}
      onClick={props.onClick}
    >
      {props.badge && <span className="badge">{props.badge}</span>}
      <div className="corner">
        <span>{c.suit}</span>
        <span>{rankText(c.rank)}</span>
      </div>
      <div className="cname">{c.name}</div>
      <div className="corner" style={{ alignSelf: 'flex-end', transform: 'rotate(180deg)' }}>
        <span>{c.suit}</span>
        <span>{rankText(c.rank)}</span>
      </div>
    </div>
  );
}

function rankText(r: number | null): string {
  if (r === null) return '';
  if (r === 1) return 'A';
  if (r === 11) return 'J';
  if (r === 12) return 'Q';
  if (r === 13) return 'K';
  return String(r);
}

/* ================================================================== */
/* 响应 / 选择弹层                                                     */
/* ================================================================== */

function useCountdown(pending: Pending | null, enabled: boolean, onExpire: () => void) {
  const [remain, setRemain] = useState(0);
  const key = pending ? `${pending.promptId}:${pending.revision}` : '';
  const fired = useRef('');
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    if (!pending || !enabled) {
      setRemain(0);
      return;
    }
    const deadline = Date.now() + pending.timeoutMs;
    setRemain(pending.timeoutMs);
    const t = setInterval(() => {
      const left = deadline - Date.now();
      setRemain(Math.max(0, left));
      if (left <= 0 && fired.current !== key) {
        fired.current = key;
        clearInterval(t);
        onExpireRef.current();
      }
    }, 200);
    return () => clearInterval(t);
  }, [key, enabled, pending?.timeoutMs]); // eslint-disable-line react-hooks/exhaustive-deps

  return pending && enabled ? { remain, total: pending.timeoutMs } : null;
}

function PromptModal(props: {
  pending: Pending;
  view: PlayerView;
  send: (cmd: Command) => void;
  timerOn: boolean;
  flash: (t: string) => void;
}) {
  const { pending, view, send } = props;
  const [sel, setSel] = useState<string[]>([]);
  const [tgs, setTgs] = useState<number[]>([]);

  useEffect(() => {
    setSel([]);
    setTgs([]);
  }, [pending.promptId, pending.revision]);

  const expire = useCallback(() => {
    send({ type: 'SYSTEM_TIMEOUT', promptId: pending.promptId, promptRevision: pending.revision });
  }, [pending.promptId, pending.revision, send]);

  const cd = useCountdown(pending, props.timerOn, expire);

  const opts = pending.options;
  const toggle = (id: string) => {
    setSel((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= opts.maxCards) return opts.maxCards === 1 ? [id] : prev;
      return [...prev, id];
    });
  };

  const submit = (pass: boolean) => {
    send({
      type: 'ANSWER_PROMPT',
      promptId: pending.promptId,
      promptRevision: pending.revision,
      answer: {
        cardIds: pass ? [] : sel,
        targets: tgs,
        pass,
      },
    });
  };

  // 提交入口的判定抽到 promptRules，便于逐条锁死（曾两次因为漏看 targets 而无法提交）。
  const { needConfirm, canConfirm, hint } = promptSubmitState(opts, sel.length, tgs.length);

  return (
    <div className="overlay">
      <div className="modal">
        <h3>{pending.title}</h3>
        <div className="detail">{pending.detail}</div>

        {opts.selectableCards.length > 0 && (
          <div className="hand" style={{ minHeight: 0 }}>
            {opts.selectableCards.map((c) => (
              <SelectableCardView key={c.cardId} c={c} selected={sel.includes(c.cardId)} onClick={() => toggle(c.cardId)} />
            ))}
          </div>
        )}

        {opts.targetSeats && opts.targetSeats.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
            {opts.targetSeats.map((s) => {
              const p = view.players.find((x) => x.seat === s);
              return (
                <button
                  key={s}
                  className={`btn sm${tgs.includes(s) ? ' primary' : ''}`}
                  onClick={() => setTgs((prev) => toggleTarget(prev, s, opts.maxTargets))}
                >
                  {p ? `${p.characterName} · ${p.displayName}` : `座位 ${s + 1}`}
                </button>
              );
            })}
          </div>
        )}

        {cd && (
          <div className="countdown">
            <i style={{ width: `${(cd.remain / cd.total) * 100}%` }} />
          </div>
        )}

        <div className="modal-actions">
          <span className="muted small" style={{ marginRight: 'auto' }}>
            {hint}
          </span>
          {opts.allowPass && (
            <button className="btn" onClick={() => submit(true)}>
              {opts.passLabel || '放弃'}
            </button>
          )}
          {needConfirm && (
            <button className="btn primary" disabled={!canConfirm} onClick={() => submit(false)}>
              确认
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function SelectableCardView(props: { c: Pending['options']['selectableCards'][number]; selected: boolean; onClick: () => void }) {
  const { c } = props;
  if (c.name === null) {
    return (
      <div className={`card back${props.selected ? ' selected' : ''}`} onClick={props.onClick}>
        <span>{c.faceDownSlot ? `背面 ${c.faceDownSlot}` : '背面'}</span>
      </div>
    );
  }
  const red = c.suit === '♥' || c.suit === '♦';
  return (
    <div className={`card selectable${red ? ' red' : ''}${props.selected ? ' selected' : ''}`} onClick={props.onClick}>
      <div className="corner">
        <span>{c.suit}</span>
        <span>{rankText(c.rank)}</span>
      </div>
      <div className="cname">{c.name}</div>
      {c.label && <div className="small" style={{ color: '#7a6a52', textAlign: 'center' }}>{c.label}</div>}
    </div>
  );
}

/* ================================================================== */
/* 结算页                                                              */
/* ================================================================== */

function ResultModal(props: {
  result: { winner: string; selfWin: boolean; seconds: number; rounds: number };
  view: PlayerView | null;
  onAgain: () => void;
  onClose: () => void;
  onNewGame: () => void;
}) {
  const { result, view } = props;
  const mm = String(Math.floor(result.seconds / 60)).padStart(2, '0');
  const ss = String(result.seconds % 60).padStart(2, '0');
  return (
    <div className="overlay">
      <div className="modal" style={{ width: 520 }}>
        <div className="result">
          <div className="big">{WIN_TEXT[result.winner] ?? result.winner}</div>
          <div className={result.selfWin ? 'tag green' : 'tag red'}>{result.selfWin ? '你获胜' : '你落败'}</div>
          <div className={`stamp ${result.selfWin ? 'win' : 'lose'}`}>{result.selfWin ? '胜' : '负'}</div>
        </div>
        <div className="stats">
          <div className="stat">
            <b>{mm}:{ss}</b>
            <span>用时</span>
          </div>
          <div className="stat">
            <b>{result.rounds}</b>
            <span>轮数</span>
          </div>
          <div className="stat">
            <b>{view?.players.filter((p) => p.alive).length ?? 0}</b>
            <span>存活</span>
          </div>
        </div>
        {view && (
          <div className="panel" style={{ background: 'transparent', padding: 0, border: 'none' }}>
            <h3>本局身份</h3>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {view.players.map((p) => (
                <span className="tag" key={p.seat}>
                  {p.characterName} {p.role ? ROLE_LABEL[p.role] : '未公开'} {p.alive ? `· ${p.hp} 体力` : '· 阵亡'}
                </span>
              ))}
            </div>
          </div>
        )}
        <div className="modal-actions">
          <button className="btn ghost" onClick={props.onClose}>
            查看桌面
          </button>
          <button className="btn primary" onClick={props.onNewGame}>
            再来一局
          </button>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/* 规则图鉴                                                            */
/* ================================================================== */

function RulesModal(props: { onClose: () => void }) {
  const [tab, setTab] = useState<'cards' | 'chars'>('cards');
  return (
    <div className="overlay">
      <div className="modal">
        <h3>规则图鉴 · v0.9.1 实现基线</h3>
        <div className="detail">牌面与角色文案用于查阅；实际裁定以本局引擎为准。</div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <button className={`btn sm${tab === 'cards' ? ' primary' : ''}`} onClick={() => setTab('cards')}>
            基础牌（104 张）
          </button>
          <button className={`btn sm${tab === 'chars' ? ' primary' : ''}`} onClick={() => setTab('chars')}>
            角色（40 张登记）
          </button>
        </div>
        {tab === 'cards' && (
          <div style={{ display: 'grid', gap: 8 }}>
            {CARD_DEFS.map((d) => (
              <div key={d.name} className="panel" style={{ padding: '9px 12px' }}>
                <b style={{ color: 'var(--gold-2)' }}>{d.name}</b>{' '}
                <span className="muted small">
                  {d.typeText}
                  {d.range ? ` · 范围 ${d.range}` : ''}
                </span>
                <div className="small muted" style={{ marginTop: 3 }}>
                  {d.desc}
                </div>
              </div>
            ))}
          </div>
        )}
        {tab === 'chars' && (
          <div style={{ display: 'grid', gap: 8 }}>
            {CHARACTERS.map((c) => (
              <div key={c.characterId} className="panel" style={{ padding: '9px 12px', opacity: c.implemented ? 1 : 0.5 }}>
                <b style={{ color: c.implemented ? 'var(--gold-2)' : 'var(--ink-3)' }}>{c.name}</b>{' '}
                <span className="muted small">
                  {c.hp}/{c.maxHp} · {c.batch} · {c.implemented ? '已实现' : '未实现（不可选）'}
                </span>
                {c.skills.map((s) => (
                  <div className="small muted" key={s.skillId} style={{ marginTop: 3 }}>
                    【{s.name}】{s.text}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
        <div className="modal-actions">
          <button className="btn primary" onClick={props.onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
