# BDD UC: Open Job Details from the Job Board

Status: TICKETS
Owner: human
Created: 2026-06-17
Last Updated: 2026-06-17

---

## Story

As a job seeker browsing the Job Board
I want to open a listing and see its full extracted details in a modal window
So that I can read the complete posting and review its score breakdown — without leaving the board

---

## Acceptance Scenarios

### Scenario 1: Open a listing to view its full details
Given I am on the Job Board with scored listings visible
When I click "Open" on a listing
Then a modal window opens showing the full extracted job details (title, company, location, work mode, salary, and full description)
And the modal shows the match score as stars and a percentage
And the modal shows the per-factor score breakdown (skills, experience, location, salary)
And the modal shows the source site with a link that opens the original posting in my browser

### Scenario 2: Close the modal and return to the board
Given a job details modal is open
When I close it (close button, Esc key, or clicking the backdrop)
Then the modal closes
And I am back on the Job Board with my scroll position and selection preserved

### Scenario 3: Open a job found on multiple boards
Given a listing was found on more than one site and collapsed into a single match
When I open that listing
Then the modal shows the job details once
And it lists every source site, each with its own link to the original posting

### Scenario 4: Open a job with no stated salary
Given a listing that did not advertise a salary
When I open it
Then the modal shows the salary as "not stated"
And the salary factor is labelled excluded in the score breakdown (not shown as a zero score)

---

## Notes

The "Open" affordance lives on each listing row/tile on the Job Board. The modal
is the in-place equivalent of the Job detail screen (mockup `04`) — same content,
surfaced over the board rather than as a separate route. Star score uses
`StarRating.vue`; the per-factor breakdown uses `ScoreBar.vue`. Source links open
the original posting in the user's external browser (Star never submits or applies).

---

## References

- prd: docs/Product Requirements Document/PRD.md
- architecture: docs/Architecture/Architecture.md
