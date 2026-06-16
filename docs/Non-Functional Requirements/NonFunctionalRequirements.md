# Non-Functional Requirements

| ID | Sub-System | Description | Status | Epic |
|----|-----------|-------------|--------|------|
| NFR-001 | Embedded Browser | Embedded browser runs in a partitioned session isolated from app state (contextIsolation:true, nodeIntegration:false). | NEW | epic_01_EMBEDDED_JOB_SITE_BROWSER |
| NFR-002 | Embedded Browser | Only user-selected sites are loaded; one of the app's two sanctioned, auditable egress paths. | NEW | epic_01_EMBEDDED_JOB_SITE_BROWSER |
| NFR-003 | Embedded Browser | Loading a site and persisting the sites list never block the main UI thread. | NEW | epic_01_EMBEDDED_JOB_SITE_BROWSER |
| NFR-004 | Embedded Browser | Embedded browser and sites persistence work on macOS, Windows, and Linux from one codebase. | NEW | epic_01_EMBEDDED_JOB_SITE_BROWSER |
