# Non-Functional Requirements

| ID | Sub-System | Description | Status | Epic |
|----|-----------|-------------|--------|------|
| NFR-001 | Embedded Browser | Embedded browser runs in a partitioned session isolated from app state (contextIsolation:true, nodeIntegration:false). | NEW | epic_01_EMBEDDED_JOB_SITE_BROWSER |
| NFR-002 | Embedded Browser | Only user-selected sites are loaded; one of the app's two sanctioned, auditable egress paths. | NEW | epic_01_EMBEDDED_JOB_SITE_BROWSER |
| NFR-003 | Embedded Browser | Loading a site and persisting the sites list never block the main UI thread. | NEW | epic_01_EMBEDDED_JOB_SITE_BROWSER |
| NFR-004 | Embedded Browser | Embedded browser and sites persistence work on macOS, Windows, and Linux from one codebase. | NEW | epic_01_EMBEDDED_JOB_SITE_BROWSER |
| NFR-005 | CV & Profile | CV binary and parsed text are stored locally only; nothing leaves the device except the opted-in LLM structuring call. | NEW | Add CV to profile |
| NFR-006 | CV & Profile | The structuring call is the only outbound path and reuses Epic 2's existing OpenRouter egress; this epic opens no new egress path. | NEW | Add CV to profile |
| NFR-007 | CV & Profile | Text extraction runs off the UI thread; no main-thread block > 100 ms; UI stays responsive during upload/extraction/structuring. | NEW | Add CV to profile |
| NFR-008 | CV & Profile | Parse / LLM / file failures degrade gracefully (retry, different file, manual entry); never an unhandled crash or dead-end. | NEW | Add CV to profile |
| NFR-009 | CV & Profile | CV picker, file storage, and Profile/CV persistence work on macOS, Windows, and Linux, including graceful behaviour when no AI key is configured. | NEW | Add CV to profile |
