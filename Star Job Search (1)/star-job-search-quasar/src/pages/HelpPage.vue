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

      <!-- Browsing job sites -->
      <h2 class="section-title sec">Browsing job sites</h2>
      <p class="lead">
        Star opens public job boards inside the app so you can browse listings without leaving Star.
        Pages render as-is for you — Star never bypasses logins, paywalls, or CAPTCHAs.
      </p>
      <div class="card card--rows">
        <div v-for="(step, i) in browseSteps" :key="i" class="step">
          <span class="step__num font-serif">{{ i + 1 }}</span>
          <div>
            <div class="step__title">{{ step.title }}</div>
            <div class="step__sub">{{ step.body }}</div>
          </div>
        </div>
      </div>

      <!-- Connecting an AI provider -->
      <h2 class="section-title sec">Connecting an AI provider</h2>
      <p class="lead">
        Star uses OpenRouter to score jobs and draft tailored CVs &amp; cover letters. Your key
        is stored locally and never leaves this device.
      </p>
      <div class="card card--rows">
        <div v-for="(step, i) in providerSteps" :key="i" class="step">
          <span class="step__num font-serif">{{ i + 1 }}</span>
          <div>
            <div class="step__title">{{ step.title }}</div>
            <div class="step__sub">{{ step.body }}</div>
          </div>
        </div>
      </div>

      <!-- Importing jobs with AI Extract -->
      <h2 class="section-title sec">Importing jobs with AI Extract</h2>
      <p class="lead">
        AI Extract reads the listing page you currently have open in Discover and imports the
        matching jobs into your local board. Star never bypasses logins, paywalls, or CAPTCHAs —
        you sign in and narrow the search first, then hand the filtered page to Star.
      </p>
      <div class="card card--rows">
        <div v-for="(step, i) in extractSteps" :key="i" class="step">
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
    body: 'Paste your OpenRouter key in Settings → LLM integration and hit Save, run Test connection to confirm it works, then use Select models… to pick your preferred models and Set default on the one Star should use first.',
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

const browseSteps = [
  {
    title: 'Add a job site in Settings',
    body: 'Open Settings → Job sites, paste a URL, and press Add. Star normalises the URL and saves the site locally so it survives a restart.',
  },
  {
    title: 'Pick a site on Discover',
    body: 'On the Discover page, choose a saved site from the dropdown. Star loads it in the embedded browser and the URL pill reflects the current page.',
  },
  {
    title: 'Move back and forward',
    body: 'Use the back/forward chevrons in the browser chrome to step through pages within the loaded site, just like a normal browser tab.',
  },
  {
    title: 'Remove sites you no longer want',
    body: 'Back in Settings → Job sites, hit Remove next to any site to drop it. It disappears from the Discover dropdown straight away.',
  },
];

const providerSteps = [
  {
    title: 'Save your OpenRouter key',
    body: 'In Settings → LLM integration, paste your key from openrouter.ai/keys into the OpenRouter API key field and press Save. Star stores it locally and only shows a masked preview after that — use Clear to remove it.',
  },
  {
    title: 'Run Test connection',
    body: 'Hit Test connection to confirm the key reaches OpenRouter. A green Connected line with a model count means you\'re good; an error line tells you what to fix.',
  },
  {
    title: 'Pick your preferred models',
    body: 'Click Select models… to open the picker and choose up to five models you\'re happy for Star to use. The button is enabled once a key is saved.',
  },
  {
    title: 'Set a default model',
    body: 'In the preferred-models list, press Set default next to the model Star should reach for first when scoring jobs and drafting CVs and cover letters. Remove drops any model you no longer want.',
  },
];

const extractSteps = [
  {
    title: 'Log in and filter on Discover',
    body: 'On the Discover page, pick the site and use its own search to log in if needed and narrow the listing to the roles you want — location, keywords, seniority. Star imports whatever the page is showing, so the tighter the filter, the better the board.',
  },
  {
    title: 'Click AI Extract',
    body: 'With the filtered listing on screen, hit the AI Extract button. Star drives a hidden crawler over that page using your preferred OpenRouter model and writes the results to your local job board.',
  },
  {
    title: 'Watch progress',
    body: 'A progress line shows the current phase (discover, enumerate, paginate, extract) and how many postings have been imported so far. The run stops automatically on a CAPTCHA or after the configured page cap.',
  },
  {
    title: 'Triage on Starred matches',
    body: 'Open Starred matches to see what was imported. Open sends the posting back into the embedded browser; Not interested hides it; Restore N hidden brings hidden roles back when you change your mind.',
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
  {
    q: 'Is the embedded browser isolated from my Star data?',
    a: 'Yes. The embedded browser runs in a partitioned session, so cookies and JavaScript on job sites can\'t reach your CV, profile, or app data.',
  },
  {
    q: 'Why is the Discover dropdown empty?',
    a: 'You haven\'t added a job site yet. Open Settings → Job sites and add one — it\'ll appear in the Discover dropdown straight away.',
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
