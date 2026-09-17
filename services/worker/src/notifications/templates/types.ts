export interface TemplateContext {
  monitorName: string;
  monitorId: string;
  targetUrl: string;
  isUp: boolean;
  isRecovery: boolean;
  isInitialOutage: boolean;
  downtimeMinutes: number;
  reason: string;
  timestamp: string;
  timestampIso: string;
}

export interface TemplateOutput {
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body: string;
}
