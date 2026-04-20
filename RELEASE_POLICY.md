# Release and Retention Policy

## Release Build Requirements
Every stable release (indicated by a Git Tag) **must** contain compiled build files/artifacts attached to the release for all supported platforms (Ubuntu Debian package, Android APK).

## Version Retention Policy
To manage storage and ensure users are on secure, up-to-date software, we adhere to a strict version retention policy for downloadable artifacts.

At any given time, **only a maximum of 5 versions** are allowed to be downloaded from the primary release channels.

These 5 versions are strictly defined as:

1.  **Latest Patch** (e.g., v2.1.2) - The current, most up-to-date version.
2.  **Previous Patch 1** (e.g., v2.1.1)
3.  **Previous Patch 2** (e.g., v2.1.0)
    *(Note: This accounts for 3 patch versions from the latest minor series)*
4.  **Previous Latest Minor Version** (e.g., v2.0.x) - The highest patch release of the previous minor series.
5.  **Previous Major Version** (e.g., v1.x.x) - The final release of the previous major series.
    *   **Caveat for Major Versions:** Previous major versions receive **no security coverage**. They are allowed to be downloaded *only* until a known vulnerability is discovered in that specific version, at which point the downloads for that version will be removed.
