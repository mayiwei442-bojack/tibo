export class MonitorError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'MonitorError';
  }
}

export function safeErrorCode(error: unknown): string {
  return error instanceof MonitorError ? error.code : 'UNEXPECTED_ERROR';
}
