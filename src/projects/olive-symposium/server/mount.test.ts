import { describe, expect, it } from 'vitest';
import { mountDocument, mountScript, OLIVE_BASE } from './mount';

describe('legacy URL mount', () => {
  it('mounts navigation and assets but preserves dictionary keys, data and external links', () => {
    const source =
      '<a href="/">Home</a><script src="/static/home.js"></script><a href="//example.com">Extern</a><script>window.UI_TEXTS={"/":{"label":"/ergebnisse"}};</script>';
    expect(mountDocument(source)).toBe(
      `<a href="${OLIVE_BASE}">Home</a><script src="${OLIVE_BASE}/static/home.js"></script><a href="//example.com">Extern</a><script>window.UI_TEXTS={"/":{"label":"/ergebnisse"}};</script>`,
    );
  });
  it('handles template-literal API calls without changing route dictionaries', () => {
    const source =
      'const key="/ergebnisse"; fetch(`/api/bootstrap?survey_id=${id}`); postAction("/api/oils/add", {}); const html=\'<a href="/">Home</a>\';';
    expect(mountScript(source)).toBe(
      `const key="/ergebnisse"; fetch(\`${OLIVE_BASE}/api/bootstrap?survey_id=\${id}\`); postAction("${OLIVE_BASE}/api/oils/add", {}); const html='<a href="${OLIVE_BASE}">Home</a>';`,
    );
  });
  it('does not alter URL-looking text inside user-provided JSON', () => {
    const data =
      '<script>window.HOME_STATE={"name":"href=\'/beispiel\'"};</script>';
    expect(mountDocument(data)).toBe(data);
  });
});
