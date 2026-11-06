/**
 * Starry SDK — one file for App backends (Cloudflare Workers, Node 18+, Deno, Bun). No dependencies.
 * Copy this file into your App backend. Keep the service key in a Secret, never in the App or in Git.
 *
 *   const starry = new Starry({ baseUrl: 'https://id.starry.phd', serviceKey: env.STARRY_BATTERY_KEY });
 *   const me = await starry.me(accessToken);
 *   await starry.withBattery(accessToken, { taskType: 'myapp.transcribe', taskLabel: '語音轉文字', units: 3 }, async () => doTheAiWork());
 */

export interface StarryOptions {
  baseUrl: string;
  /** Battery service key of this App (x-starry-app-key). Needed for battery and directory calls. */
  serviceKey?: string;
  fetch?: typeof fetch;
}

export class StarryError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body: unknown,
  ) {
    super(message);
  }
  /** Not enough free Battery and Quantum Battery together. */
  get insufficient(): boolean {
    return this.code === 'BATTERY_INSUFFICIENT';
  }
}

export interface Reservation {
  reservation_id: string;
  task_type: string;
  units: number;
  amount: number;
  status: 'reserved' | 'committed' | 'released' | 'expired';
  charged: number | null;
  quantum_amount: number;
  quantum_charged: number | null;
  created_at: number;
  expires_at: number;
  replayed: boolean;
}

export class Starry {
  private readonly f: typeof fetch;
  constructor(private readonly options: StarryOptions) {
    this.f = options.fetch ?? fetch;
  }

  private async call<T>(method: string, path: string, init: { token?: string; key?: boolean; body?: unknown } = {}): Promise<T> {
    const headers: Record<string, string> = {};
    if (init.token) headers.authorization = `Bearer ${init.token}`;
    if (init.key) {
      if (!this.options.serviceKey) throw new Error('serviceKey is required for this call');
      headers['x-starry-app-key'] = this.options.serviceKey;
    }
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    const res = await this.f(`${this.options.baseUrl}${path}`, { method, headers, ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}) });
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    if (!res.ok) {
      const e = (parsed as { error?: { code?: string; message?: string } } | null)?.error;
      throw new StarryError(res.status, e?.code ?? 'HTTP_ERROR', e?.message ?? `HTTP ${res.status}`, parsed);
    }
    return parsed as T;
  }

  /** The signed-in member (needs the member's access token). */
  me(accessToken: string): Promise<unknown> {
    return this.call('GET', '/v1/me', { token: accessToken });
  }

  /** The member's free Battery balance plus this App's Quantum Battery. */
  battery(accessToken: string): Promise<{ balance: { remaining: number }; quantum: { available: number } }> {
    return this.call('GET', '/v1/me/battery', { token: accessToken });
  }

  reserve(accessToken: string, input: { taskType: string; taskLabel?: string; units: number; idempotencyKey?: string }): Promise<Reservation> {
    return this.call('POST', '/v1/battery/reservations', {
      token: accessToken,
      key: true,
      body: { task_type: input.taskType, task_label: input.taskLabel, units: input.units, idempotency_key: input.idempotencyKey ?? crypto.randomUUID() },
    });
  }

  commit(reservationId: string, units?: number): Promise<Reservation> {
    return this.call('POST', `/v1/battery/reservations/${encodeURIComponent(reservationId)}/commit`, { key: true, body: units === undefined ? {} : { units } });
  }

  release(reservationId: string): Promise<Reservation> {
    return this.call('POST', `/v1/battery/reservations/${encodeURIComponent(reservationId)}/release`, { key: true, body: {} });
  }

  /**
   * Reserve, run the task, then commit on success or release on any error (the error is rethrown).
   * `work` may return { units } to charge less than reserved.
   */
  async withBattery<T>(accessToken: string, input: { taskType: string; taskLabel?: string; units: number }, work: (r: Reservation) => Promise<T | { result: T; units: number }>): Promise<T> {
    const r = await this.reserve(accessToken, input);
    let out: T | { result: T; units: number };
    try {
      out = await work(r);
    } catch (error) {
      await this.release(r.reservation_id).catch(() => undefined);
      throw error;
    }
    const metered = typeof out === 'object' && out !== null && 'result' in out && 'units' in out ? (out as { result: T; units: number }) : null;
    await this.commit(r.reservation_id, metered?.units);
    return metered ? metered.result : (out as T);
  }

  /** Look up your own members (member number, nickname, avatar). */
  directory(userIds: string[]): Promise<unknown> {
    return this.call('POST', '/v1/directory/members', { key: true, body: { user_ids: userIds } });
  }
}
