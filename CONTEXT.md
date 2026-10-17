# CONTEXT.md

Domain vocabulary for reviewers and agents. Use these terms exactly.

| Term             | Meaning                                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Host             | The DeepSeek Harness process. It owns the plugin lifecycle and the HTTP routes this plugin registers.                                       |
| Renderer         | The browser window. It renders the settings section and raises system notifications.                                                        |
| Settings section | The configuration-window section this plugin contributes through the host `slots` service.                                                  |
| Event kind       | One of the six notification triggers: intent to use the switch identifiers `ask`, `question`, `done`, `subagent-done`, `error`, `turn-end`. |
| Notice           | One bounded notification payload the Host delivers to the renderer over the event stream.                                                   |
| Receiver         | The one permitted renderer window that accepts notices. A newer receiver takes over when the current one disconnects.                       |
| Support window   | The host version range this plugin declares: `>=0.2.0-rc.2 <0.3.0-0`.                                                                       |
| Build baseline   | The exact host version the repository installs for building and tests.                                                                      |
