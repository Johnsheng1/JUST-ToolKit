// ==UserScript==
// @name         江苏科技大学 WebVPN 快速跳转器
// @namespace    just.webvpn.jumper
// @version      1.1.0
// @description  在 client.v.just.edu.cn 下提供悬浮按钮+弹窗，输入主机名自动 AES 加密跳转；内置"现代框架修复"开关，解决 WebVPN 误伤 Next.js/React 等站点的普遍性 JS 报错
// @author       Github/Johnsheng1
// @match        https://client.v.just.edu.cn/*
// @grant        none
// @run-at       document-start
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  /* ============================================================
   * 修复模块：解决 WebVPN 误伤现代框架的普遍性问题
   * ------------------------------------------------------------
   * 问题：易安联 WebVPN 的 bundle.debug.js 内含脚本过滤器 R(t,e)，
   * 对页面内联脚本做关键词检测（location/postMessage/http-webvpn/https-webvpn），
   * 命中就用 enlink_eval() 用 Babel 改写（location→__location）后 eval。
   * Next.js/React 等现代框架的 SSR 数据（__next_f）天然含 "location"
   * 字符串，被误判为混淆代码改写后导致 React hydration 崩溃，
   * 页面渲染 "__next_error__" 错误页。
   *
   * 修复：document-start 阶段把 window.enlink_eval 替换为无害版本，
   * 原样执行不再改写；若原样执行失败（真老混淆系统），降级回退原始逻辑。
   * 可通过开关全局启停（默认开启）。
   * ============================================================ */
  const FIX_ENABLED_KEY = 'just_wvpn_fix_enabled';

  function getFixEnabled() {
    try {
      const v = localStorage.getItem(FIX_ENABLED_KEY);
      return v === null ? true : v === '1';
    } catch (e) {
      return true;
    }
  }

  function installFix() {
    if (!getFixEnabled()) return; // 开关关闭时不安装
    let current = undefined;
    try {
      Object.defineProperty(window, 'enlink_eval', {
        configurable: true,
        enumerable: false,
        get: function () { return current; },
        set: function (v) {
          if (typeof v !== 'function' || v.__just_patched) { current = v; return; }
          const original = v;
          const patched = function (code, mode, sourceType) {
            try { return eval(code); }
            catch (e) {
              try { return original(code, mode, sourceType); }
              catch (e2) { throw e2; }
            }
          };
          patched.__just_patched = true;
          current = patched;
        }
      });
    } catch (e) { /* 某些环境不允许覆写，忽略 */ }
    // 兜底轮询：WebVPN 若用其他方式重定义，再补一次
    const iv = setInterval(function () {
      const v = window.enlink_eval;
      if (typeof v === 'function' && !v.__just_patched) {
        try { window.enlink_eval = v; } catch (e) {}
      }
    }, 50);
    setTimeout(function () { clearInterval(iv); }, 3000);
  }

  // document-start 立即安装修复（必须早于 WebVPN bundle 执行）
  installFix();

  /* ============================================================
   * 加密引擎：纯 JS AES-128 实现（自包含，无外部依赖）
   * 目标：复刻 WebVPN bundle 中的 CryptoJS.AES.encrypt(..., CBC, Pkcs7)
   * key = IV = "CASB2021EnLink!!"
   * ============================================================ */
  const AES = (() => {
    const sbox = [0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16];
    const rcon = [0x00,0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80,0x1b,0x36];
    function xtime(x) { return ((x << 1) ^ (((x >> 7) & 1) * 0x1b)) & 0xff; }
    function expandKey(key) {
      const w = new Array(176);
      for (let i = 0; i < 16; i++) w[i] = key[i];
      let i = 16;
      while (i < 176) {
        let temp = w.slice(i - 4, i);
        if (i % 16 === 0) {
          temp = [temp[1], temp[2], temp[3], temp[0]];
          temp = temp.map(b => sbox[b]);
          temp[0] ^= rcon[i / 16];
        }
        for (let j = 0; j < 4; j++) w[i + j] = w[i - 16 + j] ^ temp[j];
        i += 4;
      }
      return w;
    }
    function addRoundKey(s, w, r) { for (let i = 0; i < 16; i++) s[i] ^= w[r * 16 + i]; }
    function subBytes(s) { for (let i = 0; i < 16; i++) s[i] = sbox[s[i]]; }
    function shiftRows(s) {
      [s[1], s[5], s[9], s[13]] = [s[5], s[9], s[13], s[1]];
      [s[2], s[6], s[10], s[14]] = [s[10], s[14], s[2], s[6]];
      [s[3], s[7], s[11], s[15]] = [s[15], s[3], s[7], s[11]];
    }
    function mixColumns(s) {
      for (let c = 0; c < 16; c += 4) {
        const a = [s[c], s[c + 1], s[c + 2], s[c + 3]];
        s[c]   = xtime(a[0] ^ a[1]) ^ a[1] ^ a[2] ^ a[3];
        s[c+1] = a[0] ^ xtime(a[1] ^ a[2]) ^ a[2] ^ a[3];
        s[c+2] = a[0] ^ a[1] ^ xtime(a[2] ^ a[3]) ^ a[3];
        s[c+3] = a[0] ^ a[1] ^ a[2] ^ xtime(a[3] ^ a[0]);
      }
    }
    function encryptBlock(inp, key) {
      const s = inp.slice();
      const w = expandKey(key);
      addRoundKey(s, w, 0);
      for (let r = 1; r < 10; r++) {
        subBytes(s); shiftRows(s); mixColumns(s); addRoundKey(s, w, r);
      }
      subBytes(s); shiftRows(s); addRoundKey(s, w, 10);
      return s;
    }
    // AES-128-CBC + PKCS7 加密
    function cbcEncrypt(plainBytes, keyBytes, ivBytes) {
      const pad = 16 - (plainBytes.length % 16);
      const data = plainBytes.concat(new Array(pad).fill(pad));
      let prev = ivBytes.slice();
      const out = [];
      for (let o = 0; o < data.length; o += 16) {
        const blk = data.slice(o, o + 16);
        for (let i = 0; i < 16; i++) blk[i] ^= prev[i];
        const e = encryptBlock(blk, keyBytes);
        out.push(...e);
        prev = e;
      }
      return out;
    }
    return { cbcEncrypt };
  })();

  /* ============================================================
   * 编码器：把主机名 -> webvpn 十六进制编码
   * ============================================================ */
  const WEBVPN_KEY = 'CASB2021EnLink!!';
  function strToBytes(s) { return Array.from(s, c => c.charCodeAt(0)); }
  function encodeHost(host) {
    const key = strToBytes(WEBVPN_KEY);
    const ct = AES.cbcEncrypt(strToBytes(host), key, key);
    return ct.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /* ============================================================
   * 常用系统快捷列表
   * ============================================================ */
  const COMMON = [
    { name: '我的门户', host: 'my.just.edu.cn' },
    { name: '教务系统', host: 'jwxt.just.edu.cn' },
    { name: '学校官网', host: 'www.just.edu.cn' },
    { name: '财务系统', host: 'caiwu.just.edu.cn' },
    { name: '教务管理(8080)', host: 'jwgl.just.edu.cn:8080' },
    { name: '图书馆', host: 'lib.just.edu.cn' },
    { name: '统一认证辅助', host: 'vfdm.just.edu.cn' },
  ];

  /* ============================================================
   * URL 构造
   * ============================================================ */
  function buildUrl(host, protocol) {
    // 提取主机名（去掉协议头与末尾斜杠；路径单独拼接）
    let clean = host.trim();
    let path = '';
    if (/^https?:\/\//i.test(clean)) {
      const m = clean.match(/^https?:\/\/([^/]+)(\/.*)?$/i);
      clean = m[1];
      path = m[2] || '';
    } else if (clean.includes('/')) {
      const idx = clean.indexOf('/');
      path = clean.slice(idx);
      clean = clean.slice(0, idx);
    }
    clean = clean.replace(/\/+$/, '');
    // 协议固定为 http / https
    const proto = protocol === 'http' ? 'http' : 'https';
    return location.origin + '/' + proto + '/webvpn' + encodeHost(clean) + path;
  }

  /* ============================================================
   * UI：悬浮按钮 + 弹窗
   * ============================================================ */
  function injectUI() {
    // 防重复
    if (document.getElementById('just-wvpn-root')) return;

    const root = document.createElement('div');
    root.id = 'just-wvpn-root';

    // 样式
    const style = document.createElement('style');
    style.textContent = `
      #just-wvpn-root { all: initial; font-family: "Segoe UI", "Microsoft YaHei", sans-serif; }
      #just-wvpn-root *, #just-wvpn-root *::before, #just-wvpn-root *::after { box-sizing: border-box; }
      #just-wvpn-fab {
        position: fixed; right: 24px; bottom: 24px; z-index: 2147483646;
        width: 52px; height: 52px; border-radius: 50%;
        background: linear-gradient(135deg, #1e6fff, #0a3fa5);
        color: #fff; font-size: 26px; font-weight: 700;
        display: flex; align-items: center; justify-content: center;
        cursor: pointer; box-shadow: 0 4px 14px rgba(0,40,120,.35);
        border: none; user-select: none; transition: transform .15s ease, box-shadow .15s ease;
      }
      #just-wvpn-fab:hover { transform: scale(1.08); box-shadow: 0 6px 20px rgba(0,40,120,.45); }
      #just-wvpn-panel {
        position: fixed; right: 24px; bottom: 88px; z-index: 2147483646;
        width: 330px; background: #fff; color: #1a1a1a;
        border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,.22);
        display: none; overflow: hidden;
      }
      #just-wvpn-panel.open { display: block; }
      #just-wvpn-panel .just-wvpn-head {
        padding: 14px 16px; background: linear-gradient(135deg, #1e6fff, #0a3fa5); color: #fff;
        font-size: 15px; font-weight: 600; display: flex; align-items: center; justify-content: space-between;
      }
      #just-wvpn-panel .just-wvpn-close { cursor: pointer; font-size: 18px; line-height: 1; opacity: .85; background: none; border: none; color: #fff; }
      #just-wvpn-panel .just-wvpn-body { padding: 14px; }
      #just-wvpn-panel label { display: block; font-size: 12px; color: #666; margin-bottom: 6px; }
      #just-wvpn-input {
        width: 100%; padding: 9px 11px; font-size: 14px; border: 1px solid #d0d5dd; border-radius: 8px;
        outline: none; transition: border-color .15s;
      }
      #just-wvpn-input:focus { border-color: #1e6fff; box-shadow: 0 0 0 3px rgba(30,111,255,.15); }
      #just-wvpn-proto {
        width: 100%; padding: 8px 10px; font-size: 13px; margin-top: 8px;
        border: 1px solid #d0d5dd; border-radius: 8px; background: #fff; outline: none;
      }
      #just-wvpn-go {
        width: 100%; margin-top: 12px; padding: 10px; font-size: 14px; font-weight: 600;
        background: linear-gradient(135deg, #1e6fff, #0a3fa5); color: #fff; border: none;
        border-radius: 8px; cursor: pointer; transition: filter .15s;
      }
      #just-wvpn-go:hover { filter: brightness(1.1); }
      #just-wvpn-error { display: none; margin-top: 10px; padding: 8px 10px; font-size: 12px; color: #b42318; background: #fef3f2; border-radius: 8px; }
      #just-wvpn-common { margin-top: 14px; }
      #just-wvpn-common .just-wvpn-ctitle { font-size: 12px; color: #666; margin-bottom: 6px; }
      #just-wvpn-common .just-wvpn-chips { display: flex; flex-wrap: wrap; gap: 6px; }
      .just-wvpn-chip {
        padding: 4px 10px; font-size: 12px; border-radius: 999px; cursor: pointer;
        background: #eef4ff; color: #1e6fff; border: 1px solid #d6e4ff; transition: background .15s;
      }
      .just-wvpn-chip:hover { background: #d9e8ff; }
      #just-wvpn-fix {
        display: flex; align-items: center; justify-content: space-between;
        margin-top: 12px; padding: 9px 11px;
        background: #f5f7fa; border: 1px solid #e4e7ec; border-radius: 8px;
      }
      #just-wvpn-fix .just-wvpn-fix-label { font-size: 12px; color: #333; }
      #just-wvpn-fix .just-wvpn-fix-label small { display: block; color: #98a2b3; margin-top: 2px; }
      /* 开关 */
      #just-wvpn-fix .just-wvpn-switch {
        position: relative; width: 40px; height: 22px; flex-shrink: 0;
        background: #cbd2dc; border-radius: 999px; cursor: pointer;
        transition: background .2s; border: none; padding: 0;
      }
      #just-wvpn-fix .just-wvpn-switch::after {
        content: ''; position: absolute; top: 3px; left: 3px;
        width: 16px; height: 16px; background: #fff; border-radius: 50%;
        transition: transform .2s; box-shadow: 0 1px 3px rgba(0,0,0,.25);
      }
      #just-wvpn-fix .just-wvpn-switch.on { background: #1e6fff; }
      #just-wvpn-fix .just-wvpn-switch.on::after { transform: translateX(18px); }
    `;
    root.appendChild(style);

    // 悬浮按钮
    const fab = document.createElement('button');
    fab.id = 'just-wvpn-fab';
    fab.title = 'WebVPN 快速跳转';
    fab.textContent = '⟳';
    fab.addEventListener('click', () => panel.classList.toggle('open'));

    // 弹窗
    const panel = document.createElement('div');
    panel.id = 'just-wvpn-panel';
    panel.innerHTML = `
      <div class="just-wvpn-head">
        <span>WebVPN 快速跳转</span>
        <button class="just-wvpn-close" title="关闭">✕</button>
      </div>
      <div class="just-wvpn-body">
        <label for="just-wvpn-input">内网地址（主机名或完整 URL）</label>
        <input id="just-wvpn-input" type="text" placeholder="例：jwxt.just.edu.cn 或 https://jwxt.just.edu.cn/jwglxt" autocomplete="off" spellcheck="false" />
        <select id="just-wvpn-proto">
          <option value="https" selected>HTTPS</option>
          <option value="http">HTTP</option>
        </select>
        <div id="just-wvpn-fix">
          <div class="just-wvpn-fix-label">现代框架修复
            <small>修复 Next.js/React 站点的 JS 报错</small>
          </div>
          <button id="just-wvpn-fix-switch" class="just-wvpn-switch" role="switch" aria-checked="true"></button>
        </div>
        <button id="just-wvpn-go">前往</button>
        <div id="just-wvpn-error"></div>
        <div id="just-wvpn-common">
          <div class="just-wvpn-ctitle">快捷跳转</div>
          <div class="just-wvpn-chips"></div>
        </div>
      </div>
    `;

    const input = panel.querySelector('#just-wvpn-input');
    const protoSel = panel.querySelector('#just-wvpn-proto');
    const goBtn = panel.querySelector('#just-wvpn-go');
    const errBox = panel.querySelector('#just-wvpn-error');
    const chips = panel.querySelector('.just-wvpn-chips');

    const closeBtn = panel.querySelector('.just-wvpn-close');
    closeBtn.addEventListener('click', () => panel.classList.remove('open'));

    function showErr(msg) { errBox.textContent = msg; errBox.style.display = 'block'; }
    function hideErr() { errBox.style.display = 'none'; }

    function go() {
      hideErr();
      const raw = input.value.trim();
      if (!raw) { showErr('请输入主机名或网址'); return; }
      try {
        const url = buildUrl(raw, protoSel.value);
        location.href = url;
      } catch (e) {
        showErr('生成地址失败：' + e.message);
      }
    }

    goBtn.addEventListener('click', go);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });

    // 现代框架修复开关
    const fixSwitch = panel.querySelector('#just-wvpn-fix-switch');
    function setFixSwitch(on) {
      fixSwitch.classList.toggle('on', on);
      fixSwitch.setAttribute('aria-checked', String(on));
    }
    // 初始状态从 localStorage 读取
    setFixSwitch(getFixEnabled());
    fixSwitch.addEventListener('click', () => {
      const now = !fixSwitch.classList.contains('on');
      setFixSwitch(now);
      try { localStorage.setItem(FIX_ENABLED_KEY, now ? '1' : '0'); } catch (e) {}
      // 提示：开关对当前页面立即生效（通过刷新重建 enlink_eval）
      showErr('');
      errBox.style.display = 'block';
      errBox.style.color = '#027a48';
      errBox.style.background = '#ecfdf3';
      errBox.textContent = now
        ? '修复已开启，刷新当前页面后生效'
        : '修复已关闭，刷新当前页面后生效';
      setTimeout(() => { errBox.style.display = 'none'; errBox.style.color = ''; errBox.style.background = ''; }, 3000);
    });

    // 快捷 chips
    COMMON.forEach(item => {
      const chip = document.createElement('span');
      chip.className = 'just-wvpn-chip';
      chip.textContent = item.name;
      chip.addEventListener('click', () => {
        input.value = item.host;
        protoSel.value = item.host.includes(':8080') ? 'http' : 'https';
        go();
      });
      chips.appendChild(chip);
    });

    // 点击外部关闭
    document.addEventListener('click', e => {
      if (!root.contains(e.target) && panel.classList.contains('open')) panel.classList.remove('open');
    });

    root.appendChild(fab);
    root.appendChild(panel);
    document.documentElement.appendChild(root);
  }

  // 等 DOM 就绪
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectUI);
  } else {
    injectUI();
  }
})();
