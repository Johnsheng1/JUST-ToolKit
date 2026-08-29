# 江苏科技大学 WebVPN 快速跳转器

一个 Tampermonkey（油猴）用户脚本，在 `client.v.just.edu.cn` 域下提供悬浮按钮和弹窗，输入内网主机名即可自动编码拼装 WebVPN URL 并跳转。

---

## 目录

- [功能](#功能)
- [安装](#安装)
- [使用方法](#使用方法)
- [工作原理](#工作原理)
- [WebVPN URL 编码机制（逆向分析）](#webvpn-url-编码机制逆向分析)
- [内置加密引擎（纯 JS AES-128）](#内置加密引擎纯-js-aes-128)
- [已知系统对照表](#已知系统对照表)
- [故障排查](#故障排查)
- [扩展与自定义](#扩展与自定义)
- [法律与合规声明](#法律与合规声明)

---

## 功能

- **悬浮按钮**：右下角圆形蓝色按钮，点击展开/收起跳转面板。
- **智能输入**：支持多种输入格式，自动提取主机名并加密：
  - 纯主机名：`jwxt.just.edu.cn`
  - 完整 URL：`https://jwxt.just.edu.cn/jwglxt/xtgl/login_slogin.html`
  - 带端口：`jwgl.just.edu.cn:8080`
  - 带查询参数：`http://lib.just.edu.cn:8080/opac/search?q=test`
- **协议选择**：HTTPS / HTTP 下拉切换。
- **快捷跳转**：内置 7 个常用系统一键直达。
- **零外部依赖**：内置完整 AES-128 实现，不引用任何外部 JS 库，无需网络请求，CSP 严格环境下也能运行。

---

## 安装

1. 安装浏览器扩展 [Tampermonkey](https://www.tampermonkey.net/)（Chrome / Edge / Firefox 均支持）。
2. 打开 Tampermonkey 控制面板 → 选择「添加新脚本」（或直接双击 `just-webvpn-jumper.user.js` 文件，浏览器会自动弹出 Tampermonkey 安装界面）。
3. 粘贴脚本内容并保存（Ctrl+S）。
4. 打开任意 `client.v.just.edu.cn` 页面，右下角出现蓝色 `⟳` 按钮即安装成功。

> 需要处于已登录状态（有有效 SESSION cookie），WebVPN 才会放行后续访问。

---

## 使用方法

| 操作 | 说明 |
|---|---|
| 点击右下角 `⟳` 按钮 | 打开 / 关闭跳转面板 |
| 输入主机名 → 点击「前往」或按回车 | 生成编码 URL 并跳转 |
| 切换 HTTPS / HTTP | 部分老系统（如教务管理 8080 端口）需用 HTTP |
| 点击快捷 chip | 一键跳转到对应系统 |

**输入示例：**

```
jwxt.just.edu.cn                              → https://client.v.just.edu.cn/https/webvpn12738b.../
https://jwxt.just.edu.cn/jwglxt               → .../https/webvpn12738b.../jwglxt
jwgl.just.edu.cn:8080（选 HTTP）               → .../http/webvpneb26120c.../
```

---

## 工作原理

WebVPN 本质上是一个反向代理：

```
浏览器 ──> https://client.v.just.edu.cn/<协议>/webvpn<编码>/<路径> ──> 内网真实服务器
```

目标主机名被编码进 URL 路径，WebVPN 服务端解码后把请求转发到对应的内网系统。本脚本做的事情就是**复刻客户端的编码过程**，让用户不用去门户里找链接、不用记忆那一长串乱码，直接输入主机名即可。

核心流程：

```
用户输入主机名
      │
      ▼
AES-128-CBC 加密（key = IV = "CASB2021EnLink!!"，PKCS7 填充）
      │
      ▼
密文转十六进制字符串
      │
      ▼
拼装 https://client.v.just.edu.cn/<协议>/webvpn<hex>/
      │
      ▼
浏览器跳转，WebVPN 放行
```

---

## WebVPN URL 编码机制（逆向分析）

### 1. URL 结构

```
https://client.v.just.edu.cn/<协议>/webvpn<十六进制密文>/
```

- `<协议>`：`http` 或 `https`，由目标系统支持决定。
- `<十六进制密文>`：目标主机名的 AES 密文。

### 2. 编码规律

| 主机名字符数 | AES 输出块数 | 密文 hex 长度 | 示例 |
|---|---|---|---|
| ≤ 15 字节 | 1 块 | 32 hex | `my.just.edu.cn` → `764a2e4853ae5e537560ba711c0f46bd` |
| 16 字节 | 2 块 | 64 hex | `jwxt.just.edu.cn` → `12738b...cd8ed` |
| ≥ 17 字节 | 3 块 | 96 hex | — |

**判定方法**：hex 长度 = 32 的整数倍，即一个 AES 块（16 字节）。

### 3. 密钥与 IV

通过逆向 `webvpn/bundle.debug.js` 提取：

- **密钥（key）= IV** = `CASB2021EnLink!!`（16 字节 ASCII，正好是 AES-128 的 key 长度）
- 这是 WebVPN 厂商 **易安联（EnLink）** 的固定密钥，硬编码在前端 JS 中。

> 逆向过程：bundle 中有一段混淆字符串 `"\6\4\7\5\1\3\1\b\c\0\a\8\0\9\2\2"` 配合替换表 `"x6e|x32|x21|x30|x41|x42|x43|x53|x69|x6b|x4c|x31|x45"`，通过一个自制 base36 反混淆函数解出原始 hex `4341534232303231456e4c696e6b2121`，再转 ASCII 即得 `CASB2021EnLink!!`。

### 4. 加密算法

```
Cipher:    AES-128-CBC
Key:       CASB2021EnLink!!   (UTF-8 字节)
IV:        CASB2021EnLink!!   (与 key 相同)
Padding:   PKCS7
Output:    ciphertext 转十六进制小写字符串
```

等价的前端实现（原 bundle 中的 CryptoJS 调用）：

```javascript
CryptoJS.AES.encrypt(
  CryptoJS.enc.Utf8.parse(hostname),
  CryptoJS.enc.Utf8.parse('CASB2021EnLink!!'),
  {
    iv:   CryptoJS.enc.Utf8.parse('CASB2021EnLink!!'),
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7
  }
).ciphertext.toString();   // 就是 webvpn 后面的 hex
```

### 5. Python 复现（供参考/调试）

```python
from Crypto.Cipher import AES
from Crypto.Util.Padding import pad

KEY = b"CASB2021EnLink!!"

def webvpn_encode(hostname: str) -> str:
    cipher = AES.new(KEY, AES.MODE_CBC, iv=KEY)
    ct = cipher.encrypt(pad(hostname.encode(), 16))
    return ct.hex()

def webvpn_url(hostname: str, protocol: str = "https") -> str:
    code = webvpn_encode(hostname)
    return f"https://client.v.just.edu.cn/{protocol}/webvpn{code}/"

print(webvpn_url("jwxt.just.edu.cn"))
# https://client.v.just.edu.cn/https/webvpn12738b7746cb46ff465fb0bca782b8a72738b83605805ff098e4d664058cd8ed/
```

---

## 内置加密引擎（纯 JS AES-128）

脚本未使用 Web Crypto API 或 CryptoJS，而是内置了一个完整的 AES-128 实现，原因是：

1. **Web Crypto 的 AES-CBC 强制自动填充**，无法关闭 PKCS7，与 WebVPN 的填充行为不一致（实测多出一个块），需要额外手写块级逻辑。
2. **不依赖外部 CDN**，在校园网或 CSP 严格环境下更稳定。
3. **完全自包含**，脚本单文件即插即用。

实现的算法细节：

- **密钥扩展**：标准 AES-128 KeyExpansion（11 轮密钥，176 字节扩展密钥）。
- **加密轮**：SubBytes（S-box 查表）→ ShiftRows → MixColumns → AddRoundKey，共 10 轮。
- **CBC 链**：每个明文块先与前一块密文 XOR，再加密；首块 XOR IV。
- **PKCS7**：明文补齐到 16 字节倍数，填充字节 = 填充长度。

**已知编码验证（脚本内置测试通过）：**

| 主机名 | 编码结果 | 与 bundle 一致 |
|---|---|---|
| `my.just.edu.cn` | `764a2e4853ae5e537560ba711c0f46bd` | ✅ |
| `www.just.edu.cn` | `fd41ac578b5685e950caacdccd49f215` | ✅ |
| `jwxt.just.edu.cn` | `12738b7746cb46ff465fb0bca782b8a72738b83605805ff098e4d664058cd8ed` | ✅ |
| `caiwu.just.edu.cn` | `b03a129e0143584081c9c83229cb8b5fd1685de8e9d1c4eda238260840af0d3d` | ✅ |
| `jwgl.just.edu.cn:8080` | `eb26120c0b61d26f61ce45ea5ef07bf864a455884ca2133c138748630669de2c` | ✅ |
| `vfdm.just.edu.cn` | `0dd87b6288ae6b60a8712076184e12c2bcdd2ea7bc23aaed1fd9378611679b09` | ✅ |
| `client.v.just.edu.cn` | `efed14796aa6da68a7cb2f4159109e0763c8caee3b4f122b544baa956b1a84cc` | ✅ |

---

## 已知系统对照表

以下编码均从 bundle 硬编码或实测验证得出：

| 系统 | 主机名 | WebVPN 编码 |
|---|---|---|
| 我的门户 | `my.just.edu.cn` | `764a2e4853ae5e537560ba711c0f46bd` |
| 学校官网 | `www.just.edu.cn` | `fd41ac578b5685e950caacdccd49f215` |
| 教务系统 | `jwxt.just.edu.cn` | `12738b7746cb46ff465fb0bca782b8a72738b83605805ff098e4d664058cd8ed` |
| 财务系统 | `caiwu.just.edu.cn` | `b03a129e0143584081c9c83229cb8b5fd1685de8e9d1c4eda238260840af0d3d` |
| 教务管理(8080) | `jwgl.just.edu.cn:8080` | `eb26120c0b61d26f61ce45ea5ef07bf864a455884ca2133c138748630669de2c` |
| 统一认证辅助 | `vfdm.just.edu.cn` | `0dd87b6288ae6b60a8712076184e12c2bcdd2ea7bc23aaed1fd9378611679b09` |
| 门户自身 | `client.v.just.edu.cn` | `efed14796aa6da68a7cb2f4159109e0763c8caee3b4f122b544baa956b1a84cc` |

### WebVPN 直通域名白名单（`/webvpn/passthrough_domain`）

以下域名不经过编码代理，直接访问：

```
202.195.195.89:8081
202.195.195.89:8090
hqfw.just.edu.cn
qq-web-other.cdn-go.cn
ssl.captcha.qq.com
qq-web.cdn-go.cn
unified-auth.chaoxing.com
rescdn.qqmail.com
client.v.just.edu.cn
imp2.just.edu.cn
exmail.qq.com
open.weixin.qq.com
purl.org
ns.adobe.com
dp.just.edu.cn
```

---

## 故障排查

| 现象 | 可能原因 | 处理 |
|---|---|---|
| 页面提示 502 | 上游应用服务器不可达 / 需校内网络 | 编码本身正确，换时间段或连校园网重试 |
| 400 No SSL certificate | 目标系统要求客户端证书 | 系统侧认证要求，非脚本问题 |
| 跳到登录页 | SESSION 过期 / 未登录 | 重新登录门户后再用 |
| 脚本不生效 | 未匹配域名 / 未保存 / 浏览器缓存 | 确认 URL 是 `client.v.just.edu.cn`，刷新页面 |
| HTTP 系统打不开 | 协议选错 | 老系统（如 8080 端口）切换到 HTTP |

---

## 扩展与自定义

### 添加快捷系统

编辑脚本开头的 `COMMON` 数组：

```javascript
const COMMON = [
  { name: '我的门户', host: 'my.just.edu.cn' },
  { name: '新系统',   host: 'newname.just.edu.cn' },  // ← 加在这里
  // ...
];
```

### 修改密钥（不推荐）

如果学校的 WebVPN 厂商更换密钥，更新 `WEBVPN_KEY` 常量：

```javascript
const WEBVPN_KEY = 'CASB2021EnLink!!';
```

> 密钥来自前端 bundle 逆向，若学校升级系统改变了密钥，重新从 `/webvpn/bundle.debug.js` 提取即可。

### 调整弹窗样式

所有样式集中在 `injectUI()` 内的 `<style>` 标签，按需修改。

---

## 法律与合规声明

- **仅供个人学习、研究与便捷访问使用**。请在校园网使用政策允许的范围内使用本脚本。
- 脚本仅做 **URL 编码的复刻**，不绕过任何认证、不破解密码、不访问未授权资源。
- 编码密钥 `CASB2021EnLink!!` 是厂商公开的前端代码，非加密破解。
- 请勿用于任何违法、违规或影响他人正常使用的用途。使用者自行承担相关责任。
- 如学校明确禁止此类自动化工具，请停止使用并删除脚本。

---

## 项目文件

```
just-webvpn-jumper/
├── just-webvpn-jumper.user.js   # 油猴脚本（单文件，即插即用）
└── README.md                    # 本说明文档
```

---

*逆向分析 + 脚本开发：Johnsheng1 · 2026-08*
