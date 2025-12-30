import { type SSLCertificateInfo, withTimeout, DEFAULT_HTTP_TIMEOUT } from '@flarewatch/shared';

export interface SSLCheckOptions {
  /** Days before expiry to warn */
  daysBeforeExpiry?: number;
  /** Ignore self-signed certificates (default: false) */
  ignoreSelfSigned?: boolean;
  /** Connection timeout in ms */
  timeout?: number;
}

/**
 * Check SSL certificate for a given URL
 * Returns certificate information including expiry date
 */
export async function checkSSLCertificate(
  url: string,
  options: SSLCheckOptions = {},
): Promise<SSLCertificateInfo> {
  const { ignoreSelfSigned = false, timeout = DEFAULT_HTTP_TIMEOUT } = options;

  // Dynamic import for Node.js TLS module
  const tls = await import('node:tls').catch(() => null);

  if (!tls) {
    throw new Error('SSL checks require Node.js runtime (tls module not available)');
  }

  const parsedUrl = new URL(url);
  const hostname = parsedUrl.hostname;
  const port = parsedUrl.port ? Number(parsedUrl.port) : 443;

  const checkPromise = new Promise<SSLCertificateInfo>((resolve, reject) => {
    const socket = tls.connect(
      {
        host: hostname,
        port,
        servername: hostname,
        rejectUnauthorized: !ignoreSelfSigned,
      },
      () => {
        try {
          const cert = socket.getPeerCertificate();

          if (!cert || Object.keys(cert).length === 0) {
            socket.end();
            reject(new Error('No certificate received'));
            return;
          }

          if (!cert.valid_to) {
            socket.end();
            reject(new Error('Certificate missing valid_to field'));
            return;
          }

          const expiryDate = new Date(cert.valid_to).getTime();
          const now = Date.now();
          const daysUntilExpiry = Math.floor((expiryDate - now) / (1000 * 60 * 60 * 24));

          socket.end();

          resolve({
            expiryDate: Math.floor(expiryDate / 1000), // Convert to Unix timestamp (seconds)
            daysUntilExpiry,
            issuer: cert.issuer?.O ?? cert.issuer?.CN,
            subject: cert.subject?.CN,
          });
        } catch (err) {
          socket.end();
          reject(err);
        }
      },
    );

    socket.on('error', (err) => {
      socket.destroy();
      reject(err);
    });

    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('SSL connection timeout'));
    });

    socket.setTimeout(timeout);
  });

  return withTimeout(checkPromise, timeout);
}
