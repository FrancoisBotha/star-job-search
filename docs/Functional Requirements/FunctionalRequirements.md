# Functional Requirements

| ID | Sub-System | Description | Status | Epic |
|----|-----------|-------------|--------|------|
| FR-001 | Embedded Browser | Embedded browser surface renders in the Discover page and loads an external job-site URL. | NEW | epic_01_EMBEDDED_JOB_SITE_BROWSER |
| FR-002 | Embedded Browser | User can add a job site on Settings; URL is normalised and persists locally across restarts. | NEW | epic_01_EMBEDDED_JOB_SITE_BROWSER |
| FR-003 | Embedded Browser | User can remove a stored job site on the Settings page. | NEW | epic_01_EMBEDDED_JOB_SITE_BROWSER |
| FR-004 | Embedded Browser | Discover shows a dropdown of stored sites, sourced from the same persisted list as Settings. | NEW | epic_01_EMBEDDED_JOB_SITE_BROWSER |
| FR-005 | Embedded Browser | Selecting a site from the Discover dropdown loads it in the embedded browser and reflects the active URL. | NEW | epic_01_EMBEDDED_JOB_SITE_BROWSER |
| FR-006 | Embedded Browser | Embedded browser supports back/forward navigation within the loaded site. | NEW | epic_01_EMBEDDED_JOB_SITE_BROWSER |
| FR-007 | CV & Profile | User can upload a CV (drag-drop or picker) on onboarding and Profile; PDF/DOCX accepted, other types rejected with a clear message. | NEW | Add CV to profile |
| FR-008 | CV & Profile | The uploaded CV's raw text is extracted locally, off the UI thread; the file is never uploaded for text extraction. | NEW | Add CV to profile |
| FR-009 | CV & Profile | Extracted text is structured into profile fields using Epic 2's saved OpenRouter key and selected default model. | NEW | Add CV to profile |
| FR-010 | CV & Profile | The parsed result is shown for review/edit with low-confidence fields flagged before the user proceeds. | NEW | Add CV to profile |
| FR-011 | CV & Profile | On parse failure, unsupported file, or no AI key, the user can retry, upload a different file, or enter the profile manually — no dead-end. | NEW | Add CV to profile |
| FR-012 | CV & Profile | Re-uploading a CV creates a new versioned CV record and re-derives the profile without silently losing data. | NEW | Add CV to profile |
| FR-013 | CV & Profile | A single editable Profile (target role, skills, experience, location, work mode, salary, links) persists locally and survives restart. | NEW | Add CV to profile |
| FR-014 | CV & Profile | Editing any Profile field persists it; the Profile is the single source of truth the later scoring epic reads. | NEW | Add CV to profile |
| FR-015 | CV & Profile | A profile-strength indicator is computed from field completeness and displayed, exposing its rubric. | NEW | Add CV to profile |
| FR-016 | CV & Profile | A minimum-scorable gate (target role + ≥1 skill + location + work mode) is enforced; editing a scoring-relevant field marks scores stale. | NEW | Add CV to profile |
| FR-017 | CV & Profile | A one-time "what is sent" disclosure appears before CV text is first sent to the model; structuring is disabled until a key is present. | NEW | Add CV to profile |
| FR-018 | CV & Profile | Onboarding steps 1–2 and the Profile screen are backed by real CV/Profile state, replacing the sample-data mocks. | NEW | Add CV to profile |
