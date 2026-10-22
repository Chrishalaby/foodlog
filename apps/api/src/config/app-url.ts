import type { Request } from 'express';
import type { AppConfig } from './app-config.js';

const HOST_PATTERN =
  /^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?|\[[0-9A-Fa-f:.]{2,45}\])(?::\d{1,5})?$/;
const FALLBACK_ORIGIN = 'http://localhost';

export interface OriginSource {
  protocol: string;
  host: string | undefined;
}

export function originFromRequest(source: OriginSource): string | null {
  const protocol = source.protocol === 'https' ? 'https' : 'http';
  const host = source.host?.trim();
  if (!host || !HOST_PATTERN.test(host)) {
    return null;
  }
  return `${protocol}://${host.toLowerCase()}`;
}

export function appBaseUrl(
  config: Pick<AppConfig, 'appUrl'>,
  request: Pick<Request, 'protocol' | 'host'>,
): string {
  return (
    config.appUrl ??
    originFromRequest({ protocol: request.protocol, host: request.host }) ??
    FALLBACK_ORIGIN
  );
}

export function appLink(baseUrl: string, path: string): string {
  return `${baseUrl}/${path.replace(/^\/+/, '')}`;
}
