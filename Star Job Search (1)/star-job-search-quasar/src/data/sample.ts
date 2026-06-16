import type { Application, Match, ScanSource, Suggestion } from 'src/types/models';

// Representative sample data. In production these are produced by the
// embedded-browser scan + CV parser; here they stand in for that feed.

export const APPLICATIONS: Application[] = [
  { mono: 'C', role: 'Staff Product Designer',       co: 'Cedar & Co',       loc: 'Remote · UK',          score: 4.8, status: 'Offer',        applied: 'May 28', updated: '1d ago' },
  { mono: 'N', role: 'Senior Product Designer',      co: 'Northwind Studio', loc: 'Remote · UK',          score: 4.6, status: 'Interviewing', applied: 'Jun 8',  updated: '2d ago' },
  { mono: 'L', role: 'Lead UX Designer',             co: 'Lumen Health',     loc: 'Hybrid · Manchester',  score: 4.4, status: 'Applied',      applied: 'Jun 6',  updated: '4d ago' },
  { mono: 'O', role: 'Senior UX Designer',           co: 'Orbit Labs',       loc: 'Remote · EU',          score: 4.2, status: 'Interviewing', applied: 'Jun 3',  updated: '6d ago' },
  { mono: 'A', role: 'Product Designer, Platform',   co: 'Atlas Pay',        loc: 'Remote · EU',          score: 4.0, status: 'Applied',      applied: 'Jun 5',  updated: '5d ago' },
  { mono: 'V', role: 'Senior Interaction Designer',  co: 'Vela Robotics',    loc: 'On-site · Bristol',    score: 3.7, status: 'Saved',        applied: '—',      updated: '1w ago' },
  { mono: 'M', role: 'Product Designer',             co: 'Meridian Bank',    loc: 'Hybrid · London',      score: 3.4, status: 'Rejected',     applied: 'May 24', updated: '3d ago' },
];

export const MATCHES: Match[] = [
  { id: 'm1', mono: 'N', role: 'Senior Product Designer',     co: 'Northwind Studio',  loc: 'Remote · UK',         salary: '£75–90k', score: 4.6, tag: 'New today', why: 'Design-system match' },
  { id: 'm2', mono: 'L', role: 'Lead UX Designer',            co: 'Lumen Health',      loc: 'Hybrid · Manchester', salary: '£80k',    score: 4.4, tag: 'New today', why: 'Strong skills fit' },
  { id: 'm3', mono: 'O', role: 'Senior UX Designer',          co: 'Orbit Labs',        loc: 'Remote · EU',         salary: '€68–78k', score: 4.2, tag: 'New today', why: 'Research-led role' },
  { id: 'm4', mono: 'A', role: 'Product Designer, Platform',  co: 'Atlas Pay',         loc: 'Remote · EU',         salary: '€70–82k', score: 4.0, tag: '2d ago',    why: 'Fintech + systems' },
  { id: 'm5', mono: 'H', role: 'Product Designer',            co: 'Harbor Logistics',  loc: 'Hybrid · Leeds',      salary: '£65k',    score: 3.9, tag: '3d ago',    why: 'B2B SaaS fit' },
  { id: 'm6', mono: 'V', role: 'Senior Interaction Designer', co: 'Vela Robotics',     loc: 'On-site · Bristol',   salary: '£72k',    score: 3.7, tag: '3d ago',    why: 'Prototyping match' },
];

export const SCAN_SOURCES: ScanSource[] = [
  { name: 'RoleHub',      count: 412,      progress: 100, state: 'done' },
  { name: 'Workscout',    count: 286,      progress: 72,  state: 'running' },
  { name: 'Talentstream', count: 154,      progress: 45,  state: 'running' },
  { name: 'Hired',        count: 'queued', progress: 8,   state: 'queued' },
];

export const SUGGESTIONS: Suggestion[] = [
  { kind: 'Keyword',     gain: '+2%', text: 'Add “design tokens” to your summary — it appears 3× in the post.' },
  { kind: 'Reword',      gain: '+1%', text: 'Lead with impact: “Built a token-driven design system adopted by 5 teams.”' },
  { kind: 'Surface gap', gain: '+1%', text: 'Add “fintech” as a skill — your payments work qualifies.' },
];

export const SCORE_BREAKDOWN = [
  { label: 'Skills & tools',   value: 95, good: true },
  { label: 'Experience level', value: 88, good: true },
  { label: 'Location & type',  value: 100, good: true },
  { label: 'Salary fit',       value: 80, good: false },
];

export const PARSED_SKILLS = ['Figma', 'Design systems', 'Design tokens', 'Prototyping', 'Fintech'];

// The "real" key only revealed after pressing Show in Settings.
export const SAMPLE_API_KEY = 'sk-or-v1-3a9f2c8e7b1d4f6a0c5e9b2d7f1a8c4e';
