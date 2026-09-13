import type { Command, PlayerView } from '@engine/types';
import { LocalGame } from '../runner/localGame';

/**
 * 统一 GameClient 接口。
 *
 * 单机与联机只替换适配器；桌面组件、技能交互、牌面数据继续复用。
 */
export interface GameClient {
  /** 载入一份存档并推进到第一个稳定等待点。 */
  load(stateJson: string, selfSeat: number): Promise<void>;
  /** 提交一个意图。 */
  send(command: Command): Promise<{ ok: boolean; error?: string }>;
  /** 订阅视图变化。 */
  subscribe(cb: () => void): () => void;
  /** 当前可见视图（同步返回缓存）。 */
  view(): PlayerView | null;
  /** 导出完整状态（仅单机开发用）。 */
  snapshot(): Promise<string | null>;
  /** 使用哪种适配器。 */
  readonly kind: 'worker' | 'in-process';
}

abstract class BaseClient implements GameClient {
  protected listeners = new Set<() => void>();
  protected cached: PlayerView | null = null;
  abstract kind: GameClient['kind'];
  abstract load(stateJson: string, selfSeat: number): Promise<void>;
  abstract send(command: Command): Promise<{ ok: boolean; error?: string }>;
  abstract snapshot(): Promise<string | null>;

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  view(): PlayerView | null {
    return this.cached;
  }

  protected notify(): void {
    for (const cb of this.listeners) cb();
  }
}

/** 主线程内直接运行引擎。作为 Worker 不可用时的兜底路径，代码完全一致。 */
export class InProcessClient extends BaseClient {
  kind = 'in-process' as const;
  private game: LocalGame | null = null;

  async load(stateJson: string, selfSeat: number): Promise<void> {
    const { deserialize } = await import('@engine/engine');
    const state = deserialize(stateJson);
    this.game = new LocalGame(state, selfSeat);
    this.game.start();
    this.refresh();
  }

  async send(command: Command): Promise<{ ok: boolean; error?: string }> {
    if (!this.game) return { ok: false, error: '尚未载入对局。' };
    const r = this.game.send(command);
    this.refresh();
    return { ok: r.ok, error: r.error };
  }

  async snapshot(): Promise<string | null> {
    if (!this.game) return null;
    const { serialize } = await import('@engine/engine');
    return serialize(this.game.state);
  }

  private refresh(): void {
    if (!this.game) return;
    this.cached = this.game.view();
    this.notify();
  }
}

/** 在浏览器 Worker 中运行裁判。规则推进与界面更新分开。 */
export class WorkerClient extends BaseClient {
  kind = 'worker' as const;
  private worker: Worker;
  private pending = new Map<number, (v: unknown) => void>();
  private seq = 0;

  constructor() {
    super();
    this.worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent) => {
      const msg = e.data as { type: string; reqId?: number; view?: PlayerView; [k: string]: unknown };
      if (msg.type === 'view' && msg.view) {
        this.cached = msg.view;
        this.notify();
      }
      if (msg.reqId !== undefined) {
        const resolve = this.pending.get(msg.reqId);
        if (resolve) {
          this.pending.delete(msg.reqId);
          resolve(msg);
        }
      }
    };
  }

  private call(payload: Record<string, unknown>): Promise<any> {
    const reqId = ++this.seq;
    return new Promise((resolve) => {
      this.pending.set(reqId, resolve);
      this.worker.postMessage({ ...payload, reqId });
    });
  }

  async load(stateJson: string, selfSeat: number): Promise<void> {
    await this.call({ type: 'load', stateJson, selfSeat });
  }

  async send(command: Command): Promise<{ ok: boolean; error?: string }> {
    const r = await this.call({ type: 'command', command });
    return { ok: Boolean(r.ok), error: r.error as string | undefined };
  }

  async snapshot(): Promise<string | null> {
    const r = await this.call({ type: 'snapshot' });
    return (r.stateJson as string) ?? null;
  }
}

/** 优先使用 Worker；构造失败时回退到主线程内运行。 */
export async function createClient(): Promise<GameClient> {
  try {
    const c = new WorkerClient();
    return c;
  } catch {
    return new InProcessClient();
  }
}
