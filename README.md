# macOS notifications for DeepSeek Harness

Six native notification switches inside the DeepSeek Harness configuration window. The section uses the host `Switch` and `Button` components, and the interface ships English and Simplified Chinese.

English | [中文](README.zh.md)

## Install

Install from the DeepSeek Harness Plugins page, or from the command line:

```sh
dsh plugin --profile <profile> add dsh-macos-notifications
```

Then enable **macOS Notifications** in the configuration window and grant the browser notification permission. If macOS still hides banners, allow DeepSeek Harness in System Settings.

## Compatibility

The plugin declares the host support window `>=0.2.0-rc.2 <0.3.0-0`. Every 0.2.x host release, candidates included, satisfies it; a 0.3 release needs a new plugin release. `dsh-macos-notifications: check:host-support` fails when a pin leaves the window or when the host `next` channel moves past it.

## Events

| Event             | Default |
| ----------------- | ------- |
| Approval waiting  | On      |
| Question for you  | On      |
| Task completed    | On      |
| Subtask completed | Off     |
| Task error        | On      |
| Turn completed    | Off     |

The Host stores the six booleans under `DSH_HOME/macos-notifications/settings.json`. Without `DSH_HOME`, the Host uses `~/.dsh`. Changes apply immediately and persist across restarts.

## Behaviour

Open the configuration window after activation. Select the macOS notification section. Press the permission button before the test button.

A permission grant reconnects the event stream with `ready=1`. Only one permitted window receives each event, and another window takes over when the receiver disconnects. Notifications require an open DSH window and its Host connection.

Click an event notification to open its exact session through `ctx.uiWorkspace.openSession`. A test notification only focuses the DSH window. Notifications contain fixed labels, never transcript content or tool arguments.

## Build and test

Use Node.js 22 or later.

```sh
pnpm install
pnpm run build
pnpm run test
```

The build copies the Host ESM modules into `lib` and creates `lib/client.js` as a `window.__ModuleLoader__.load` factory named after the package. The factory requests React and the DSH primitive library from the existing client module table. The build accepts only this package closed module graph and rejects unsupported import or export syntax.

Tests load the built factory with mocked DSH primitives, HTTP, event streams, and notifications. They do not request system permission or send real notifications. They cover the native controls, localized labels, authenticated request marker, permission reconnect, navigation, deduplication, and disposal.

## Limitations

Focus mode and system notification preferences can hide notifications after the system accepts them. Browser permission status does not establish that macOS shows a banner. The test status distinguishes submission from the Notification API show event.

## License

MIT. See [LICENSE](LICENSE).
