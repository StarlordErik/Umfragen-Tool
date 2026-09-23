export const OLIVE_BASE = '/projects/olive-symposium';

function mountAttributes(source: string): string {
  return source.replace(
    /\b(href|src|action)=(['"])(\/(?!\/)[^'"<>]*)\2/g,
    (_, attribute: string, quote: string, path: string) =>
      `${attribute}=${quote}${OLIVE_BASE}${path === '/' ? '' : path}${quote}`,
  );
}

/** Inline scripts contain user data and dictionaries: preserve their exact bytes. */
export function mountDocument(source: string): string {
  return source.replace(
    /(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)|<[^>]+>/gi,
    (
      tag,
      start: string | undefined,
      content: string | undefined,
      end: string | undefined,
    ) =>
      start
        ? `${mountAttributes(start)}${content}${end}`
        : mountAttributes(tag),
  );
}

export function mountScript(source: string): string {
  return mountAttributes(source).replace(
    /(["'`])\/api\//g,
    `$1${OLIVE_BASE}/api/`,
  );
}
