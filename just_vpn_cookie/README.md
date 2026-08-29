# 江苏科技大学 WebVPN 自动登录 & Cookie 提取

自动完成 `vpn2.just.edu.cn`（江苏科技大学 WebVPN / 统一身份认证平台）的登录，并把登录后获得的 Cookie 保存到本地文件，供其他程序（curl、脚本、爬虫等）使用。

## ✨ 功能

- 🔐 自动完成 CAS 统一身份认证登录（账号 + 密码）
- 🔑 密码使用与页面 JS **完全一致**的 RSA 加密（纯 Python 实现，**零第三方依赖**）
- 🔗 自动跟随 CAS ticket 回调，获取最终 WebVPN 会话 Cookie
- ✅ 登录后自动访问**检测地址**验证会话有效性
- 💾 Cookie 双格式输出：
  - `just_vpn_cookies.json` — 结构化 JSON（供 Python/requests 使用）
  - `just_vpn_cookies.txt` — Netscape 格式（供 `curl -b` 使用）

## 📁 文件说明

| 文件 | 说明 |
|---|---|
| `just_vpn_login.py` | 主程序（唯一需要运行的脚本） |
| `.env` | 配置文件，填写账号密码（**密码不要提交到 Git**） |
| `README.md` | 本说明 |
| `just_vpn_cookies.json` | 登录成功后输出的 Cookie（JSON） |
| `just_vpn_cookies.txt` | 登录成功后输出的 Cookie（Netscape 格式） |

## 🚀 快速开始

### 1. 配置账号密码

编辑同目录下的 `.env` 文件：

```ini
VPN_USERNAME=你的学号
VPN_PASSWORD=你的密码
```

> 密码也可以留空，运行时程序会安全提示输入（不显示在屏幕上）。

### 2. 运行

```bash
# 登录并提取 Cookie
python just_vpn_login.py

# 登录 + 用 Cookie 访问检测地址验证会话
python just_vpn_login.py 测试
```

### 3. 查看结果

程序运行成功后，控制台会打印提取到的所有 Cookie，并生成两个文件：

- **`just_vpn_cookies.json`** — 结构化数据
- **`just_vpn_cookies.txt`** — 浏览器格式

## 🔧 配置项

所有可配置项都位于 `just_vpn_login.py` 顶部：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `BASE_URL` | `https://vpn2.just.edu.cn/` | WebVPN 入口地址 |
| `CHECK_URL` | `https://client.v.just.edu.cn/https/webvpn764a2e4853ae5e537560ba711c0f46bd/` | 登录后的会话检测地址（指向门户首页） |
| `CHECK_URL`备选方案 | `https://client.v.just.edu.cn/https/webvpn5e450e4df63d1d975727042c5bc4b19e2145ba81088ec8390b46b776c759a213/speedtest/backend/getIP.php?isp=true&distance=km&enlink-vpn` | 同济大学教育网测速站（可通过IP ASN是否属于China Education and Research Network Center判断） |

环境变量（来自 `.env`）：

| 变量 | 说明 |
|---|---|
| `VPN_USERNAME` | 学号 / 工号 / 别名 |
| `VPN_PASSWORD` | 密码（留空则运行时输入） |

## 🍪 Cookie 使用示例

### curl（必须加 `-L`）

> ⚠️ **重要**：WebVPN 网关对首次访问会返回 302，重定向到同 URL 并追加 `?enlink-vpn` 参数（网关握手）。
> **curl 必须加 `-L` 自动跟随重定向**，否则会一直停在 302。

```bash
# 正确用法（-L 跟随重定向）
curl -L -b just_vpn_cookies.txt "https://client.v.just.edu.cn/https/webvpn764a2e4853ae5e537560ba711c0f46bd/"

# 访问门户首页（等价）
curl -L -b just_vpn_cookies.txt "https://vpn2.just.edu.cn/"
```

> 如果仍然 302，通常是因为 cookie 已过期——重新运行 `python just_vpn_login.py` 刷新即可。

### 浏览器中导入 Cookie（注意事项）

WebVPN 网关的会话机制比较特殊：**它不只校验 cookie 值，还会校验服务端会话状态**。因此：

1. **直接用浏览器开发者工具手动添加 cookie 可能无效**——网关在页面导航时会对「访客」强制刷新 `ENSSESSIONID`/`GUESTSESSIONID`，覆盖你添加的值。
2. **推荐方式**：使用浏览器扩展（如 EditThisCookie）一次性导入 `just_vpn_cookies.json` 里的全部 cookie（包含 `clientInfo`），然后**直接访问检测地址 URL**，不要先访问 `vpn2.just.edu.cn` 入口（入口会触发新的访客握手）。
3. Cookie 有**时效性**（`vpn_timestamp` 是登录时间戳），导入后尽快使用。

> 如果浏览器复现仍失败，最稳妥的用法是**保持使用 curl / 脚本**，cookie 在命令行场景下是稳定有效的。

### Python requests

```python
import json, requests

with open("just_vpn_cookies.json", encoding="utf-8") as f:
    data = json.load(f)

s = requests.Session()
for c in data["cookies"]:
    s.cookies.set(c["name"], c["value"], domain=c["domain"], path=c["path"])

resp = s.get("https://client.v.just.edu.cn/https/webvpn764a2e4853ae5e537560ba711c0f46bd/")
print(resp.status_code)  # 200 = 会话有效
```

## 🛠 技术细节（供二次开发）

### 登录流程

```
vpn2.just.edu.cn
   └─(301)→ ids.v.just.edu.cn            # WebVPN 网关
        └─(302)→ ids.v.just.edu.cn/      # 种 GUESTSESSIONID
             └─(302)→ client.v.just.edu.cn/https/webvpnXXX/
                  └─(302)→ .../cas/login?service=...   # CAS 登录页
                       └─ POST 表单（RSA 加密密码）
                            └─(302)→ .../enlink/...?ticket=ST-XXX   # CAS 票据
                                 └─(302)→ 门户首页                 # 会话 Cookie 生效
```

### 已踩过的坑

1. **`:443` 端口污染**：网关重定向 Location 会拼出带 `:443` 的 URL，导致 SSO `gate` 参数和 CAS `service` 参数都带 `:443`，CAS 直接返回「未认证授权的服务」。**解法**：跟随重定向时手动规范化，把 `https://client.v.just.edu.cn:443/` 去掉 `:443`（需禁用 urllib 自动重定向）。

2. **gzip 压缩**：服务器强制返回 gzip 内容（即使客户端没声明 `Accept-Encoding`），需要手动解压。

3. **RSA 加密**：密码用 1024 位 RSA 公钥加密（指数 `010001`），输出固定 256 字符 hex。纯 Python `pow()` 即可实现，与浏览器 JS 输出完全一致（已验证）。

4. **execution token**：每次访问登录页都会生成，需从表单 HTML 中提取。

## ⚠️ 安全提醒

- `.env` 文件包含你的密码，**不要**提交到 Git / 分享给他人
- Cookie 等同你的登录凭证，同样注意保管
- 本工具仅用于个人合法用途
