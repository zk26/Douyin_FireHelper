<p align="center">
  <img src="https://free.picui.cn/free/2025/11/23/69226264aca4e.png" width="100" height="100" alt="续火花助手">
</p>

<h1 align="center">续火花助手</h1>

<p align="center">
  <strong>抖音聊天自动续火油猴脚本</strong>
</p>

<p align="center">
  <a href="https://github.com/zk26/Douyin_FireHelper/releases"><img src="https://img.shields.io/github/v/release/zk26/Douyin_FireHelper?style=flat-square" alt="Version"></a>
  <a href="https://github.com/zk26/Douyin_FireHelper/blob/main/LICENSE"><img src="https://img.shields.io/github/license/zk26/Douyin_FireHelper?style=flat-square" alt="License"></a>
  <img src="https://img.shields.io/badge/Tampermonkey-✅-brightgreen?style=flat-square" alt="Tampermonkey">
  <img src="https://img.shields.io/badge/平台-抖音-blue?style=flat-square" alt="Platform">
</p>

---

## 功能特性

| 功能 | 说明 |
|------|------|
| 🔍 **自动搜索** | 自动搜索并进入聊天窗口 |
| 👥 **多用户支持** | 支持批量用户，顺序/随机发送 |
| 🔥 **火花识别** | 自动识别火花天数、重燃状态、即将消失状态 |
| 📝 **消息模板** | 自定义消息，支持占位符动态替换 |
| 🔄 **自动重试** | 失败自动重试，指数退避，用户不存在自动跳过 |
| ⏰ **定时发送** | 支持固定时间或随机时间范围 |
| 📊 **状态面板** | 实时显示发送进度、火花天数、倒计时 |
| 📋 **历史日志** | 完整操作记录，支持导出 |
| 🌙 **深色/浅色** | macOS 风格毛玻璃 UI，支持主题切换 |
| 🔔 **后端回调** | 支持通知外部程序（可选） |

## 安装

### 1. 安装油猴扩展（不会的参考其他帖子）

- [Tampermonkey](https://www.tampermonkey.net/) (推荐)
- [Violentmonkey](https://violentmonkey.github.io/)

### 2. 安装脚本

**方式一：代码区复制 user.js 文件**

1. 前往 [Code](https://github.com/zk26/Douyin_FireHelper) 下载最新 `.user.js` 文件
2. 打开 Tampermonkey 管理面板
3. 点击 "+" 新建脚本
4. 粘贴代码并保存

**方式三：Raw 链接**

直接访问 `https://raw.githubusercontent.com/zk26/Douyin_FireHelper/main/DouyinFireHelper.user.js`，油猴会自动提示安装

## 使用方法

### 基本使用

1. 安装脚本后，打开 [抖音网页版私信](https://www.douyin.com/chat)
2. 页面右上角会出现 🔥 悬浮按钮，点击打开面板
3. 点击 **👥 用户** 选择要续火的好友
4. 设置发送时间（默认每天 00:01）
5. 等待自动执行，或点击 **立即发送**

### 面板说明

```
┌─────────────────────────────────────┐
│  ● ● ●  续火花助手                   │
│  ─────────────────────────────────── │
│  今日状态    │  用户状态              │
│  发送进度    │  重试次数              │
│  ─────────────────────────────────── │
│  下次发送    │  倒计时    │  火花天数  │
│  ─────────────────────────────────── │
│  [暂停] [定时] [重置]                 │
│  [设置] [日志] [用户] [天数]          │
│  ─────────────────────────────────── │
│  操作日志                            │
│  > 系统已就绪                        │
└─────────────────────────────────────┘

点击三个彩色圆点可最小化面板
最小化后火焰图标可拖拽移动
```

### 消息模板

支持三种状态的消息模板：

| 状态 | 默认模板 | 占位符 |
|------|----------|--------|
| 正常 | `续火 \| 火花已续 [天数] 天` | `[天数]` - 火花持续天数 |
| 重燃中 | `续火 \| 重燃中 [重燃进度]` | `[重燃进度]` `[重燃当前]` `[重燃总数]` |
| 即将消失 | `续火 \| 火花即将消失 [剩余天数]` | `[剩余天数]` - 剩余天数 |

### 设置说明

| 设置项 | 说明 |
|--------|------|
| 发送时间 | 固定时间或随机时间范围 |
| 随机时间 | 在指定范围内随机选择发送时间 |
| 启动延迟 | 页面加载后等待 N 秒再开始 |
| 最大重试 | 每个用户最多重试次数 |
| 后端回调 | 完成后通知本地服务（可选） |
| 发送模式 | 顺序发送 / 随机发送 |

## 架构设计

```
App (编排器)
├── Scheduler      - 定时调度
├── FSM            - 状态机
├── SearchService  - 用户搜索
├── ChatService    - 聊天控制
├── MessageService - 消息构建
├── SenderService  - 消息发送
├── RetryService   - 重试管理
├── StatsService   - 统计记录
├── HistoryService - 历史日志
├── CallbackService- 后端回调
└── UI             - 界面渲染
```

## 技术栈

- 原生 JavaScript (ES2022+)
- 油猴 API (GM_setValue, GM_xmlhttpRequest, etc.)
- Slate 编辑器交互
- CSS Backdrop Filter (毛玻璃效果)

## 浏览器兼容

| 浏览器 | 支持 |
|--------|------|
| Chrome + Tampermonkey | ✅ 完整支持 |
| Firefox + Tampermonkey | ✅ 完整支持 |
| Edge + Tampermonkey | ✅ 完整支持 |
| Safari + Userscripts | ⚠️ 部分支持 |

## 常见问题

**Q: 为什么搜索不到用户？**

A: 请确保：
- 用户名完全一致（包括大小写）
- 用户在你的私信列表中
- 页面已完全加载

**Q: 为什么发送失败？**

A: 常见原因：
- 网络不稳定（会自动重试）
- 聊天窗口加载超时
- 编辑器未就绪

**Q: 如何手动触发发送？**

A: 点击面板上的 **立即发送** 按钮，或使用油猴菜单

**Q: 火花天数显示不对？**

A: 火花天数从抖音页面读取，如果显示异常可以点击 **📅 天数** 手动设置

## 隐私说明

- 所有数据存储在本地浏览器 (GM_setValue)
- 不收集任何个人信息
- 不连接任何远程服务器（后端回调功能除外，仅连接 localhost）

## 开发

```bash
# 克隆仓库
git clone https://github.com/zk26/Douyin_FireHelper.git

# 安装脚本
# 将 DouyinFireHelper.user.js 复制到 Tampermonkey

# 测试
# 打开 https://www.douyin.com/chat 查看效果
```

## 更新日志

### v5.2.1

- 修复多用户顺序发送卡住的问题
- 优化发送等待时间，加快多用户处理速度
- 简化界面按钮布局
- 优化天数逻辑：优先使用自动识别的天数
- 三个彩色圆点都可最小化面板
- 最小化图标支持拖拽移动

### v4.0.0

- 全新架构设计，模块化重构
- 新增火花"即将消失"状态识别
- 修复状态机事件不触发的问题
- 改进发送成功判断逻辑
- 严格聊天对象验证，防止误发
- 添加用户不存在检测，跳过无效重试
- 优化日志批量写入性能
- 随机模式改为队列制，体验更稳定

### v3.0.0

- 多用户支持
- 火花天数识别
- 重燃状态检测
- 自动重试机制
- 毛玻璃 UI 界面

## 许可证

[MIT License](LICENSE)

## 免责声明

本脚本仅供学习交流使用。使用本脚本产生的任何后果由用户自行承担。请遵守抖音平台相关规定。

## 支持

- [提交 Issue](https://github.com/zk26/Douyin_FireHelper/issues)
- [提交 PR](https://github.com/zk26/Douyin_FireHelper/pulls)

---

<p align="center">
  如果觉得有用，请给个 ⭐ Star 支持一下！
</p>
