# 适用于 DeepSeek Harness 的 macOS 通知

在 DeepSeek Harness 配置窗口中提供六类系统通知开关。该分区使用宿主 `Switch` 与 `Button` 组件，界面同时提供英文与简体中文。

[English](README.md) | 中文

## 安装

在 DeepSeek Harness 的插件页安装，或用命令行：

```sh
dsh plugin --profile <profile> add dsh-macos-notifications
```

然后在配置窗口启用「macOS 通知」，并授予浏览器通知权限。如果 macOS 仍然不显示横幅，请在系统设置中允许 DeepSeek Harness 发送通知。

## 兼容范围

插件声明宿主支持窗口 `>=0.2.0-rc.2 <0.3.0-0`。0.2.x 的每个宿主版本（含候选版）都满足该范围；宿主发布 0.3 时需要新的插件版本。任何一个 pin 离开窗口，或宿主 `next` 通道越过上界，`pnpm run check:host-support` 都会失败。

## 事件

| 事件       | 默认 |
| ---------- | ---- |
| 审批等待   | 开   |
| 向你提问   | 开   |
| 任务完成   | 开   |
| 子任务完成 | 关   |
| 任务出错   | 开   |
| 轮次完成   | 关   |

Host 把这六个布尔值存放在 `DSH_HOME/macos-notifications/settings.json`。没有 `DSH_HOME` 时使用 `~/.dsh`。修改立即生效，并在重启后保留。

## 行为

激活后打开配置窗口，选择 macOS 通知分区。请先按权限按钮，再按测试按钮。

授权成功后会以 `ready=1` 重连事件流。同一时刻只有一个获得权限的窗口接收事件；接收方断开后由另一个窗口接管。通知需要 DSH 窗口处于打开状态并保持 Host 连接。

点击事件通知会通过 `ctx.uiWorkspace.openSession` 打开对应会话。测试通知只聚焦 DSH 窗口。通知内容只有固定文案，不包含对话正文或工具参数。

## 构建与测试

需要 Node.js 22 或更高版本。

```sh
pnpm install
pnpm run build
pnpm run test
```

构建把 Host 的 ESM 模块复制到 `lib`，并把 `lib/client.js` 生成为以包名命名的 `window.__ModuleLoader__.load` 工厂。该工厂从既有客户端模块表请求 React 与 DSH 原语库。构建只接受本包的封闭模块图，并拒绝不受支持的 import 与 export 语法。

测试在模拟的 DSH 原语、HTTP、事件流与通知环境下加载构建产物，不申请系统权限，也不发送真实通知。覆盖范围包括原生控件、本地化文案、鉴权请求标记、权限重连、跳转、去重与释放。

## 限制

专注模式与系统通知偏好可能在系统接受通知之后仍不显示横幅。浏览器权限状态并不能证明 macOS 会显示横幅。测试状态区分的是「提交」与 Notification API 的 show 事件。

## 许可证

MIT，见 [LICENSE](LICENSE)。
