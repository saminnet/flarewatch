export interface MonitorTarget {
  id: string;
  name: string;
  method: string;
  target: string;
  expectedCodes?: number[];
  timeout?: number;
  headers?: Record<string, string | number>;
  body?: string;
  responseKeyword?: string;
  responseForbiddenKeyword?: string;
  sslCheckEnabled?: boolean;
  sslCheckDaysBeforeExpiry?: number;
  sslIgnoreSelfSigned?: boolean;
}

export interface SSLCertificateInfo {
  expiryDate: number;
  daysUntilExpiry: number;
  issuer?: string;
  subject?: string;
}

export interface CheckSuccess {
  ok: true;
  latency: number;
  ssl?: SSLCertificateInfo;
}

export interface CheckFailure {
  ok: false;
  error: string;
  latency?: number;
}

export type CheckResult = CheckSuccess | CheckFailure;

export interface CheckResultWithLocation {
  location: string;
  result: CheckResult;
}
