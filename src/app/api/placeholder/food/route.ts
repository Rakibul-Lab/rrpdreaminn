import { NextRequest, NextResponse } from 'next/server';

function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

// GET /api/placeholder/food?seed=...&name=...&w=...&h=...
// Returns an SVG placeholder you can use as an <img src="...">.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const seed = searchParams.get('seed') || 'food';
  const name = (searchParams.get('name') || 'Food').trim();
  const w = clamp(Number(searchParams.get('w') || 320), 120, 800);
  const h = clamp(Number(searchParams.get('h') || 200), 80, 600);

  const hash = hashString(seed);
  const hue = hash % 360;
  const bg = `hsl(${hue} 70% 92%)`;
  const fg = `hsl(${hue} 55% 30%)`;
  const accent = `hsl(${(hue + 25) % 360} 80% 55%)`;

  const title = name.length > 26 ? `${name.slice(0, 24)}…` : name;
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('') || 'F';

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${bg}"/>
      <stop offset="100%" stop-color="white"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${w}" height="${h}" rx="18" fill="url(#g)"/>
  <circle cx="${Math.round(w * 0.78)}" cy="${Math.round(h * 0.28)}" r="${Math.round(Math.min(w, h) * 0.22)}" fill="${accent}" opacity="0.25"/>
  <circle cx="${Math.round(w * 0.22)}" cy="${Math.round(h * 0.75)}" r="${Math.round(Math.min(w, h) * 0.28)}" fill="${accent}" opacity="0.18"/>
  <g font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial" fill="${fg}">
    <text x="${Math.round(w * 0.08)}" y="${Math.round(h * 0.42)}" font-size="${Math.round(h * 0.22)}" font-weight="800" opacity="0.9">${initials}</text>
    <text x="${Math.round(w * 0.08)}" y="${Math.round(h * 0.68)}" font-size="${Math.round(h * 0.12)}" font-weight="700" opacity="0.85">${escapeXml(title)}</text>
    <text x="${Math.round(w * 0.08)}" y="${Math.round(h * 0.83)}" font-size="${Math.round(h * 0.08)}" font-weight="600" opacity="0.55">CloudView • POS</text>
  </g>
</svg>`;

  return new NextResponse(svg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, immutable',
    },
  });
}

function escapeXml(str: string) {
  return str
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

