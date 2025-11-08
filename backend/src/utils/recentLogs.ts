type RecentLog = {
  time: number;
  level: string;
  msg: string;
  meta?: any;
};

const MAX_ENTRIES = 500;
const buffer: RecentLog[] = [];

export function pushRecentLog(level: string, msg: string, meta?: any) {
  try {
    buffer.push({ time: Date.now(), level, msg, meta });
    if (buffer.length > MAX_ENTRIES) buffer.shift();
  } catch (err) {
    // ignore
  }
}

export function getRecentLogs(limit = 200): RecentLog[] {
  return buffer.slice(-Math.max(0, Math.min(limit, buffer.length)));
}

export function clearRecentLogs() {
  buffer.length = 0;
}

export default { pushRecentLog, getRecentLogs, clearRecentLogs };
