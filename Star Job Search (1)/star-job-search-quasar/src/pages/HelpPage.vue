<template>
  <div class="screen app-scroll">
    <div class="wrap">
      <h1 class="page-title">Help</h1>
      <p class="sub">Guides and answers for getting the most out of Star Job Search.</p>

      <!-- Getting started -->
      <h2 class="section-title sec">Getting started</h2>
      <div class="card card--rows">
        <div v-for="(step, i) in steps" :key="i" class="step">
          <span class="step__num font-serif">{{ i + 1 }}</span>
          <div>
            <div class="step__title">{{ step.title }}</div>
            <div class="step__sub">{{ step.body }}</div>
          </div>
        </div>
      </div>

      <!-- How the star score works -->
      <h2 class="section-title sec">How the star score works</h2>
      <p class="lead">
        Every job is scored from one to five stars by comparing the posting against your CV and
        preferences — skills, seniority, location, and salary. Four stars and up are surfaced as
        strong matches; the breakdown for each is on the job's detail screen.
      </p>

      <!-- FAQ -->
      <h2 class="section-title sec">Frequently asked</h2>
      <div class="card card--rows">
        <div v-for="(qa, i) in faqs" :key="i" class="faq">
          <div class="faq__q">{{ qa.q }}</div>
          <div class="faq__a">{{ qa.a }}</div>
        </div>
      </div>

      <!-- Support -->
      <h2 class="section-title sec">Support</h2>
      <div class="card support">
        <span class="support__icon">
          <svg width="19" height="19" viewBox="0 0 16 16" fill="none" stroke="#c2683a" stroke-width="1.4">
            <rect x="2" y="3.5" width="12" height="9" rx="1.5" /><path d="M2.5 4.5 8 8.5l5.5-4" />
          </svg>
        </span>
        <div class="support__meta">
          <div class="support__title">Still stuck?</div>
          <div class="support__sub">Reach the team and we'll get back to you.</div>
        </div>
        <q-btn outline no-caps class="ghost" label="Email support" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const steps = [
  {
    title: 'Add your CV & profile',
    body: 'Upload your CV on the Profile screen so Star can score jobs against your real experience.',
  },
  {
    title: 'Connect an AI provider',
    body: 'Add your OpenRouter key in Settings — it powers scoring and CV/cover-letter drafting.',
  },
  {
    title: 'Choose the sites to scan',
    body: 'In Settings → Job sites, add the boards you want Star to watch overnight.',
  },
  {
    title: 'Review your matches',
    body: 'Each morning, open the Dashboard to see overnight matches and the ones worth a closer look.',
  },
];

const faqs = [
  {
    q: 'Where is my data stored?',
    a: 'Everything — your CV, profile, applications and keys — stays on this device and is backed up to the folder you choose in Settings.',
  },
  {
    q: 'Does Star apply to jobs for me?',
    a: 'No. Star finds and scores matches and helps you tailor a CV and cover letter — you stay in control of every application.',
  },
  {
    q: 'Can I change how often it scans?',
    a: 'Yes — set the auto-scan frequency under Settings → Scanning, or run a scan manually any time from the Dashboard.',
  },
];
</script>

<style scoped lang="scss">
.screen { padding: 30px 36px; height: 100%; }
.wrap { max-width: 680px; }
.sub { margin: 7px 0 28px; font-size: 14px; color: var(--text-3); }
.sec { margin: 0 0 6px; }
.sec:not(:first-of-type) { margin-top: 28px; }
.lead { font-size: 13px; color: var(--muted); margin: 0 0 16px; line-height: 1.55; }

.card { border: 1px solid var(--hair); border-radius: 12px; background: #fff; padding: 20px; }
.card--rows { padding: 0; overflow: hidden; }

.step { display: flex; gap: 14px; padding: 16px 18px; border-bottom: 1px solid var(--hair-light); }
.step:last-child { border-bottom: 0; }
.step__num {
  flex-shrink: 0; width: 26px; height: 26px; border-radius: 50%;
  background: var(--accent-tint); color: var(--accent);
  display: flex; align-items: center; justify-content: center; font-size: 15px;
}
.step__title { font-size: 14px; font-weight: 600; }
.step__sub { font-size: 12.5px; color: var(--muted); margin-top: 3px; line-height: 1.5; }

.faq { padding: 15px 18px; border-bottom: 1px solid var(--hair-light); }
.faq:last-child { border-bottom: 0; }
.faq__q { font-size: 14px; font-weight: 600; }
.faq__a { font-size: 12.5px; color: var(--muted); margin-top: 4px; line-height: 1.55; }

.support { display: flex; align-items: center; gap: 13px; }
.support__icon { width: 40px; height: 40px; border-radius: 10px; background: var(--accent-tint); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.support__meta { flex: 1; min-width: 0; }
.support__title { font-size: 14px; font-weight: 600; }
.support__sub { font-size: 12px; color: var(--muted); margin-top: 3px; }
.ghost { color: var(--text-2); border-color: var(--border-strong); }
</style>
