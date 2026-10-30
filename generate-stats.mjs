// Generates assets/github-stats.svg, assets/languages.svg and assets/contributions.svg
// from the GitHub GraphQL API. Runs in GitHub Actions with the built-in GITHUB_TOKEN.
// Local preview with fake data: MOCK=1 OUT_DIR=/tmp/preview node scripts/generate-stats.mjs
import { writeFileSync, mkdirSync } from "node:fs";

const LOGIN = process.env.GH_LOGIN || "harshit-tiwari-codebase";
const OUT = process.env.OUT_DIR || "assets";
const SANS = "'Segoe UI', -apple-system, 'Helvetica Neue', Arial, sans-serif";
const C = { bg: "#18181B", border: "#27272A", acc: "#8B5CF6", acc2: "#A78BFA", txt: "#FAFAFA", mut: "#A1A1AA" };
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmt = (n) => n.toLocaleString("en-US");

const QUERY = `query($login:String!){
  user(login:$login){
    repositories(first:100, ownerAffiliations:OWNER, isFork:false, privacy:PUBLIC){
      totalCount
      nodes{ stargazerCount languages(first:10, orderBy:{field:SIZE,direction:DESC}){ edges{ size node{ name } } } }
    }
    pullRequests{ totalCount }
    contributionsCollection{
      totalCommitContributions
      contributionCalendar{ totalContributions weeks{ contributionDays{ date contributionCount } } }
    }
  }
}`;

async function load() {
  if (process.env.MOCK) return mock();
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is not set");
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": "profile-stats" },
    body: JSON.stringify({ query: QUERY, variables: { login: LOGIN } }),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data.user;
}

function mock() {
  const weeks = [];
  const start = new Date(Date.UTC(2025, 10, 2));
  for (let w = 0; w < 53; w++) {
    const days = [];
    for (let d = 0; d < 7; d++) {
      const dt = new Date(start.getTime() + (w * 7 + d) * 86400000);
      const n = (w * 7 + d * 3) % 5 === 0 ? 0 : ((w + d * 2) % 7) * (w > 30 ? 2 : 1);
      days.push({ date: dt.toISOString().slice(0, 10), contributionCount: n });
    }
    weeks.push({ contributionDays: days });
  }
  const mk = (a) => ({ stargazerCount: 1, languages: { edges: a.map(([name, size]) => ({ size, node: { name } })) } });
  return {
    repositories: { totalCount: 13, nodes: [mk([["JavaScript", 90000], ["CSS", 30000], ["HTML", 12000]]), mk([["C++", 20000], ["TypeScript", 15000], ["Python", 9000]])] },
    pullRequests: { totalCount: 4 },
    contributionsCollection: { totalCommitContributions: 120, contributionCalendar: { totalContributions: 300, weeks } },
  };
}

const wrap = (w, h, title, desc, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="t d">
<title id="t">${esc(title)}</title>
<desc id="d">${esc(desc)}</desc>
<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="12" fill="${C.bg}" stroke="${C.border}"/>
<g font-family="${SANS}">
${body}
</g>
</svg>
`;

function streaks(days) {
  let longest = 0, run = 0;
  for (const d of days) { run = d.contributionCount > 0 ? run + 1 : 0; longest = Math.max(longest, run); }
  let i = days.length - 1;
  if (days[i] && days[i].contributionCount === 0) i--; // today may not have activity yet
  let current = 0;
  while (i >= 0 && days[i].contributionCount > 0) { current++; i--; }
  return { current, longest };
}

function statsSvg(u) {
  const cal = u.contributionsCollection.contributionCalendar;
  const days = cal.weeks.flatMap((w) => w.contributionDays);
  const { current, longest } = streaks(days);
  const stars = u.repositories.nodes.reduce((s, r) => s + r.stargazerCount, 0);
  const cells = [
    [fmt(cal.totalContributions), "Contributions, last year"],
    [fmt(u.contributionsCollection.totalCommitContributions), "Commits, last year"],
    [`${current} ${current === 1 ? "day" : "days"}`, "Current streak"],
    [`${longest} ${longest === 1 ? "day" : "days"}`, "Longest streak, last year"],
    [fmt(u.pullRequests.totalCount), "Pull requests"],
    [fmt(u.repositories.totalCount), "Public repositories"],
  ];
  const W = 880, cw = 280;
  let b = `<text x="32" y="44" font-size="18" font-weight="700" fill="${C.txt}">GitHub activity</text>
<text x="848" y="44" font-size="12" fill="${C.mut}" text-anchor="end">Public data, refreshed daily</text>`;
  cells.forEach(([v, l], i) => {
    const x = 32 + (i % 3) * cw, y = 92 + Math.floor(i / 3) * 62;
    b += `\n<text x="${x}" y="${y}" font-size="24" font-weight="700" fill="${i === 2 || i === 3 ? C.acc2 : C.txt}">${esc(v)}</text><text x="${x}" y="${y + 20}" font-size="12.5" fill="${C.mut}">${esc(l)}</text>`;
  });
  const desc = cells.map(([v, l]) => `${l}: ${v}`).join(". ");
  return wrap(W, 200, "GitHub activity", desc, b);
}

function languagesSvg(u) {
  const tot = {};
  for (const r of u.repositories.nodes) for (const e of r.languages.edges) tot[e.node.name] = (tot[e.node.name] || 0) + e.size;
  const sum = Object.values(tot).reduce((a, b) => a + b, 0) || 1;
  let list = Object.entries(tot).sort((a, b) => b[1] - a[1]);
  const top = list.slice(0, 6);
  const rest = list.slice(6).reduce((a, [, s]) => a + s, 0);
  if (rest) top.push(["Other", rest]);
  const shades = ["#8B5CF6", "#A78BFA", "#C4B5FD", "#6D28D9", "#7C7C86", "#52525B", "#3F3F46"];
  const W = 880, bx = 32, bw = 816;
  let b = `<text x="32" y="44" font-size="18" font-weight="700" fill="${C.txt}">Languages</text>
<text x="848" y="44" font-size="12" fill="${C.mut}" text-anchor="end">By code size across public repositories</text>
<clipPath id="bar"><rect x="${bx}" y="64" width="${bw}" height="12" rx="6"/></clipPath><g clip-path="url(#bar)">`;
  let x = bx;
  top.forEach(([, s], i) => { const w = (s / sum) * bw; b += `<rect x="${x.toFixed(1)}" y="64" width="${w.toFixed(1)}" height="12" fill="${shades[i]}"/>`; x += w; });
  b += "</g>";
  top.forEach(([n, s], i) => {
    const col = i % 4, row = Math.floor(i / 4);
    const lx = 32 + col * 204, ly = 112 + row * 26;
    b += `\n<circle cx="${lx + 5}" cy="${ly - 4}" r="5" fill="${shades[i]}"/><text x="${lx + 18}" y="${ly}" font-size="13" fill="${C.txt}">${esc(n)} <tspan fill="${C.mut}">${((s / sum) * 100).toFixed(1)}%</tspan></text>`;
  });
  const H = 112 + Math.floor((top.length - 1) / 4) * 26 + 26;
  return wrap(W, H, "Languages", top.map(([n, s]) => `${n} ${((s / sum) * 100).toFixed(1)}%`).join(", "), b);
}

function contributionsSvg(u) {
  const cal = u.contributionsCollection.contributionCalendar;
  const weeks = cal.weeks;
  const max = Math.max(1, ...weeks.flatMap((w) => w.contributionDays.map((d) => d.contributionCount)));
  const level = (n) => (n === 0 ? 0 : Math.min(4, Math.ceil((n / max) * 4)));
  const fills = [C.border, "#8B5CF6", "#8B5CF6", "#8B5CF6", "#A78BFA"];
  const ops = [1, 0.3, 0.5, 0.75, 1];
  const step = 15, size = 12, gx = 32 + 28, gy = 86;
  let b = `<text x="32" y="44" font-size="18" font-weight="700" fill="${C.txt}">Contributions</text>
<text x="848" y="44" font-size="12" fill="${C.mut}" text-anchor="end">${fmt(cal.totalContributions)} in the last year</text>`;
  const dn = ["Mon", "Wed", "Fri"];
  [1, 3, 5].forEach((r, i) => { b += `\n<text x="32" y="${gy + r * step + 10}" font-size="11" fill="${C.mut}">${dn[i]}</text>`; });
  let lastMonth = -1;
  weeks.forEach((w, wi) => {
    const m = new Date(w.contributionDays[0].date + "T00:00:00Z").getUTCMonth();
    if (m !== lastMonth && wi < weeks.length - 2) {
      b += `\n<text x="${gx + wi * step}" y="${gy - 10}" font-size="11" fill="${C.mut}">${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m]}</text>`;
      lastMonth = m;
    }
    w.contributionDays.forEach((d, di) => {
      const l = level(d.contributionCount);
      b += `\n<rect x="${gx + wi * step}" y="${gy + di * step}" width="${size}" height="${size}" rx="3" fill="${fills[l]}" fill-opacity="${ops[l]}"><title>${esc(d.date)}: ${d.contributionCount}</title></rect>`;
    });
  });
  const ly = gy + 7 * step + 18;
  b += `\n<text x="${848 - 5 * 17 - 62}" y="${ly + 9}" font-size="11" fill="${C.mut}">Less</text>`;
  for (let l = 0; l < 5; l++) b += `<rect x="${848 - 5 * 17 - 30 + l * 17}" y="${ly}" width="12" height="12" rx="3" fill="${fills[l]}" fill-opacity="${ops[l]}"/>`;
  b += `<text x="848" y="${ly + 9}" font-size="11" fill="${C.mut}" text-anchor="end">More</text>`;
  return wrap(880, ly + 28, "Contribution calendar", `${cal.totalContributions} contributions in the last year, shown by day.`, b);
}

const user = await load();
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/github-stats.svg`, statsSvg(user));
writeFileSync(`${OUT}/languages.svg`, languagesSvg(user));
writeFileSync(`${OUT}/contributions.svg`, contributionsSvg(user));
console.log("Wrote stats SVGs to", OUT);
