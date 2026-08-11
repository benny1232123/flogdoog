# 我们的小星球 · 情侣主题网站

温馨、移动端友好的纯静态情侣网站：双人主页、照片墙、恋爱时间轴 / 纪念日、留言板 + 私密互动，并支持**点击 / 拖拽上传图片与视频**。

---

## 一、项目来源与授权

| 项目 | 说明 |
| --- | --- |
| **基础开源项目** | [MoLeft/LoveDiary-Timeline](https://github.com/MoLeft/LoveDiary-Timeline) |
| **授权方式** | **MIT**（已随仓库附 `LICENSE`，版权 © 2025 MoLeft） |
| **技术栈** | 纯 HTML + CSS + 原生 JavaScript，无框架、无构建步骤、无后端依赖 |

### 二次开发的具体改动点

在保留原项目「时间轴 + JSON 配置驱动」骨架的基础上，做了以下定制：

1. **双人主页（原项目无）**：新增 `couple` 配置与双卡片展示（头像、MBTI、城市、签名、标签、主题色）。
2. **照片墙（原项目无）**：新增 `gallery` + 瀑布流布局，支持静态配置与**本地上传**混合渲染。
3. **纪念日 / 恋爱计时**：在 `anniversaries` 基础上扩展 `type`（周年 / 生日岁数），新增按天 / 周 / 月 / 年实时倒计时与「已在一起 N 天」统计。
4. **留言板 + 私密互动（原项目无）**：`messages` 模块，localStorage 持久化，支持双方小号互撩。
5. **点击 / 拖拽上传图片视频（核心新增）**：`js/media.js` 用 **IndexedDB** 存大文件，自动压缩图片（最长边 1800px、JPEG q=0.86）、抽取视频封面帧，照片墙与灯箱无缝融合，可逐张删除。
6. **锁屏 + 主题切换**：6 位密码锁屏（可设有效期）、明 / 暗主题 `data-theme`，均为配置驱动。
7. **移动端适配**：桌面顶部导航 + 移动端底部 Tab 栏（含安全区 `env(safe-area-inset-*)` 适配），断点 1100 / 900 / 720 / 430px。
8. **配置单源化**：所有内容集中在 `data/config.json`，改文案 / 图片 / 日期无需碰代码。

> 改动仅在前端，未修改原项目的 MIT 授权；如需二次分发请保留 `LICENSE`。

---

## 二、目录结构

```
.
├─ index.html          # 主页面（结构 + 锁屏 / 灯箱 / 上传器挂载点）
├─ css/
│  ├─ base.css         # 设计变量、重置、锁屏、导航、动画
│  └─ style.css        # 业务组件样式（双人卡 / 照片墙 / 时间轴 / 上传器等）
├─ js/
│  ├─ media.js         # 上传存储层（IndexedDB + 压缩 + 视频封面）window.LPMedia
│  ├─ core.js          # 框架层：配置加载、锁屏、主题、计时、滚动揭示
│  └─ app.js           # 业务层：渲染各模块 + 上传器 + 灯箱交互
├─ data/
│  └─ config.json      # ★ 唯一内容源：站点信息 / 双人 / 纪念日 / 时间轴 / 照片 / 留言
├─ assets/
│  ├─ photos/          # 占位插画（可替换为真实照片）
│  └─ avatars/         # 双人头像占位
└─ LICENSE             # MIT
```

**改内容只看 `data/config.json`。** 例如换纪念日、加时间轴、改双人信息，都在这里；删掉 `assets/photos/photo-0X.svg` 换成你的图、并把 `src` 指过去即可。

---

## 三、本地运行（先看效果）

任意静态服务器均可，选一个：

```bash
# 方式 A：Python（最省事，装了 Python 就有）
cd E:\flogdoog
python -m http.server 8811
# 浏览器打开 http://127.0.0.1:8811

# 方式 B：Node
npx serve .
# 或 npx http-server -p 8811
```

> 不能直接双击 `index.html`（`file://` 协议下 `fetch config.json` 会被浏览器拦截）。必须用 http 服务器。

默认锁屏密码在 `data/config.json` 的 `site.password`（示例为 `520520`）。部署前请改成只有你们俩知道的密码，或把 `passwordEnabled` 设为 `false` 关闭。

---

## 四、部署方式

本项目是**纯静态站点**，所有主流静态托管都能一键部署。下面按「从易到难」给出 4 种。

### 1. GitHub Pages（免费、最稳）

> 你的 GitHub 连接器当前已连接，可直接在 GitHub 建仓库后推送。

```bash
cd E:\flogdoog
git init
git add .
git commit -m "feat: 情侣网站 v1"
# 在 github.com 新建一个仓库（如 our-planet），然后：
git branch -M main
git remote add origin https://github.com/<你的用户名>/our-planet.git
git push -u origin main
```

推送后在仓库 **Settings → Pages → Branch: main / root → Save**。几分钟后得到 `https://<用户名>.github.io/our-planet/`。

### 2. Vercel（免费、自动 HTTPS、国内访问尚可）

- 网页拖拽部署：把整个 `E:\flogdoog` 文件夹拖到 [vercel.com/new](https://vercel.com/new) 的「Deploy」框，零配置。
- 或 CLI：`npm i -g vercel && vercel`（按提示登录，默认框架选「Other」即可）。

### 3. Cloudflare Pages（免费、全球 CDN、国内通常最快）

- 连 Git 仓库：Dashboard → Pages → 创建项目 → 关联 GitHub 仓库 → 构建命令留空、输出目录留空（纯静态）→ 部署。
- 或直接上传：Pages → 直接上传 → 选 `E:\flogdoog` 文件夹。

### 4. 自有服务器 / Nginx（完全自控）

把整个目录拷到服务器，Nginx 配置示例：

```nginx
server {
    listen 80;
    server_name love.yourdomain.com;   # 换成你的域名
    root /var/www/our-planet;          # 站点目录
    index index.html;
    location / { try_files $uri $uri/ /index.html; }
    # 建议加 HTTPS（certbot）
}
```

---

## 五、手机访问

- 部署到上述任一平台后，直接用手机浏览器打开对应网址即可；移动端会自动切换为底部 Tab 栏。
- **本机调试用手机看**：电脑和手机连同一 WiFi，手机访问 `http://<电脑局域网IP>:8811`（如 `http://192.168.1.20:8811`）。Windows 查 IP：`ipconfig` 看「IPv4 地址」；注意关掉电脑防火墙对该端口的限制。
- 想用自己域名 + HTTPS：在域名商把记录指向托管平台，并在平台开启 SSL（Vercel / Cloudflare 默认给）。

---

## 六、关于「上传图片 / 视频」的重要说明（必读）

你要求「能点击上传图片视频」——**已经实现**，入口在照片墙顶部的「＋ 上传」按钮，支持点击选择、拖拽、多选，图片自动压缩、视频自动抽封面。

但有一点必须说清楚，因为它决定了这个功能的边界：

| 维度 | 当前实现（纯前端 + IndexedDB） |
| --- | --- |
| 存储位置 | 仅存在**你当前这台手机 / 电脑的这个浏览器**里 |
| 跨设备同步 | ❌ 不会同步。你手机传的不在对方手机上，反之亦然 |
| 换浏览器 / 清缓存 | ❌ 数据会被清掉（IndexedDB 跟随浏览器数据） |
| 是否需要后端 | ❌ 不需要，所以部署极简、零成本 |
| 适合场景 | 单方自用展示、临时收藏、演示 |

**结论**：当前方案 = 「零成本、秒部署、但不共享」。如果你想和对方**实时共享同一份照片墙**，必须加一个轻量后端或接云服务（见下一节）。

---

## 七、云端同步升级方案（把上传变成「真·共享」）

按「改动量 / 成本 / 跨设备」对比：

| 方案 | 改动量 | 成本 | 跨设备共享 | 适合谁 |
| --- | --- | --- | --- | --- |
| **A. 提交进 Git** | 极小 | 免费 | 需重新部署才更新 | 不常传、能接受「传完要重新发布」 |
| **B. 前端直传对象存储**（如 Cloudflare R2 / 阿里 OSS / 腾讯 COS + 临时凭证） | 中 | 低（按量） | ✅ | 想纯前端、又要多端同步 |
| **C. Serverless + 数据库**（Vercel + Blob Store / Supabase Storage） | 中 | 免费额度够用 | ✅ | 想要「传完对方立刻看到」 |
| **D. 自建后端**（Node/Express + 数据库 + 存储） | 大 | 服务器费用 | ✅ | 要完全自控、数据不出自己服务器 |

- **最简临时方案（A）**：把照片放进 `assets/photos/`、在 `config.json` 的 `gallery` 里加一条，然后重新部署。优点零成本；缺点每次传都要走一遍发布流程。
- **推荐「真共享」（C）**：在 Vercel 上挂一个 Storage（或 Supabase），把 `js/media.js` 的 `addFiles` 改成「压缩后直传存储、把 URL 写回共享数据库」。照片墙渲染从读 IndexedDB 改为读共享列表。改动集中在 `media.js` + `app.js` 的 `renderWall`，业务结构不用动。

> 如果你要「双方实时共享」，告诉我你倾向哪种（A 省事 / C 最像成品 / D 最自控），我可以直接帮你把上传改成该方案。

---

## 八、常见问题

- **打开是白屏 / 锁屏进不去？** 确认用 `http://` 访问（不是双击文件）；密码在 `config.json` 的 `site.password`。
- **上传的视频太大传不进去？** 单文件建议 < 60MB（超过会提示跳过）；可先在手机里压缩后再传。IndexedDB 容量跟随浏览器配额。
- **照片墙刷不出来？** 看控制台是否报 `config.json` 404——说明不是从 http 服务器打开的。
- **想换 logo / 配色？** 配色在 `css/base.css` 顶部的 CSS 变量（`--rose` / `--cream` 等），改一处全局生效。

---

_基于 MIT 授权的 LoveDiary-Timeline 二次开发 · 纯静态 · 移动端友好_
