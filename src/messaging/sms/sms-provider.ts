import { Logger } from '@nestjs/common';

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');
export type DeliveryState = 'DELIVERED' | 'FAILED' | 'PENDING';

/**
 * The only thing the application knows about SMS. Swapping providers (Kavenegar, IPPanel, Melipayamak,
 * Faraz SMS ...) means writing one more class that implements this interface — nothing else changes.
 */
export interface ISmsProvider {
  readonly name: string;
  send(to: string, text: string): Promise<{ messageId: string }>;
  getStatus(messageIds: string[]): Promise<Record<string, DeliveryState>>;
  /** Remaining credit in the provider's own unit (Rials for Kavenegar) or null when unknown. */
  getBalance(): Promise<number | null>;
}

/** Development provider: logs instead of sending, reports everything as delivered. */
export class LogSmsProvider implements ISmsProvider {
  readonly name = 'log';
  private logger = new Logger('LogSmsProvider');
  private n = 0;
  async send(to: string, text: string) {
    this.logger.log(`SMS to ${to.slice(0, 4)}***${to.slice(-3)} (${[...text].length} chars)`);
    return { messageId: `log-${Date.now()}-${this.n++}` };
  }
  async getStatus(ids: string[]) {
    return Object.fromEntries(ids.map((i) => [i, 'DELIVERED' as DeliveryState]));
  }
  async getBalance() {
    return null;
  }
}

/**
 * Kavenegar REST adapter. Written from the public API documentation and NOT yet exercised against a real
 * account: verify send / status / balance with a test key before going live.
 */
export class KavenegarSmsProvider implements ISmsProvider {
  readonly name = 'kavenegar';
  constructor(private apiKey: string, private sender?: string) {}

  private async call(method: string, params: Record<string, string>): Promise<any[]> {
    const res = await fetch(`https://api.kavenegar.com/v1/${this.apiKey}/${method}.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(15_000),
    });
    const json: any = await res.json().catch(() => null);
    const status = json?.return?.status;
    if (!res.ok || status !== 200) throw new Error(`Kavenegar error ${status ?? res.status}: ${json?.return?.message ?? 'no details'}`);
    const entries = json.entries;
    return Array.isArray(entries) ? entries : entries ? [entries] : [];
  }

  async send(to: string, text: string) {
    const entries = await this.call('sms/send', { receptor: to, message: text, ...(this.sender ? { sender: this.sender } : {}) });
    if (!entries[0]?.messageid) throw new Error('Kavenegar returned no message id');
    return { messageId: String(entries[0].messageid) };
  }

  async getStatus(ids: string[]) {
    const entries = await this.call('sms/status', { messageid: ids.join(',') });
    const out: Record<string, DeliveryState> = {};
    for (const e of entries) {
      const s = Number(e.status);
      out[String(e.messageid)] = s === 10 ? 'DELIVERED' : [6, 11, 13, 14, 100].includes(s) ? 'FAILED' : 'PENDING';
    }
    return out;
  }

  async getBalance() {
    const entries = await this.call('account/info', {});
    const v = Number(entries[0]?.remaincredit);
    return Number.isFinite(v) ? v : null;
  }
}
