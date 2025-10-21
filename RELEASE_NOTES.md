<!--
INSTRUCTIONS FOR DEVELOPERS:

This file contains release notes for the CURRENT VERSION ONLY.

Before each release:
1. Update the sections below with changes for the upcoming version
2. Replace placeholder text (in HTML comments) with actual changes
3. Keep descriptions user-friendly and concise
4. Leave sections as-is if they don't apply - empty sections are automatically removed

After the release is built and synced:
1. The workflow uploads this file to R2
2. The backend API strips HTML comments and removes empty sections
3. Clean release notes are stored in the database
4. Clear this file and prepare it for the next release

Note:
- Everything in HTML comments will be automatically removed by the API
- Empty sections (with no content after comment removal) are automatically filtered out
- You don't need to manually delete unused sections
-->

### Added
<!-- - New features and capabilities added in this release -->

### Changed
<!-- - Changes to existing functionality -->

### Fixed
<!-- - Bug fixes and corrections -->

### Removed
<!-- - Features or functionality removed in this release -->
- Websocket Messages that are not errors or warnings are no longer in the client browser logs
- Excessive "noisy" server console logs are no longer displayed
- Several packages that are no longer used have been removed
<!--
Keep language user-friendly - these notes are shown to end users in the update dialog.
-->
