# -*- coding: utf-8 -*-
"""
江苏科技大学 WebVPN (vpn2.just.edu.cn) 自动登录 & Cookie 提取程序
============================================================
功能：
  1. 自动完成 CAS 统一身份认证登录（账号+密码）
  2. 密码使用与页面 JS 一致的 RSA 加密（纯 Python 实现，无第三方依赖）
  3. 跟随 CAS ticket 回调，获取最终 WebVPN 会话 Cookie
  4. 自动验证 Cookie（访问 CHECK_URL 检测会话有效性）
  5. Cookie 持久化：
     - cookies.json     (requests 可直接 load 的格式)
     - cookies.txt      (Netscape 格式，可用于 curl / wget / 浏览器扩展)

用法：
  1. 编辑同目录 .env 文件，填入 VPN_USERNAME / VPN_PASSWORD
     （密码留空则运行时安全提示输入）
  2. python just_vpn_login.py          # 登录并提取 Cookie
     python just_vpn_login.py 测试     # 登录后用 Cookie 访问检测地址验证

依赖：
  仅 Python 标准库 (urllib) —— 不需要 requests/rsa/bs4
"""

import sys
import os
import re
import json
import time
import getpass
import http.cookiejar
import urllib.request
import urllib.parse
import ssl

# 目标入口
BASE_URL = "https://vpn2.just.edu.cn/"

# 登录成功后的会话检测地址（用于验证 Cookie 是否有效）
# 默认指向 WebVPN 门户首页
CHECK_URL = "https://client.v.just.edu.cn/https/webvpn764a2e4853ae5e537560ba711c0f46bd/"

# ============ 账号密码从 .env 读取 ============
def _load_env():
    """读取同目录 .env 文件（若存在）并载入环境变量"""
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if not os.path.exists(env_path):
        return
    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            # 只设置尚未存在的，避免覆盖真实环境变量
            os.environ.setdefault(key, val)

_load_env()

USERNAME = os.environ.get("VPN_USERNAME", "")
PASSWORD = os.environ.get("VPN_PASSWORD", "")

# RSA 公钥（从页面 security.js / login.js 中硬编码提取）
RSA_MODULUS_HEX = (
    "008aed7e057fe8f14c73550b0e6467b023616ddc8fa91846d2613cdb7f7621e3"
    "cada4cd5d812d627af6b87727ade4e26d26208b7326815941492b2204c3167ab2"
    "d53df1e3a2c9153bdb7c8c2e968df97a5e7e01cc410f92c4c2c2fba529b3ee988"
    "ebc1fca99ff5119e036d732c368acf8beba01aa2fdafa45b21e4de4928d0d403"
)
RSA_EXPONENT_HEX = "010001"
RSA_CHUNK_SIZE = 126   # 由 setMaxDigits(131) 推导，与页面 JS 一致


# --------------------------------------------------------------------------
# RSA 加密（复刻页面 RSAUtils.encryptedString，纯 Python）
# --------------------------------------------------------------------------
def rsa_encrypt_password(password: str) -> str:
    """
    复刻 JS:
      RSAUtils.setMaxDigits(131)
      key = getKeyPair("010001", '', MODULUS)
      result = RSAUtils.encryptedString(key, password)

    结果：hex 字符串，块与块之间以空格分隔，总长固定 256 字符（1024位密钥）
    """
    modulus = int(RSA_MODULUS_HEX, 16)
    exponent = int(RSA_EXPONENT_HEX, 16)

    # 1) 字符 → charCode 数组
    a = [ord(c) for c in password]

    # 2) 补 0 至 chunkSize 的整数倍
    while len(a) % RSA_CHUNK_SIZE != 0:
        a.append(0)

    # 3) 每 chunkSize 字节为一个块，两字节一组（低位在前）拼成大整数
    #    block.digits[j] = a[k] + (a[k+1] << 8)
    #    对应数值：Σ (byte_lo + byte_hi<<8) << (16*j)
    blocks = []
    for i in range(0, len(a), RSA_CHUNK_SIZE):
        block_int = 0
        for j in range(RSA_CHUNK_SIZE // 2):
            byte_lo = a[i + j * 2]
            byte_hi = a[i + j * 2 + 1]
            block_int |= (byte_lo + (byte_hi << 8)) << (16 * j)
        # 4) RSA 幂模运算
        crypt = pow(block_int, exponent, modulus)
        blocks.append(format(crypt, 'x'))

    # 5) 空格连接
    return ' '.join(blocks)


# --------------------------------------------------------------------------
# 使用标准库 urllib 实现（无第三方依赖模式）
# --------------------------------------------------------------------------
class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """禁用自动重定向，完全手动控制，以便对重定向 URL 做规范化"""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class StdlibClient:
    def __init__(self):
        self.opener = None
        self.cookies = http.cookiejar.CookieJar()
        self.headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36"
            ),
            "Accept-Language": "zh-CN,zh;q=0.9",
        }
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE  # VPN 入口自签名证书常见，放宽校验
        handler = urllib.request.HTTPCookieProcessor(self.cookies)
        self.opener = urllib.request.build_opener(handler, _NoRedirect())

    def get(self, url, referer=None, max_redirects=10):
        req = urllib.request.Request(url, headers=dict(self.headers))
        if referer:
            req.add_header("Referer", referer)
        return self._open(req, max_redirects)

    def post(self, url, data, referer=None, max_redirects=10):
        body = urllib.parse.urlencode(data).encode()
        req = urllib.request.Request(url, data=body, headers=dict(self.headers))
        req.add_header("Content-Type", "application/x-www-form-urlencoded")
        if referer:
            req.add_header("Referer", referer)
        return self._open(req, max_redirects)

    @staticmethod
    def _normalize_url(url):
        """
        关键修复：WebVPN 网关在重定向 Location 中拼出带 :443 的 URL，
        导致后续 SSO 的 gate 与 CAS 的 service 参数都带 :443，
        CAS 会判定「未认证授权的服务」。
        跟随重定向时对 client.v.just.edu.cn 去掉显式 :443（https 默认端口）。
        """
        return url.replace("https://client.v.just.edu.cn:443/", "https://client.v.just.edu.cn/")

    def _open(self, req, max_redirects=10):
        """跟随重定向并返回 (最终URL, 响应体bytes)"""
        import gzip
        for _ in range(max_redirects):
            try:
                resp = self.opener.open(req, timeout=30)
            except urllib.error.HTTPError as e:
                # 302/303 之类可能被 HTTPError 抛出，取其中的 Location
                resp = e
            code = getattr(resp, 'code', None)
            location = resp.headers.get('Location')
            if location and code in (301, 302, 303, 307, 308):
                # 处理相对重定向，并对 client.v.just.edu.cn 去掉 :443
                url = urllib.parse.urljoin(req.full_url or req.get_full_url(), location)
                url = self._normalize_url(url)
                req = urllib.request.Request(url, headers=dict(self.headers))
                continue
            body = resp.read()
            # 自动解压 gzip（服务器强制 gzip 时不看 Accept-Encoding）
            if resp.headers.get('Content-Encoding', '').lower() == 'gzip':
                try:
                    body = gzip.decompress(body)
                except Exception:
                    pass
            final_url = resp.geturl()
            resp.close()
            return final_url, body
        raise RuntimeError("重定向次数过多")

    def set_cookie_str(self, name, value, domain, path="/"):
        """手动写入 cookie（用于跨域无法自动捕获的情况）"""
        from http.cookiejar import Cookie
        c = Cookie(
            version=0, name=name, value=value, port=None, port_specified=False,
            domain=domain, domain_specified=True, domain_initial_dot=False,
            path=path, path_specified=True, secure=True, expires=None,
            discard=True, comment=None, comment_url=None, rest={}, rfc2109=False,
        )
        self.cookies.set_cookie(c)

    def cookie_dict(self):
        return {c.name: c.value for c in self.cookies}

    def cookie_list(self):
        return [
            {
                "name": c.name,
                "value": c.value,
                "domain": c.domain,
                "path": c.path,
                "secure": c.secure,
                "expires": c.expires,
            }
            for c in self.cookies
        ]


# --------------------------------------------------------------------------
# 登录主流程
# --------------------------------------------------------------------------
def do_login(client):
    print("[1/5] 访问 WebVPN 入口 ...")
    final_url, body = client.get(BASE_URL)
    print(f"      跳转至: {final_url}")
    page_html = body.decode("utf-8", errors="replace")

    # 提取表单 action 与 execution token
    m_action = re.search(r'<form[^>]+action="([^"]*login[^"]*)"', page_html)
    login_url = urllib.parse.urljoin(final_url, m_action.group(1)) if m_action else final_url
    m_exec = re.search(r'name="execution"\s+value="([^"]+)"', page_html)
    if not m_exec:
        print("[!] 未找到 execution token，页面可能已登录或结构变化")
        print("    页面片段:", page_html[:500])
        return False
    execution = m_exec.group(1)
    print(f"      登录表单: {login_url}")
    print(f"      execution: {execution[:40]}...")

    # 构造登录表单数据（与页面 JS 提交一致）
    encrypted_pwd = rsa_encrypt_password(PASSWORD)
    form_data = {
        "username": USERNAME,
        "password": encrypted_pwd,
        "execution": execution,
        "_eventId": "submit",
        "encrypted": "true",
        "loginType": "1",
        "submit": "登 录",
    }

    print("[2/5] 提交登录表单（RSA 加密密码）...")
    final_url2, resp2 = client.post(login_url, form_data, referer=final_url)
    print(f"      提交后跳转: {final_url2}")
    cookies_after = client.cookie_dict()
    print(f"      当前 Cookie: {list(cookies_after.keys())}")

    # 判断是否登录成功
    if "ticket=" in final_url2 or "/enlink/" in final_url2:
        print("[3/5] 已获取 CAS ticket，跟随回调 ...")
        # 再 GET 一次让 opener 跟随 CAS callback → 设置 WebVPN 会话
        final_url3, body3 = client.get(final_url2, referer=final_url2)
        print(f"      最终 URL: {final_url3}")
        # 回调可能再 302 到门户首页，继续跟随直到拿到 HTML 页面
        for _ in range(5):
            final_url3, body3 = client.get(final_url3, referer=final_url3)
            if b"<" in body3[:300] or "vpn2.just.edu.cn" in final_url3:
                break
        print(f"      门户 URL: {final_url3}")
    else:
        # 检查是否出现错误信息
        err_kws = ["密码错误", "用户名或密码", "账号或密码", "账号锁定", "错误", "失败",
                   "验证码", "登录失败", "账号被", "disabled", "locked"]
        text = resp2.decode("utf-8", errors="replace")
        hit = [kw for kw in err_kws if kw.lower() in text.lower()]
        if "error" in final_url2 or "login" not in final_url2 or hit:
            print("[!] 登录可能失败")
            # 提取错误信息（表单中 swiSpan1 或 errMsg 等位置）
            m = re.search(r'form-tab-nav[^>]*>\s*([^<]+?)\s*</span>', text) or \
                re.search(r'id="errMsg"[^>]*>\s*([^<]+)', text) or \
                re.search(r'errors?[^>]*>\s*([^<]+)', text)
            if m and m.group(1).strip():
                print(f"    服务端提示: {m.group(1).strip()}")
            else:
                for kw in err_kws:
                    i = text.lower().find(kw.lower())
                    if i >= 0:
                        print(f"    提示: {text[max(0,i-20):i+100].strip()}")
                        break
            return False

    # 最终确认：尝试访问入口页
    print("[4/5] 验证会话 ...")
    test_url, _ = client.get(BASE_URL, referer=final_url2)
    print(f"      访问入口: {test_url}")

    return True


# --------------------------------------------------------------------------
# Cookie 持久化
# --------------------------------------------------------------------------
def save_cookies(client, prefix="just_vpn"):
    import datetime

    cookie_list = client.cookie_list()
    if not cookie_list:
        print("[!] 没有捕获到任何 Cookie")
        return None

    # cookies.json
    json_path = f"{prefix}_cookies.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "saved_at": datetime.datetime.now().isoformat(),
                "cookies": cookie_list,
            },
            f, ensure_ascii=False, indent=2,
        )
    print(f"[5/5] Cookie 已保存: {json_path}")

    # cookies.txt (Netscape 格式，curl -b 可用)
    txt_path = f"{prefix}_cookies.txt"
    with open(txt_path, "w", encoding="utf-8") as f:
        f.write("# Netscape HTTP Cookie File\n")
        f.write("# Generated by just_vpn_login.py\n\n")
        for c in cookie_list:
            domain = c["domain"]
            if domain.startswith("."):
                domain = domain[1:]
            include_sub = "TRUE" if c["domain"].startswith(".") else "FALSE"
            secure = "TRUE" if c["secure"] else "FALSE"
            expires = str(int(c["expires"])) if c["expires"] else "0"
            value = c["value"].replace("\n", "%0A").replace("\t", "%09")
            f.write(f"{domain}\t{include_sub}\t{c['path']}\t{secure}\t{expires}\t{c['name']}\t{value}\n")
    print(f"[5/5] Cookie 已保存: {txt_path} (Netscape 格式, 可配合 curl -b 使用)")

    return json_path


def dump_cookies_summary(client):
    """打印关键 cookie"""
    d = client.cookie_dict()
    print("\n===== 提取到的 Cookie =====")
    for k, v in d.items():
        print(f"  {k} = {v[:60]}{'...' if len(v) > 60 else ''}")
    print("==========================\n")
    # 显示 SESSION / 会话相关
    for k in ("SESSION", "JSESSIONID", "WEBVPN", "enlink", "sess"):
        if k in d:
            print(f"★ 关键会话 Cookie [{k}]: {d[k]}")


# --------------------------------------------------------------------------
# 用提取的 Cookie 测试访问检测地址（验证会话是否有效）
# 未登录/会话失效时，网关会把请求重定向回 CAS 登录页；
# 登录成功时应能直接访问到目标内容。
# --------------------------------------------------------------------------
def test_internal(client, url=None):
    targets = url or CHECK_URL
    print(f"[测试] 使用提取的 Cookie 访问检测地址 {targets} ...")
    try:
        fu, body = client.get(targets)
        html = body.decode("utf-8", errors="replace")
        # 判断是否被重定向回登录页
        redirected_to_login = (
            "cas/login" in fu
            or "统一身份认证" in html[:500]
            or "passwordShow" in html[:2000]
        )
        if redirected_to_login:
            print(f"  [!] 会话未生效：被重定向回登录页 → {fu}")
            print(f"      （如果刚登录成功，说明 ticket 回调未正确设置会话 Cookie）")
            return False
        head = html[:300].replace("\n", " ")
        print(f"  ✓ 会话有效！URL: {fu}")
        print(f"  内容前300字符: {head}")
        return True
    except Exception as e:
        print(f"  [!] 访问失败: {e}")
        return False


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------
def main():
    global USERNAME, PASSWORD
    if not USERNAME:
        USERNAME = input("请输入学号/工号: ").strip()
    if not PASSWORD:
        PASSWORD = getpass.getpass("请输入密码: ")
    if not USERNAME or not PASSWORD:
        print("账号或密码为空，无法登录！")
        sys.exit(1)

    client = StdlibClient()

    ok = do_login(client)
    if not ok:
        print("\n登录流程未确认成功，尝试继续提取当前已有 Cookie ...")
    else:
        print("\n✓ 登录成功！提取到的 Cookie：")

    dump_cookies_summary(client)
    save_cookies(client)

    # 登录成功后自动访问检测地址，验证会话 Cookie 是否真正生效
    if ok:
        test_internal(client)

    print("\n提示：cookies.txt 可用于 curl：")
    print(f'  curl -b cookies.txt "{CHECK_URL}"')
    print(f'  或将 cookies.json 中的 Cookie 导入浏览器/请求库使用。')


if __name__ == "__main__":
    main()
