# Verification

This file records live acceptance results. It covers one tested configuration, not a general guarantee.

## 2026-10-17: refactor against host 0.2.1-rc.2

The plugin moved to the host support window `>=0.2.0-rc.2 <0.3.0-0` with an exact `0.2.1-rc.2` build mirror. The build produced `lib` with no warnings, `node --test test/*.test.js` passed 16 tests, and `node scripts/check-host-support.mjs` reported one window over four host packages with a baseline inside it. These are automated results; the macOS banner and click acceptance below remains the only live observation, and it predates this refactor.

## 2026-10-06: live acceptance

On 2026-10-06, the standalone plugin built with the bundled Node executable. The command `node --test test/*.test.js` passed 14 tests with zero failures. Tests cover the registered client factory, native DSH controls, configuration saves, permission reconnects, duplicate suppression, click navigation, disposal, Host authentication, receiver election, event classification, and persistence.

The profile manager installed and enabled `dsh-macos-notifications` in the current desktop profile. Live Client Inspect reported an active `dsh-macos-notifications` occupant in `settings.section`. The profile manager disabled `@wingsky-1/dsh-notifier` without uninstalling it.

The user confirmed that the test notification appeared in macOS and clicking it brought DSH forward. The user then switched to another DSH session and clicked a real question notification. The user confirmed that the click returned to the exact originating conversation. These are user-observed acceptance results, not browser automation results.

The installed application passed `codesign --verify --deep --strict`. A separate browser visit to the existing loopback URL returned HTTP 401, so that browser did not validate the settings page. No replacement server or application restart was used.

Approval, task completion, error, and subagent notifications have automated event-classification coverage. They were not each manually exercised in macOS. Notifications require a running, connected renderer. Notification callbacks do not survive application exit or page reload. Multiple connected windows elect one receiver. macOS Focus and notification preferences can suppress banners.
