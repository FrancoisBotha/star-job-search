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

      <!-- CV and Profile -->
      <h2 class="section-title sec">CV and Profile</h2>
      <p class="lead">
        Star scores jobs against your real CV and Profile, so the first thing to do is upload
        one. Your CV file and the text Star reads out of it stay on this device — only the
        structuring step talks to OpenRouter, and only after you say yes.
      </p>
      <div class="card card--rows">
        <div v-for="(step, i) in cvProfileSteps" :key="i" class="step">
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
      <h2 class="section-title sec">How the match score works</h2>
      <p class="lead">
        Every job on your board gets a <strong>1 to 5 star</strong> match and a
        <strong>0 to 100% match</strong> by comparing the posting against your Profile across
        four factors — skills, experience, location and salary. The percentage drives the stars,
        so the two never disagree. Scoring is <strong>local, deterministic and fully offline</strong>:
        the same job + Profile + weights always yield the same result, and it works with
        <strong>no AI key and no network</strong> — Star never calls OpenRouter to score.
      </p>
      <div class="card card--rows">
        <div v-for="(step, i) in scoringSteps" :key="i" class="step">
          <span class="step__num font-serif">{{ i + 1 }}</span>
          <div>
            <div class="step__title">{{ step.title }}</div>
            <div class="step__sub">{{ step.body }}</div>
          </div>
        </div>
      </div>

      <!-- AI Match Review -->
      <h2 class="section-title sec">AI Match Review</h2>
      <p class="lead">
        The <strong>AI Match Review</strong> is an on-demand, LLM-powered qualitative read of a
        single job against your CV and Profile — a requirement-by-requirement narrative covering
        what matches, what's missing, your strongest proof points and the keywords to mirror.
        It is <strong>advisory</strong> and sits <strong>alongside</strong> the deterministic
        star rating — never replaces it. The review <strong>emits no number, score or star</strong>;
        the deterministic 1–5 stars remain the authoritative rating, and they stay completely
        separate from the AI narrative.
      </p>
      <div class="card card--rows">
        <div v-for="(step, i) in reviewSteps" :key="i" class="step">
          <span class="step__num font-serif">{{ i + 1 }}</span>
          <div>
            <div class="step__title">{{ step.title }}</div>
            <div class="step__sub">{{ step.body }}</div>
          </div>
        </div>
      </div>

      <!-- Tailoring CVs and cover letters -->
      <h2 class="section-title sec">Tailoring CVs and cover letters</h2>
      <p class="lead">
        Tailoring drafts a job-specific CV and cover letter from your real CV and Profile, grounded
        in the evidence you already entered — nothing is invented. Drafts are
        <strong>advisory</strong> and <strong>ATS-targeted</strong>: they mirror the listing's
        keywords, run an ATS checklist, and sit alongside the deterministic stars rather than
        replacing them. Star <strong>never submits applications</strong> on your behalf — every
        draft leaves the app only when you press <strong>Copy</strong> or <strong>Export</strong>.
        Tailoring opens <strong>no new egress</strong> beyond the one-time "what is sent"
        disclosure you already accepted for CV structuring and AI Match Review; the same sanctioned
        OpenRouter channel is reused.
      </p>
      <div class="card card--rows">
        <div v-for="(step, i) in tailorSteps" :key="i" class="step">
          <span class="step__num font-serif">{{ i + 1 }}</span>
          <div>
            <div class="step__title">{{ step.title }}</div>
            <div class="step__sub">{{ step.body }}</div>
          </div>
        </div>
      </div>

      <!-- Job evaluation report -->
      <h2 class="section-title sec">Job evaluation report</h2>
      <p class="lead">
        The <strong>Job evaluation report</strong> is an on-demand, eight-block qualitative
        read of a single posting — <strong>A · Role Summary &amp; Employer Context</strong>,
        <strong>B · Match with CV (AI Match Review)</strong>,
        <strong>C · Level &amp; Strategy</strong>, <strong>D · Compensation</strong>,
        <strong>E · Tailored CV</strong>, <strong>F · Interview Prep</strong>,
        <strong>G · Legitimacy Signals</strong> and
        <strong>H · Cover Letter &amp; Apply</strong>. The report is <strong>advisory</strong>
        and sits <strong>alongside</strong> the deterministic Epic 5 star rating — never
        replaces it. The <strong>deterministic 1–5 stars carry the rating</strong>, the report
        <strong>emits no number, score, star or percentage</strong> of its own (words only),
        and the stars in the report header are read straight from the same scorer that backs
        the Job Board — so they stay <strong>authoritative</strong> and reproducible even
        when OpenRouter is down.
      </p>
      <div class="card card--rows">
        <div v-for="(step, i) in evalSteps" :key="i" class="step">
          <span class="step__num font-serif">{{ i + 1 }}</span>
          <div>
            <div class="step__title">{{ step.title }}</div>
            <div class="step__sub">{{ step.body }}</div>
          </div>
        </div>
      </div>

      <!-- Exporting to PDF -->
      <h2 class="section-title sec">Exporting to PDF</h2>
      <p class="lead">
        PDF export turns the current tailored draft into a polished, recruiter-grade PDF
        without leaving the app. It is <strong>render-only</strong> — Star compiles the draft
        you already see on screen and never edits the wording — and runs <strong>fully offline</strong>
        through a bundled LaTeX engine: no network call, no OpenRouter round-trip, no external
        toolchain to install. Every exported PDF is <strong>ATS-targeted</strong> by construction:
        <strong>single-column</strong> layout, <strong>selectable text</strong> (never a flattened
        image), <strong>embedded fonts</strong> so the document renders identically on any reader,
        and a <strong>locale-aware page size</strong> — Letter for en-US, A4 everywhere else.
      </p>
      <div class="card card--rows">
        <div v-for="(step, i) in pdfExportSteps" :key="i" class="step">
          <span class="step__num font-serif">{{ i + 1 }}</span>
          <div>
            <div class="step__title">{{ step.title }}</div>
            <div class="step__sub">{{ step.body }}</div>
          </div>
        </div>
      </div>

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
    body: 'Upload a PDF or DOCX on Onboarding step 1 or the Profile screen. Star reads it on this device, asks OpenRouter to structure the text into Profile fields (only after a one-time "what is sent" disclosure), and shows the result for review — or lets you enter it manually if you skipped the AI key.',
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
    body: 'Open Settings → Job sites, paste a URL, and press Add. Star normalises the URL and saves the site locally so it survives a restart. Each site has an Active toggle that controls whether it appears as a tab on Discover.',
  },
  {
    title: 'Open a site on Discover',
    body: 'Every active job site shows as a tab along the top of the Discover page. Click a tab to load that site in the embedded browser; the URL pill reflects the current page. Switch a site off with its Active toggle in Settings to hide its tab without removing it.',
  },
  {
    title: 'Move back and forward',
    body: 'Use the back/forward chevrons in the browser chrome to step through pages within the loaded site, just like a normal browser tab.',
  },
  {
    title: 'Remove sites you no longer want',
    body: 'Back in Settings → Job sites, hit Remove next to any site to drop it — its tab disappears from Discover straight away. To hide a site temporarily instead, switch its Active toggle off.',
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

const cvProfileSteps = [
  {
    title: 'Upload your CV on Onboarding step 1',
    body: 'Drag a PDF or DOCX into the dropzone, or use the file picker — other file types are rejected with a clear message and there is a 10MB cap. The file is saved locally and never uploaded for text extraction.',
  },
  {
    title: 'Star reads the file on this device',
    body: 'Text extraction runs off the UI thread, so the app stays responsive while it works — you will see a progress line during upload, extraction, and structuring. The CV binary and its extracted text live only on this device.',
  },
  {
    title: 'Confirm the "what is sent" disclosure',
    body: 'The first time Star is about to send CV text to OpenRouter, it shows a one-time disclosure of exactly what is sent and to which provider. Structuring only proceeds once you accept it, and it requires a saved OpenRouter key plus a chosen default model from Settings → LLM integration.',
  },
  {
    title: 'Review the parsed Profile',
    body: 'On Onboarding step 2, Star shows the structured result — name, contact, target role, skills, employment history, education, years of experience and location. Fields the model was not confident about are flagged for you to confirm or correct; edit anything inline and remove skill chips you don\'t want before continuing.',
  },
  {
    title: 'No key? Enter your profile manually',
    body: 'If you skipped the OpenRouter key, or parsing fails, or the file is unsupported, Star offers Retry, Upload a different file, or Enter manually — never a dead-end. Manual entry fills the same Profile fields you would otherwise review.',
  },
  {
    title: 'Replace your CV later from the Profile screen',
    body: 'On the Profile screen, the CV card shows the current file name, when it was uploaded and its parse status. Drag a new file onto the Replace dropzone — Star records a new versioned CV and re-derives the Profile from it, without silently losing earlier data.',
  },
  {
    title: 'Tune your Profile, work mode, salary and links',
    body: 'The Profile screen is the editable source of truth — target role, skills, years of experience, location, work mode (Remote / Hybrid / On-site), minimum salary and currency, LinkedIn URL and portfolio links. Every edit is saved locally and survives a restart.',
  },
  {
    title: 'Watch the profile-strength rail',
    body: 'The strength rail reflects real completeness rather than a fixed number — it exposes its rubric so you can see which fields raise it and by how much. The minimum-scorable gate (target role + at least one skill + location + work mode) is called out separately; the UI lists what is still missing before jobs can be scored. Editing any scoring-relevant field marks existing scores stale.',
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

const scoringSteps = [
  {
    title: 'The four factors',
    body: 'Star compares the listing against your Profile across four factors — Skills (coverage of your skills against the title + description, with a small alias map so things like "k8s" still match "Kubernetes"), Experience (your years of experience versus what the listing asks for), Location (your location and work mode — Remote, Hybrid or On-site — versus the listing\'s location and workplace type), and Salary (the listing\'s stated range versus your minimum + currency).',
  },
  {
    title: 'How to read the breakdown',
    body: 'Open any job to see the per-factor breakdown on the job-detail screen. Each factor shows a bar, a sub-score and a one-line rationale — the matched skills, the gap, or the compared values — so you can see exactly why the global percentage came out where it did. The included factors are weighted and the weighted average equals the percentage at the top; nothing is hidden.',
  },
  {
    title: 'Excluded factors are labelled, not zeroed',
    body: 'When a factor can\'t be evaluated — for example, a listing with no stated salary, or a Profile with no salary target — Star marks the factor "excluded" rather than scoring it zero. The remaining factors re-normalise so an absent signal never drags the score down; the breakdown shows the excluded label so you know the score reflects only what was actually compared.',
  },
  {
    title: 'Dashboard STRONG count and top matches',
    body: 'The Dashboard surfaces the score in two places: the stat strip\'s STRONG number counts your ★4-and-up strong matches, and Top matches today lists the highest-scoring jobs so the strongest ones are one click away.',
  },
  {
    title: 'Re-scoring stale jobs after a Profile edit',
    body: 'Scoring-relevant Profile fields — target role, skills, years of experience, location, work mode, minimum salary — mark existing scores stale the moment you edit them. The Profile screen calls out the stale count and offers a Re-score action that runs the scorer over the affected jobs off the UI thread, so the breakdown reflects the Profile you have now.',
  },
  {
    title: 'Why scores stay stable when OpenRouter is down',
    body: 'Scoring is deterministic and lives entirely in the app — it makes no model call. Even with no OpenRouter key configured and no internet connection, every job on your board still gets a star rating and a percentage match, and the same inputs always produce the same answer.',
  },
];

const reviewSteps = [
  {
    title: 'Open a job and generate the review',
    body: 'Open any job from the board to bring up the Job-detail modal. The AI Match Review section sits beneath the deterministic star breakdown — when no review is cached, it shows a Generate review button. Press it to produce a one-off narrative read of this specific job against your CV and Profile.',
  },
  {
    title: 'Requires an OpenRouter key and a default model',
    body: 'The review is an LLM feature, so it needs a saved OpenRouter key plus a selected default model under Settings → LLM integration. Without them, Generate review is disabled and Star explains exactly what is missing — no key, or no default model — and links you to where to set it.',
  },
  {
    title: 'One-time "what is sent" disclosure on first send',
    body: 'The first time you generate a review, Star shows a one-time disclosure of exactly what is sent and to which provider: the job description text plus your CV text and Profile, going only to OpenRouter (the same sanctioned egress used for AI Extract and CV structuring — this feature opens no new egress). The review only proceeds once you accept it.',
  },
  {
    title: 'Read the narrative — and only the narrative',
    body: 'The result is structured words, never a number: a short fit summary, a requirement-by-requirement mapping with the matching CV/profile evidence (or "not found" — never invented), gaps classified as blocker or nice-to-have with a concrete mitigation each, your strongest proof points and ATS keywords to mirror. The section is badged AI · advisory with provenance ("AI review · {model} · {date}") so it is visually distinct from the deterministic stars.',
  },
  {
    title: 'Stale reviews and regenerate',
    body: 'Reviews are cached per job and survive restart, so opening the same job later shows the same narrative. When you edit your CV or Profile, or the job is re-extracted, Star marks the cached review may be out of date and offers Regenerate — which runs a fresh structured call against the current inputs. Regenerate is always available, even on a fresh review.',
  },
  {
    title: 'Error states by code',
    body: 'If the OpenRouter key is missing, Star shows a no-key message that points to Settings → LLM integration instead of attempting the call. If the model returns an error or the network fails, you see a model error with a Retry. If the chosen default model is not function-calling capable (the structured output the review needs), Star shows a model-not-capable message and asks you to pick a different default — the deterministic stars are unaffected either way.',
  },
];

const tailorSteps = [
  {
    title: 'Open Tailoring from Starred',
    body: 'On the Starred page, every job has a Generate button. Click it to deep-link into the Tailor view for that role — Star drafts a tailored CV and a cover letter from your current CV and Profile. The button is disabled until you have a saved OpenRouter key and a default model under Settings → LLM integration, with hover text telling you exactly what is missing.',
  },
  {
    title: 'Switch between the Tailored CV and Cover letter tabs',
    body: 'Tailor opens with two tabs along the top — Tailored CV and Cover letter. The CV tab shows a side-by-side diff against your base CV; the Cover letter tab shows an editable draft addressed to the role and company from the listing. Both tabs share the same draft and the same provenance badge ("AI draft · advisory · {model} · {date}").',
  },
  {
    title: 'Read the diff against your base CV',
    body: 'On the Tailored CV tab, the base CV sits on the left and the tailored version on the right. Added wording is highlighted, removed wording is struck through, and unchanged text stays plain — so you can see at a glance what the model rewrote and why. The draft is grounded in your CV; the model is not allowed to invent tokens that are not already in your evidence.',
  },
  {
    title: 'Accept or Dismiss suggestions — with a live deterministic rescore',
    body: 'A Star suggestions dock lists each rewrite with its category, rationale and projected gain. Accept folds the change into the draft and triggers an immediate Epic 5 rescore against the same posting — the live MATCH chip in the top bar updates as soon as the deterministic scorer finishes. Dismiss drops the suggestion without changing the draft. The accept path never calls the LLM and never writes the deterministic match scores directly; the 1–5 stars remain authoritative.',
  },
  {
    title: 'Watch the ATS checklist',
    body: 'Below the suggestions, the ATS checklist scores the draft against rules that real applicant-tracking systems care about — heading presence, keyword placement, punctuation normalisation, machine-readability. Each rule shows pass (✓) or fail (✗) with a short detail; failing keywords are listed under "Missing keywords" as chips so you know which ones the draft still has not absorbed.',
  },
  {
    title: 'Choose the tailoring intensity',
    body: 'The top bar carries an intensity toggle — Light touch (default) or Aggressive. Light touch keeps your CV close to the original and only nudges wording to match the role; Aggressive rewrites more broadly when the job is a stretch. Switching intensity re-generates the draft using the same evidence; nothing else changes.',
  },
  {
    title: 'Answer gap prompts on the cover letter',
    body: 'When the listing asks for something your evidence does not clearly cover — domain, start date, seniority, language — the cover letter surfaces an Open questions panel rather than silently papering over the gap. Each question carries Confirm and Not applicable buttons so you answer in your own words. The textarea above is fully editable in place, and your edits flow through to Copy and Export unchanged.',
  },
  {
    title: 'Copy and Export — text or Markdown',
    body: 'Use the Copy button to put the current draft on the clipboard, Export text (cover letter only) to save plain text, or Export Markdown to save a Markdown file. These are the only ways a draft leaves the app — Star never submits the application for you, so you remain the human in the loop on every send.',
  },
  {
    title: 'Stale drafts and Regenerate',
    body: 'Drafts cache per job and survive restart. When you edit your CV or Profile, or the underlying job is re-extracted, Star marks the draft as may be out of date and surfaces a Regenerate button — a fresh structured call against the current inputs. If something goes wrong (no key, no default model, model not capable of structured output, rate limit or network error) the banner explains exactly which code fired and offers Try again when it makes sense.',
  },
];

const evalSteps = [
  {
    title: 'Open the Eval report from Starred',
    body: 'Every job on Starred matches has an Eval button. Click it to open the Job evaluation report for that posting — the eight A–H blocks are collapsible so you can focus on the ones that matter most. The header shows the same deterministic stars the Job Board shows, plus a legitimacy badge and a short verification note.',
  },
  {
    title: 'The deterministic Epic 5 stars carry the rating',
    body: 'The 1–5 stars and the 0–100 % match in the header come from the same local, deterministic scorer that lives entirely in the app — the Eval report itself emits no number, score, star or percentage. The eight A–H blocks are narrative-only: the stars remain the only authoritative rating, and the same inputs always produce the same answer.',
  },
  {
    title: 'Read the A–H blocks',
    body: 'Block A is the role summary and employer context. Block B reuses your existing AI Match Review (requirements, gaps, strengths). Block C is the level and application strategy. Block D compares the listing\'s stated compensation against your expectation, and adds a short market-band sentence with cited sources when web research is on. Block G surfaces legitimacy signals — a verdict of legitimate / suspicious / unknown and a verification note. Blocks E, F and H are CTAs into Tailoring, Interview Prep, and Cover Letter & Apply respectively.',
  },
  {
    title: 'Web research is opt-in, off by default, and local-only',
    body: 'Blocks A, D and G can optionally enrich their narrative with researched web text — employer context, market band, legitimacy signals. The Enable web research setting under Settings → Privacy is off by default and stored locally on this device; it never leaves the app. With it off, the report still generates, but Blocks D & G degrade to "as stated in the listing" and say so verbatim — nothing is silently inferred.',
  },
  {
    title: 'One-time "what is sent" disclosure',
    body: 'The first time you turn web research on and generate a report, Star shows a one-time disclosure of exactly what is sent and to which destinations: the search query and the URLs visited go to the search engine and the employer pages reached through the same embedded browser you use for Discover. Research only proceeds once you accept it.',
  },
  {
    title: 'Star reuses the same embedded browser — no new egress',
    body: 'Web research uses the shared webResearch capability, which drives the same embedded browser that already powers Discover and AI Extract, in the same partitioned session. There is no extra API key, no external HTTP API, and no new egress destination beyond what you already accepted for Discover and OpenRouter. Sources are recorded with the report so you can click through to verify them.',
  },
  {
    title: 'Anti-bot, CAPTCHA and login walls — Star never bypasses',
    body: 'If a search engine or employer page shows a CAPTCHA, login wall, paywall, or anti-bot interstitial, Star detects it and stops for that page — it never attempts to bypass it. Block G\'s legitimacy verdict becomes "unknown" with an "uncertain" note explaining what could not be verified, and Block D drops the market sentence and stays JD-stated only. The report is honest about what it could not check.',
  },
  {
    title: 'Stale reports, Regenerate and Export',
    body: 'Reports cache per job and survive restart. When you edit your CV or Profile, or the underlying job is re-extracted, Star marks the report "may be out of date" and offers Regenerate — a fresh structured call against the current inputs. Export sends the report (Markdown, Word or PDF) through the unified Export menu; Star never submits anything on your behalf.',
  },
];

const pdfExportSteps = [
  {
    title: 'Find Export PDF in the Tailor view',
    body: 'The Export PDF button sits in the top bar of the Tailor view and is visible on both the Tailored CV tab and the Cover-letter tab — whichever draft you have open is what gets rendered. The button is disabled until a tailored draft exists, so generate one first if you have not already.',
  },
  {
    title: 'Pick Letter or A4',
    body: 'Next to Export PDF, a Letter / A4 segmented switch chooses the page size. Star defaults by locale — Letter for en-US, A4 everywhere else — and remembers your choice for the session. Switching the toggle changes the page size of the next export; nothing in the draft is re-rendered until you press Export PDF again.',
  },
  {
    title: 'Save the PDF where you want it',
    body: 'Pressing Export PDF opens a save dialog so you choose where the file lands — Star never writes the PDF without asking, and never uploads it anywhere. The button shows a progress spinner while the bundled LaTeX engine compiles, then a toast confirms the saved path.',
  },
  {
    title: 'Reveal in folder',
    body: 'The success toast carries a Reveal in folder action that opens the saved PDF in Finder / Explorer with the file selected, so you can attach it to an application without digging through your filesystem. The provenance of every export (model, date, page size, file path) is recorded locally for your reference.',
  },
  {
    title: 'ATS guarantees baked into every export',
    body: 'Every PDF Star emits is single-column, has selectable text (not a flattened image), embeds its fonts (Latin Modern) so it renders identically on any reader, and uses the locale-appropriate page size. These are guarantees of the template — there is no option that disables them — so the PDF stays machine-readable for applicant-tracking systems.',
  },
  {
    title: 'Error states — compile error',
    body: 'If the bundled LaTeX engine cannot compile the draft (rare — usually an unsupported character that slipped through normalisation), the Export PDF button reports "PDF compile failed" with the underlying engine message and offers Retry. Nothing is written to disk on a compile error, and the draft you see on screen is untouched.',
  },
  {
    title: 'Error states — toolchain missing',
    body: 'If the bundled LaTeX engine is not found on disk — for example because the app install is corrupt — Star shows "The bundled LaTeX engine was not found. Reinstall the app to restore PDF export." No external LaTeX installation is ever required, expected, or attempted; the engine is the one Star ships with.',
  },
  {
    title: 'Licence and attribution',
    body: 'The bundled LaTeX engine is Tectonic (MIT) and the embedded fonts are the Latin Modern family under the GUST Font License. The CV / cover-letter template is structurally inspired by the MIT-licensed career-ops project but contains none of its text or code. Full notices live in NOTICE.md at the repo root; if you redistribute Star Job Search, you must preserve that file.',
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
    q: 'Why are there no tabs on Discover?',
    a: 'You haven\'t added an active job site yet. Open Settings → Job sites, add one and make sure its Active toggle is on — it\'ll appear as a tab on Discover straight away.',
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
