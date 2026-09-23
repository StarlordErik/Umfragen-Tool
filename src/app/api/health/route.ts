export const dynamic = 'force-dynamic';

/** Platform readiness deliberately does not depend on optional projects. */
export function GET() {
  return Response.json(
    { status: 'ok' },
    {
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
