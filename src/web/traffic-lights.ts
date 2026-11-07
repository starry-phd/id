/** The four lights at the top of the Admin Lite home page: green is fine, yellow needs a look, red needs action now. */
export type LightColor = 'green' | 'yellow' | 'red';
export interface Light {
  label: string;
  color: LightColor;
  text: string;
}

export interface LightInput {
  now: number;
  /** Scheduled jobs whose last success is too old. */
  jobsStale: number;
  cleanupWaiting: number;
  cleanupAbandoned: number;
  openTickets: number;
  oldestOpenTicketAt: number | null;
  /** Effective status of every App (after Admin Lite overrides). */
  appStatuses: readonly string[];
}

const DAY = 24 * 60 * 60 * 1000;
export const TICKET_YELLOW_AFTER_MS = DAY;
export const TICKET_RED_AFTER_MS = 3 * DAY;

export function trafficLights(i: LightInput): Light[] {
  const jobs: Light = i.jobsStale > 0 ? { label: '排程', color: 'red', text: `${i.jobsStale} 項逾時未成功` } : { label: '排程', color: 'green', text: '正常' };

  const cleanup: Light =
    i.cleanupAbandoned > 0
      ? { label: '刪除清除', color: 'red', text: `${i.cleanupAbandoned} 項已放棄，需人工處理` }
      : i.cleanupWaiting > 0
        ? { label: '刪除清除', color: 'yellow', text: `${i.cleanupWaiting} 項等待重試` }
        : { label: '刪除清除', color: 'green', text: '無待處理' };

  const waited = i.oldestOpenTicketAt === null ? 0 : i.now - i.oldestOpenTicketAt;
  const tickets: Light =
    i.openTickets === 0
      ? { label: '客服單', color: 'green', text: '沒有未結' }
      : waited > TICKET_RED_AFTER_MS
        ? { label: '客服單', color: 'red', text: `${i.openTickets} 張未結，最久超過 3 天` }
        : waited > TICKET_YELLOW_AFTER_MS
          ? { label: '客服單', color: 'yellow', text: `${i.openTickets} 張未結，最久超過 1 天` }
          : { label: '客服單', color: 'green', text: `${i.openTickets} 張未結，都在 1 天內` };

  const killed = i.appStatuses.filter((s) => s === 'killed').length;
  const paused = i.appStatuses.filter((s) => s === 'paused').length;
  const apps: Light =
    killed > 0
      ? { label: 'App 狀態', color: 'red', text: `${killed} 款已停用${paused > 0 ? `、${paused} 款暫停` : ''}` }
      : paused > 0
        ? { label: 'App 狀態', color: 'yellow', text: `${paused} 款暫停中` }
        : { label: 'App 狀態', color: 'green', text: '全部正常' };

  return [jobs, cleanup, tickets, apps];
}
