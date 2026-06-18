# BDD UC: Per-site Username (saved + surfaced for sign-in)

Status: TICKETS
Owner: human
Created: 2026-06-19
Last Updated: 2026-06-19

---

## Story

As a job seeker who has multiple job-site logins
I want to record an optional username for each Job site I configure
So that when I switch to that site's tab on Discover I can see the saved
username and copy it into the site's sign-in form — without hunting through
a password manager

---

## Acceptance Scenarios

### Scenario 1: Save a username for a configured site
Given I have at least one site in Settings → Job sites
When I type a username into the per-site username field and commit it
Then the value is persisted via the `sites:setUsername` IPC channel
And the value re-appears on that row after I restart the app

### Scenario 2: Leave the username blank
Given a site row with no saved username
When I view the Settings Job-sites list
Then the username field renders empty with a placeholder
And no username is shown alongside the corresponding tab on Discover

### Scenario 3: See the saved username on the active Discover tab
Given a site that has a saved username
When I select that site's tab on Discover
Then the saved username is displayed alongside the embedded browser
And a copy button is shown next to it

### Scenario 4: Silently copy the displayed username
Given the saved username is visible alongside the active Discover tab
When I click the copy button
Then the username is written to the system clipboard
And no toast or confirmation message is shown

### Scenario 5: Switch tabs to a site with no saved username
Given the active tab shows a saved username and copy button
When I switch to another tab whose site has no saved username
Then the username and copy button are no longer rendered

### Scenario 6: Clear a previously saved username
Given a site with a saved username
When I empty the username field in Settings and commit
Then the persisted value is cleared
And the username + copy button disappear from the Discover tab

---

## Notes

The username is a free-text optional field — Star never submits it. The
copy action is intentionally silent (no `$q.notify` / "Copied" toast) so the
flow stays minimal: glance → copy → paste into the site's own sign-in
form. Persistence lives in the main-process SQLite `sites` table
(SITEUSR-001); the Settings input is wired through `store.setSiteUsername`
(SITEUSR-002); the Discover surface lives next to the existing tab chrome
(SITEUSR-003).

---

## References

- prd: docs/Product Requirements Document/PRD.md
- architecture: docs/Architecture/Architecture.md
