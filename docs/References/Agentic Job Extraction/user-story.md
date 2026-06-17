# BDD User Stories — Job Search Co-pilot

These stories describe the system's behaviour from the user's perspective, in
Given/When/Then form suitable for driving acceptance tests.

## Personas

**Sam** — a job seeker who searches several job sites, applies filters, and wants to
review and triage matching roles inside one app instead of across browser tabs.

## Ubiquitous language

- **Listing** — a job site's results page after Sam has logged in and applied filters.
- **Embedded browser** — the Chromium view inside the app where Sam browses and logs in.
- **AI Extract** — the action that imports jobs from the current listing into the board.
- **Job board** — the app's internal, persistent list of imported jobs.
- **Source id** — the stable identity of a posting, derived from its URL.
- **Not interested** — a triage status that hides a job and excludes it from future imports.

---

## Feature: Import jobs from a listing into the internal board

> As Sam, I want to import every job from my filtered search with one click,
> so that I can review them inside the app instead of on the site.

```gherkin
Background:
  Given the app is open
  And I have opened my job search site in the embedded browser
  And I have logged in and applied my filters

Scenario: First extraction imports all listed jobs
  When I click "AI Extract"
  Then every job across all result pages is imported
  And each imported job appears on my job board
  And I see a summary such as "Imported 42 of 42 listed"

Scenario: Each job is captured in detail
  When I click "AI Extract"
  Then each imported job has at least a title and a company
  And, where the posting provides them, it also has location, salary,
      employment type, posted date, and the full description

Scenario: Extraction spans multiple result pages
  Given my filtered search returns more results than fit on one page
  When I click "AI Extract"
  Then the app advances through result pages until none remain or a page limit is reached
  And jobs from every visited page are imported
```

---

## Feature: Incremental import of only new jobs

> As Sam, I want re-running extraction to bring in only postings I haven't seen,
> so that I am not re-reviewing the same jobs.

```gherkin
Scenario: Re-extraction imports only new postings
  Given I have already imported jobs from this search
  And new postings have since appeared in the listing
  When I click "AI Extract" again
  Then only the postings not already on my board are imported
  And no previously imported job is duplicated
  And the summary reports how many were skipped as already imported

Scenario: Nothing new to import
  Given I have already imported all current postings
  When I click "AI Extract" again
  Then no jobs are added to my board
  And I see that 0 new jobs were imported

Scenario Outline: Stable identity per posting across sites
  Given a job posting URL "<url>"
  Then its source id is derived as "<sourceId>"

  Examples:
    | url                                                                  | sourceId                       |
    | https://www.linkedin.com/jobs/view/?currentJobId=3891234567          | www.linkedin.com:3891234567    |
    | https://www.indeed.com/viewjob?jk=abc123                             | www.indeed.com:abc123          |
    | https://boards.greenhouse.io/acme/jobs/4567890?gh_jid=4567890        | boards.greenhouse.io:4567890   |
```

---

## Feature: Triage the internal job board

> As Sam, I want to mark jobs I'm not interested in,
> so that my board stays focused and those jobs never come back.

```gherkin
Scenario: Flag a job as not interested
  Given a job is on my board
  When I mark it "Not interested"
  Then it is hidden from my default board view
  And it remains stored so it is never re-imported

Scenario: Not-interested jobs are excluded from future imports
  Given I marked a posting "Not interested"
  And that posting still exists in the listing
  When I click "AI Extract" again
  Then that posting is not imported again

Scenario: Restore a job I previously dismissed
  Given a job is marked "Not interested"
  When I restore it
  Then it appears in my default board view again

Scenario: Open a board job in the embedded browser
  Given a job is on my board
  When I click "Open" on that job
  Then the embedded browser navigates to that job's page
```

---

## Feature: Non-disruptive background extraction

> As Sam, I want extraction to run in the background,
> so that I can keep using the app while it works.

```gherkin
Scenario: My view is not hijacked during extraction
  Given I am viewing a page in the embedded browser
  When I click "AI Extract"
  Then the crawl runs in a hidden window
  And the page I am viewing does not change

Scenario: My login is reused for the crawl
  Given I am logged in to the job site
  When extraction runs
  Then the hidden crawler accesses the site as my logged-in session
  And I am not asked to log in again

Scenario: Live progress while extracting
  When extraction is running
  Then I see progress updates such as "Found 30 jobs" and "Extracted 12/18"
  And the AI Extract button is disabled until the run finishes
```

---

## Feature: Resilience and unfamiliar sites

> As Sam, I want extraction to handle new sites and failures gracefully,
> so that I can trust the board's contents.

```gherkin
Scenario: First time on a new job site
  Given I have never extracted from this site before
  When I click "AI Extract"
  Then the app learns the page layout once
  And it reuses that layout on subsequent runs without re-learning

Scenario: Extraction fails partway
  Given something goes wrong during a run
  When the run cannot complete
  Then I see a clear failure message
  And jobs already saved to my board remain intact
  And my board is not left in a corrupted or partial state
```

---

## Feature: Safety and boundaries

> As Sam, I want the app to respect my credentials and the sites I use,
> so that automation never puts me at risk.

```gherkin
Scenario: The app never handles my credentials
  Given a job site requires login
  Then I log in myself in the embedded browser
  And the app does not capture, store, or enter my credentials

Scenario: An anti-bot challenge stops automation
  Given the job site presents a CAPTCHA or bot check
  When extraction encounters it
  Then the app does not attempt to bypass it
  And extraction stops and informs me

Scenario: Requests are throttled
  When extraction runs
  Then requests to the job site are paced at a reasonable rate
  And the crawl stops at a configured page limit
```
