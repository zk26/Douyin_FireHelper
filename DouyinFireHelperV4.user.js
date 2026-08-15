// ==UserScript==
// @name         续火花助手
// @namespace    http://tampermonkey.net/
// @version      4.0.0
// @description  每天自动发送续火消息，支持多用户、火花天数识别、自动重试、后端回调、历史日志等等
// @author       zk26
// @match        https://www.douyin.com/chat*
// @icon         https://i0.hdslb.com/bfs/openplatform/fb882fb0f7380d7464cd00ed68ff73d194edea0e.png
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_notification
// @grant        GM_listValues
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @connect      localhost
// @license      MIT
// ==/UserScript==

(function() {
        'use strict';

        // ============================================================
        // §1  Utils
        // ============================================================
        class Utils {
            static sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
            static today() {
                const d = new Date();
                return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            }
            static esc(str) { const el = document.createElement('span');
                el.textContent = str; return el.innerHTML; }
            static httpGet(url, { timeout = 10000, responseType = 'text' } = {}) {
                return new Promise((ok, fail) => {
                    const t = setTimeout(() => fail(new Error('请求超时')), timeout);
                    GM_xmlhttpRequest({
                        method: 'GET',
                        url,
                        responseType,
                        onload(r) { clearTimeout(t);
                            r.status >= 200 && r.status < 300 ? ok(responseType === 'json' ? r.response : r.responseText) : fail(new Error(`HTTP ${r.status}`)); },
                        onerror() { clearTimeout(t);
                            fail(new Error('网络错误')); },
                        ontimeout() { clearTimeout(t);
                            fail(new Error('请求超时')); },
                    });
                });
            }
            static httpPost(url, data, { timeout = 5000 } = {}) {
                return new Promise((ok, fail) => {
                    const t = setTimeout(() => fail(new Error('请求超时')), timeout);
                    GM_xmlhttpRequest({
                        method: 'POST',
                        url,
                        headers: { 'Content-Type': 'application/json' },
                        data: JSON.stringify(data),
                        onload(r) { clearTimeout(t);
                            ok(r); },
                        onerror() { clearTimeout(t);
                            fail(new Error('网络错误')); },
                        ontimeout() { clearTimeout(t);
                            fail(new Error('请求超时')); },
                    });
                });
            }
            static download(filename, text) {
                const a = document.createElement('a');
                a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(a.href);
            }
            static tp(s) { const [h, m, sec] = s.split(':').map(Number); return { h, m, s: sec || 0 }; }
                /** 等待条件为真，带超时和轮询间隔 */
            static waitFor(fn, { timeout = 10000, interval = 200 } = {}) {
                return new Promise((resolve, reject) => {
                    const start = Date.now();
                    const check = () => {
                        const result = fn();
                        if (result) return resolve(result);
                        if (Date.now() - start >= timeout) return reject(new Error('等待超时'));
                        setTimeout(check, interval);
                    };
                    check();
                });
            }
        }

        // ============================================================
        // §2  EventBus
        // ============================================================
        class EventBus {#
            m = new Map();
            on(e, fn) { if (!this.#m.has(e)) this.#m.set(e, new Set());
                this.#m.get(e).add(fn); return () => this.off(e, fn); }
            off(e, fn) { this.#m.get(e) ? .delete(fn); }
            emit(e, d) { this.#m.get(e) ? .forEach(fn => { try { fn(d); } catch (err) { console.error(`[DFH:${e}]`, err); } }); }
        }

        // ============================================================
        // §3  Storage
        // ============================================================
        class Storage {
            get(k, fb) { const v = GM_getValue(k); return v == null ? fb : v; }
            set(k, v) { GM_setValue(k, v); }
            remove(k) { GM_deleteValue(k); }
            keys() { return GM_listValues(); }
            clear() { for (const k of this.keys()) GM_deleteValue(k); }
        }

        // ============================================================
        // §4  Logger — 可配置等级
        // ============================================================
        class Logger {
            static LEVELS = { DEBUG: 0, INFO: 1, SUCCESS: 2, WARNING: 3, ERROR: 4 };
            static COLORS = { DEBUG: '#8e8e93', INFO: '#ff9f0a', SUCCESS: '#30d158', WARNING: '#ff9f0a', ERROR: '#ff453a' };#
            bus;#
            minLevel;
            constructor(bus, minLevel = 'DEBUG') { this.#bus = bus;
                this.#minLevel = Logger.LEVELS[minLevel] || 0; }#
            log(lv, msg) {
                if (Logger.LEVELS[lv] < this.#minLevel) return;
                const entry = { time: new Date().toLocaleTimeString(), level: lv, msg };
                this.#bus.emit('log', entry);
            }
            debug(m) { this.#log('DEBUG', m); }
            info(m) { this.#log('INFO', m); }
            success(m) { this.#log('SUCCESS', m); }
            warn(m) { this.#log('WARNING', m); }
            error(m) { this.#log('ERROR', m); }
        }

        // ============================================================
        // §5  Config — 带版本号和迁移
        // ============================================================
        class Config {
            static VERSION = 4;
            static DEF = Object.freeze({
                configVersion: 4,
                baseMessage: '续火',
                sendTime: '00:01:00',
                sendTimeRandom: false,
                sendTimeRangeStart: '23:30:00',
                sendTimeRangeEnd: '00:30:00',
                maxRetryCount: 3,
                targetUsernames: '',
                userSearchTimeout: 15000,
                maxHistoryLogs: 300,
                pageLoadWaitTime: 5000,
                multiUserMode: 'sequential',
                fireDays: 1,
                lastFireDate: '',
                customMessage: '续火 | 火花已续 [天数] 天',
                reigniteMessage: '续火 | 重燃中 [重燃进度]',
                expiringMessage: '续火 | 火花即将消失 [剩余天数]',
                autoRetryInterval: 10,
                enableCallback: false,
                callbackPort: 7788,
                initialDelay: 30,
                theme: 'dark',
                panelTop: null,
                panelLeft: null,
                panelRight: null,
                autoSendEnabled: true,
            });#
            s;#
            l;#
            d = {};
            constructor(s, l) { this.#s = s;
                this.#l = l;
                this.load(); }
            get data() { return this.#d; }
            load() {
                let sv = this.#s.get('userConfig', null);
                if (sv && (!sv.configVersion || sv.configVersion < Config.VERSION)) {
                    this.#l.info(`配置迁移: v${sv.configVersion || 0} → v${Config.VERSION}`);
                    sv = {...Config.DEF, ...sv, configVersion: Config.VERSION };
                    this.#s.set('userConfig', sv);
                }
                this.#d = sv ? {...Config.DEF, ...sv } : {...Config.DEF };
                const sd = this.#s.get('fireDays', null);
                if (sd !== null) this.#d.fireDays = sd;
                const ld = this.#s.get('lastFireDate', null);
                if (ld !== null) this.#d.lastFireDate = ld;
            }
            save() { this.#s.set('userConfig', this.#d);
                this.#s.set('fireDays', this.#d.fireDays);
                this.#s.set('lastFireDate', this.#d.lastFireDate); }
            update(p) { Object.assign(this.#d, p);
                this.save(); }
            get hasTargetUsers() { return !!(this.#d.targetUsernames && this.#d.targetUsernames.trim()); }
        }

        // ============================================================
        // §6  Selector — 优先级管理 + 多策略
        // ============================================================
        class Selector {#
            m = new Map();
            reg(ns, s) { this.#m.set(ns, {...s }); }
            get(ns, k) { return this.#m.get(ns) ? .[k]; }
            all(ns) { return this.#m.get(ns) || {}; }
                /** 多策略查找：按优先级尝试多个选择器 */
            find(ns, key, parent = document) {
                const primary = this.get(ns, key);
                if (primary) {
                    const el = parent.querySelector(primary);
                    if (el) return el;
                }
                // 备用策略
                const fallbacks = this.get(ns, `${key}_fallbacks`) || [];
                for (const sel of fallbacks) {
                    const el = parent.querySelector(sel);
                    if (el) return el;
                }
                return null;
            }
        }

        // ============================================================
        // §7  DOM — 和 V1 一致：execCommand 优先 + DOM 兜底
        // ============================================================
        class DOM {#
            sel;#
            log;
            constructor(sel, log) { this.#sel = sel;
                this.#log = log; }
            $(s, p = document) { return p.querySelector(s); }
            $$(s, p = document) { return [...p.querySelectorAll(s)]; }

            /** P1: 等待元素出现（MutationObserver + 轮询混合，避免 React 复用 DOM 不触发） */
            wait(sel, timeout = 10000, parent = document) {
                return new Promise(resolve => {
                    const el = parent.querySelector(sel);
                    if (el) return resolve(el);
                    let settled = false;
                    const done = (v) => { if (settled) return;
                        settled = true;
                        obs.disconnect();
                        clearInterval(poller);
                        clearTimeout(t);
                        resolve(v); };
                    const obs = new MutationObserver(() => { const f = parent.querySelector(sel); if (f) done(f); });
                    obs.observe(parent === document ? document.documentElement : parent, { childList: true, subtree: true, attributes: true });
                    const poller = setInterval(() => { const f = parent.querySelector(sel); if (f) done(f); }, 300);
                    const t = setTimeout(() => done(null), timeout);
                });
            }

            /** 可靠点击：优先 el.click()，失败再用 MouseEvent */
            click(el) {
                if (!el) return false;
                try { el.click(); return true; } catch (_) {}
                try {
                    const r = el.getBoundingClientRect();
                    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: document.defaultView, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
                    return true;
                } catch (_) { return false; }
            }

            /** 键盘事件 */
            keyEvent(el, type, key, opts = {}) {
                el.dispatchEvent(new KeyboardEvent(type, { key, code: key === 'Enter' ? 'Enter' : '', keyCode: 13, which: 13, shiftKey: !!opts.shiftKey, bubbles: true, cancelable: true, composed: true }));
            }

            /** P0: 发送消息 — 和 V1 一致的键盘事件 */
            enterToSend(editor) {
                editor.focus();
                ['keydown', 'keypress', 'keyup'].forEach(t => this.keyEvent(editor, t, 'Enter'));
            }
            shiftEnter(el) {
                ['keydown', 'keypress', 'keyup'].forEach(t => this.keyEvent(el, t, 'Enter', { shiftKey: true })); }

            /** 可滚动容器查找 */
            findScrollContainer(itemSel) {
                const sample = this.$(itemSel);
                if (!sample) return null;
                let el = sample.parentElement;
                while (el && el !== document.body) {
                    const s = window.getComputedStyle(el);
                    if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 10) return el;
                    el = el.parentElement;
                }
                return null;
            }

            /**
             * P0: 输入消息 — 和 V1 完全一致的流程
             *  - 先清空编辑器
             *  - 通过 insertText / Clipboard API 写入
             *  - 输入后验证内容是否写入
             *  - 焦点丢失自动恢复
             */
            async inputMsg(editor, message) {
                if (!editor) return false;
                // 彻底清除所有前导空白和换行
                const msg = message.replace(/^[\s\u3000\uFEFF\xA0\n\r]+/, '').replace(/[\s\u3000\uFEFF\xA0\n\r]+$/, '');
                if (!msg) return false;

                // 和 V1 完全一致的流程
                editor.focus();
                this.click(editor);
                await Utils.sleep(30);

                // 清空（和 V1 一致）
                let cleared = false;
                try { cleared = document.execCommand('selectAll'); if (cleared) document.execCommand('delete'); } catch (_) {}
                if (!cleared) {
                    if (editor.isContentEditable) editor.innerHTML = '<br>';
                    else editor.value = '';
                    editor.dispatchEvent(new Event('input', { bubbles: true }));
                }
                await Utils.sleep(50);

                // 逐行逐字符输入（和 V1 一致）
                const lines = msg.split('\n');
                for (let li = 0; li < lines.length; li++) {
                    for (let ci = 0; ci < lines[li].length; ci++) {
                        if (document.activeElement !== editor) {
                            editor.focus();
                            const sel = window.getSelection();
                            const range = document.createRange();
                            range.selectNodeContents(editor);
                            range.collapse(false);
                            sel.removeAllRanges();
                            sel.addRange(range);
                        }
                        let ok = false;
                        try { ok = document.execCommand('insertText', false, lines[li][ci]); } catch (_) {}
                        if (!ok) {
                            const sel = window.getSelection();
                            let range = sel.rangeCount > 0 && editor.contains(sel.anchorNode) ?
                                sel.getRangeAt(0) : (() => { const r = document.createRange();
                                    r.selectNodeContents(editor);
                                    r.collapse(false);
                                    sel.removeAllRanges();
                                    sel.addRange(r); return r; })();
                            const tn = document.createTextNode(lines[li][ci]);
                            range.insertNode(tn);
                            range.setStartAfter(tn);
                            range.setEndAfter(tn);
                            sel.removeAllRanges();
                            sel.addRange(range);
                            editor.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, data: lines[li][ci], inputType: 'insertText', isComposing: false }));
                        }
                        await Utils.sleep(30 + Math.random() * 50);
                    }
                    if (li < lines.length - 1) { await Utils.sleep(30);
                        this.shiftEnter(editor);
                        await Utils.sleep(50); }
                }
                editor.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            }

            /** React 受控输入框值设置 */
            setReactVal(input, value) {
                const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
                const last = input.value;
                setter.call(input, value);
                const tracker = input._valueTracker;
                if (tracker) tracker.setValue(last);
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }

            /** 逐字符输入到 React 受控输入框 */
            async typeChars(input, text) {
                const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
                let cur = '';
                for (const ch of text) {
                    cur += ch;
                    setter.call(input, cur);
                    const tracker = input._valueTracker;
                    if (tracker) tracker.setValue(cur.slice(0, -1));
                    input.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, data: ch, inputType: 'insertText' }));
                    await Utils.sleep(30 + Math.random() * 40);
                }
            }
        }

        // ============================================================
        // §8  StateMachine
        // ============================================================
        class FSM {#
            bus;#
            log;#
            cur = 'Idle';#
            ac = null;
            constructor(bus, l) { this.#bus = bus;
                this.#log = l; }
            static T = Object.freeze({
                Idle: ['SearchingUser'],
                SearchingUser: ['SendMessage', 'Idle'],
                SendMessage: ['Success', 'Idle'],
                Success: ['SearchingUser', 'Idle'],
            });
            get state() { return this.#cur; }
            can(to) { return FSM.T[this.#cur] ? .includes(to) || false; }
            go(to) {
                if (!this.can(to)) { this.#log.error(`非法转换: ${this.#cur} → ${to}`); return false; }
                this.#cancelTimeout();
                const from = this.#cur;
                this.#cur = to;
                this.#log.debug(`状态: ${from} → ${to}`);
                this.#bus.emit('state:change', { from, to });
                return true;
            }
            reset() { this.#cancelTimeout(); const p = this.#cur;
                this.#cur = 'Idle'; if (p !== 'Idle') this.#bus.emit('state:change', { from: p, to: 'Idle' }); }
            forceIdle() { this.#cancelTimeout(); const p = this.#cur;
                this.#cur = 'Idle'; if (p !== 'Idle') this.#bus.emit('state:change', { from: p, to: 'Idle' }); }#
            cancelTimeout() { if (this.#ac) { this.#ac.abort();
                    this.#ac = null; } }
        }

        // ============================================================
        // §9  SearchService — 多策略 + 精确匹配 + 验证
        // ============================================================
        class SearchService {#
            app;#
            dom;#
            log;
            constructor(app) { this.#app = app;
                this.#dom = app.dom;
                this.#log = app.logger; }

            async search(username) {
                this.#log.info(`搜索用户: ${username}`);
                try {
                    const si = await this.#findSearchInput();
                    if (!si) return { ok: false, error: '未找到搜索框' };
                    si.focus();
                    this.#dom.click(si);
                    await Utils.sleep(100);
                    this.#dom.setReactVal(si, '');
                    await Utils.sleep(200);
                    await this.#dom.typeChars(si, username);
                    this.#log.info(`已输入: ${username}`);

                    // P1: 等待搜索结果出现（而非立即点击）
                    await Utils.sleep(1000);

                    // P1: 检测"未找到相关用户"等永久失败情况
                    const noResult = this.#checkNoUser();
                    if (noResult) {
                        this.#dom.setReactVal(si, '');
                        return { ok: false, error: '用户不存在', permanent: true };
                    }

                    const btn = await this.#findChatBtn(5000);
                    if (!btn) {
                        const item = this.#findSearchResult(username);
                        if (item) { this.#dom.click(item); } else { this.#dom.setReactVal(si, ''); return { ok: false, error: '未找到聊天按钮' }; }
                    } else {
                        btn.focus();
                        await Utils.sleep(50);
                        this.#dom.click(btn);
                    }

                    // P0: 等待编辑器真正出现，而非固定 sleep
                    const editorReady = await this.#waitForChatReady(8000);
                    if (!editorReady) {
                        this.#log.warn('聊天窗口未就绪');
                        return { ok: false, error: '聊天窗口未打开' };
                    }

                    // P0: 验证聊天对象
                    if (!this.#verifyTarget(username)) {
                        this.#log.warn(`聊天对象不匹配: 期望 ${username}`);
                    }
                    this.#log.success(`已进入 ${username} 的聊天`);
                    return { ok: true };
                } catch (e) { this.#log.error(`搜索失败: ${e.message}`); return { ok: false, error: e.message }; }
            }

            /** P1: 检测搜索结果是否显示"未找到用户" */
            #
            checkNoUser() {
                const noResultSelectors = [
                    '[class*="no-result"]', '[class*="noResult"]', '[class*="empty-result"]',
                    '[class*="search-empty"]', '[class*="not-found"]'
                ];
                for (const sel of noResultSelectors) {
                    const el = document.querySelector(sel);
                    if (el && el.offsetParent !== null && el.textContent.includes('未找到')) return true;
                }
                // 通用检测：搜索结果区域显示"未找到"或"无结果"
                const searchPanel = document.querySelector('[class*="SearchPanel"], [class*="search-panel"]');
                if (searchPanel) {
                    const text = searchPanel.textContent || '';
                    if (text.includes('未找到相关用户') || text.includes('无搜索结果') || text.includes('没有找到')) return true;
                }
                return false;
            }

            /** P0: 等待聊天窗口就绪（编辑器出现 + 可交互） */
            async# waitForChatReady(timeout) {
                try {
                    await Utils.waitFor(() => {
                        const editor = document.querySelector('[data-slate-editor="true"][contenteditable="true"]') ||
                            document.querySelector('[contenteditable="true"][class*="editor"]') ||
                            document.querySelector('[contenteditable="true"][class*="Editor"]');
                        return editor && editor.offsetParent !== null ? editor : null;
                    }, { timeout, interval: 300 });
                    return true;
                } catch (_) { return false; }
            }

            /** P0: 严格验证聊天对象 — 规范化后精确匹配，避免误发 */
            #
            verifyTarget(username) {
                const nameEl = document.querySelector('.RightPanelHeadertitleContainer [class*="title"]') ||
                    document.querySelector('[class*="chat-title"]') ||
                    document.querySelector('[class*="RightPanel"] [class*="name"]');
                if (!nameEl) return true;
                const chatName = this.#norm(nameEl.textContent);
                const target = this.#norm(username);
                // P0: 严格匹配 - 只允许完全相等
                return chatName === target;
            }

            /** P1: 规范化字符串 — 去空格、去@、转小写 */
            #
            norm(s) { return (s || '').replace(/[\s@\-_]/g, '').toLowerCase(); }

            /** 多策略定位搜索框 */
            async# findSearchInput() {
                const selectors = [
                    'input.semi-input[placeholder="搜索"][type="text"]',
                    'input[placeholder="搜索"]',
                    '.searchSearchInputinput_box input',
                    '.LeftPanelHeadersearch input',
                    'input[type="text"][class*="search"]',
                    'input[type="text"][class*="Search"]',
                ];
                for (const sel of selectors) {
                    const el = await this.#dom.wait(sel, 2000);
                    if (el) return el;
                }
                for (const inp of this.#dom.$$('input[type="text"]')) {
                    if (inp.offsetParent !== null && inp.placeholder) return inp;
                }
                return null;
            }

            /** 查找聊天按钮 */
            async# findChatBtn(timeout) {
                const sels = [
                    'div[class*="SearchPanelitemchat_btn"]',
                    '[class*="chat_btn"]',
                    '[class*="SearchPanel"] [class*="btn"]',
                    '[class*="search"] button',
                ];
                const start = Date.now();
                while (Date.now() - start < timeout) {
                    for (const sel of sels) {
                        for (const btn of this.#dom.$$(sel)) {
                            if (btn.offsetParent !== null && (btn.textContent.includes('聊天') || btn.textContent.includes('发消息') || sel.includes('chat_btn'))) {
                                return btn;
                            }
                        }
                    }
                    await Utils.sleep(200);
                }
                return null;
            }

            /** P0: 精确匹配搜索结果 */
            #
            findSearchResult(username) {
                const norm = this.#norm(username);
                const items = this.#dom.$$('[class*="SearchPanelitem"], [class*="search-result"]');
                for (const item of items) {
                    const text = this.#norm(item.textContent);
                    if (text === norm && item.offsetParent !== null) return item;
                }
                return null;
            }
        }

        // ============================================================
        // §10 ChatService — 多策略火花天数 + 备用 Selector
        // ============================================================
        class ChatService {#
            dom;#
            sel;
            constructor(app) { this.#dom = app.dom;
                this.#sel = app.selector; }

            /** 读取当前聊天用户的火花状态（天数 / 重燃中） */
            readFireDays() {
                const rightPanel = this.#dom.$('.RightPanelHeadertitleContainer .commonStreaknormalText');
                if (rightPanel) return this.#parseStreak(rightPanel.textContent);
                const altEl = this.#dom.$('[class*="RightPanel"] .commonStreaknormalText') ||
                    this.#dom.$('[class*="RightPanelHeadertitle"] [class*="streak"]');
                if (altEl) return this.#parseStreak(altEl.textContent);
                return { days: 0, reignite: null };
            }

            /** 等待右侧面板更新为目标用户后再读取火花状态 */
            async readFireDaysForUser(username, timeout = 5000) {
                try {
                    await Utils.waitFor(() => {
                        const titleEl = this.#dom.$('.RightPanelHeadertitleContainer [class*="title"]') ||
                            this.#dom.$('[class*="RightPanel"] [class*="name"]');
                        if (!titleEl) return false;
                        const title = (titleEl.textContent || '').replace(/[\s@\-_]/g, '').toLowerCase();
                        const target = (username || '').replace(/[\s@\-_]/g, '').toLowerCase();
                        return title.includes(target) || target.includes(title);
                    }, { timeout, interval: 300 });
                } catch (_) { /* 超时也继续读取 */ }
                return this.readFireDays();
            }

            /** 解析火花状态：正常天数 / 重燃中 X/Y / X天后消失 */
            #
            parseStreak(text) {
                if (!text) return { days: 0, reignite: null, expiring: null };
                const t = text.trim();
                // 检测重燃状态：包含 "重燃" 关键字
                const reigniteMatch = t.match(/重燃中\s*(\d+)\s*\/\s*(\d+)/);
                if (reigniteMatch) {
                    return { days: 0, reignite: { current: parseInt(reigniteMatch[1], 10), total: parseInt(reigniteMatch[2], 10) }, expiring: null };
                }
                // 检测即将消失状态：包含 "天后消失"
                const expiringMatch = t.match(/(\d+)\s*天后消失/);
                if (expiringMatch) {
                    return { days: 0, reignite: null, expiring: { remaining: parseInt(expiringMatch[1], 10) } };
                }
                // 正常天数
                const days = parseInt(t, 10);
                return { days: isNaN(days) ? 0 : days, reignite: null, expiring: null };
            }

            /** P1: 多策略定位编辑器 */
            async findEditor(timeout = 15000) {
                const selectors = [
                    'div[data-slate-editor="true"][contenteditable="true"]',
                    '[contenteditable="true"][class*="editor"]',
                    '[contenteditable="true"][class*="Editor"]',
                    '[contenteditable="true"][class*="input"]',
                    '[contenteditable="true"][class*="chat"]',
                ];
                for (const sel of selectors) {
                    const el = await this.#dom.wait(sel, timeout / selectors.length);
                    if (el) return el;
                }
                // 最终兜底
                for (const el of this.#dom.$$('[contenteditable="true"]')) {
                    if (el.offsetParent !== null) return el;
                }
                return null;
            }

            async scrollTop() {
                const list = await this.#dom.wait('[class*="conversationConversationListwrapper"], [class*="conversation-list"]', 3000);
                if (list) { await Utils.sleep(300);
                    list.scrollTop = 0; }
            }

            /** P0: 验证当前聊天对象 — 严格匹配避免误发 */
            verifyChatTarget(username) {
                const nameEl = this.#dom.$('.RightPanelHeadertitleContainer [class*="title"]') ||
                    this.#dom.$('[class*="chat-title"]');
                if (!nameEl) return true;
                const norm = s => (s || '').replace(/[\s@\-_]/g, '').toLowerCase();
                const chatName = norm(nameEl.textContent);
                const target = norm(username);
                // P0: 严格匹配 - 只允许完全相等
                return chatName === target;
            }
        }

        // ============================================================
        // §11 MessageService
        // ============================================================
        class MessageService {#
            app;
            constructor(app) { this.#app = app; }
            async build(username) {
                const c = this.#app.config.data;
                const streak = this.#app.getStreak(username);
                const days = streak.days || this.#app.getUserFireDays(username) || 1;
                let msg;
                if (streak.reignite) {
                    // 重燃状态：使用重燃消息模板
                    msg = (c.reigniteMessage || '续火 | 重燃中 [重燃进度]').replace(/^[\s\u3000\uFEFF\xA0]+/, '');
                    msg = msg.replace(/\[重燃进度\]/g, `${streak.reignite.current}/${streak.reignite.total}`);
                    msg = msg.replace(/\[重燃当前\]/g, String(streak.reignite.current));
                    msg = msg.replace(/\[重燃总数\]/g, String(streak.reignite.total));
                } else if (streak.expiring) {
                    // 即将消失状态：使用即将消失消息模板
                    msg = (c.expiringMessage || '续火 | 火花即将消失 [剩余天数]').replace(/^[\s\u3000\uFEFF\xA0]+/, '');
                    msg = msg.replace(/\[剩余天数\]/g, String(streak.expiring.remaining));
                } else {
                    // 正常状态
                    msg = (c.customMessage || '续火 | 火花已续 [天数] 天').replace(/^[\s\u3000\uFEFF\xA0]+/, '');
                }
                msg = msg.replace(/\[天数\]/g, String(days));
                return msg;
            }
            resetDay() {}
        }

        // ============================================================
        // §12 SenderService — 发送验证 + 超时 + 恢复
        // ============================================================
        class SenderService {#
            app;#
            dom;#
            log;
            constructor(app) { this.#app = app;
                this.#dom = app.dom;
                this.#log = app.logger; }

            async send(username) {
                this.#log.info(`发送: ${username}`);
                this.#app.ui.setUserStatus(`发送中: ${username}`, null);

                const fd = await this.#app.chatService.readFireDaysForUser(username);
                if (fd.days > 0 || fd.reignite || fd.expiring) {
                    this.#app.setStreak(username, fd);
                    if (fd.reignite) this.#log.info(`${username} 重燃中: ${fd.reignite.current}/${fd.reignite.total}`);
                    else if (fd.expiring) this.#log.info(`${username} 火花即将消失: ${fd.expiring.remaining}天后`);
                    else this.#log.info(`${username} 火花天数: ${fd.days}`);
                }

                if (!this.#app.chatService.verifyChatTarget(username)) {
                    this.#log.warn(`聊天对象不匹配: 期望 ${username}`);
                }

                let msg;
                try { msg = await this.#app.messageService.build(username); } catch (e) {
                    this.#log.error(`消息构建失败: ${e.message}`);
                    msg = `${this.#app.config.data.baseMessage} | 获取失败~`;
                }
                const cleanMsg = msg.replace(/^[\s\u3000\uFEFF\xA0\n\r]+/, '').replace(/[\s\u3000\uFEFF\xA0\n\r]+$/, '');

                let editor = await this.#app.chatService.findEditor(10000);
                if (!editor) { await Utils.sleep(2000);
                    editor = await this.#app.chatService.findEditor(5000); }
                if (!editor) return { ok: false, error: '未找到输入框' };

                const inputOk = await this.#dom.inputMsg(editor, cleanMsg);
                if (!inputOk) { await Utils.sleep(1000); const retry = await this.#dom.inputMsg(editor, cleanMsg); if (!retry) return { ok: false, error: '输入失败' }; }

                // P2: 验证输入是否真正写入
                await Utils.sleep(200);
                const written = editor.innerText ? .trim() || '';
                if (!written) {
                    this.#log.warn('输入验证：编辑器仍为空，再次尝试');
                    await this.#dom.inputMsg(editor, cleanMsg);
                }

                await Utils.sleep(500);
                this.#dom.enterToSend(editor);
                this.#log.info('发送中...');

                // P0: 更准确的空编辑器检测（处理 <br>、<div><br></div> 等情况）
                const isEditorEmpty = (ed) => {
                    const text = (ed.innerText || '').replace(/[\n\r\u200b\u00a0]/g, '').trim();
                    if (text.length > 0) return false;
                    const html = (ed.innerHTML || '').replace(/<br\s*\/?>/gi, '').replace(/<\/?div>/gi, '').replace(/&nbsp;/gi, '').replace(/[\s\u200b\u00a0]/g, '').trim();
                    return html.length === 0 || html === '<span></span>' || html === '<p></p>';
                };

                // 快速检查：等 2 秒看编辑器是否清空
                await Utils.sleep(2000);
                let sent = false;
                if (isEditorEmpty(editor)) {
                    sent = true;
                    this.#log.success('发送成功');
                } else {
                    // 编辑器仍有内容，尝试点发送按钮
                    this.#log.warn('编辑器仍有内容，尝试点击发送按钮');
                    const sendBtn = document.querySelector('.chat-btn') || [...document.querySelectorAll('button')].find(b => b.textContent ? .includes('发送') && b.offsetParent !== null && !b.disabled);
                    if (sendBtn) {
                        this.#dom.click(sendBtn);
                        await Utils.sleep(1500);
                        sent = isEditorEmpty(editor);
                        this.#log.info(sent ? '通过发送按钮发送成功' : '发送按钮点击后仍有内容');
                    } else {
                        this.#log.warn('未找到发送按钮');
                    }
                }

                // P1: 发送后校验 - 检测最新消息是否是自己发的
                if (sent) {
                    await Utils.sleep(500);
                    sent = await this.#verifyLastMessage(cleanMsg);
                }

                const nd = await this.#app.chatService.readFireDaysForUser(username);
                if (nd.days > 0 || nd.reignite || nd.expiring) { this.#app.setStreak(username, nd); }
                await this.#app.chatService.scrollTop();
                this.#app.ui.setUserStatus(`已发送: ${username}`, true);
                this.#app.ui.notify('续火消息发送成功！');
                return { ok: true };
            }

            /** P1: 校验最后一条消息是否是自己发的 */
            async# verifyLastMessage(expectedMsg) {
                try {
                    const msgList = document.querySelectorAll('[class*="message"], [class*="msg-item"], [class*="chat-message"]');
                    if (msgList.length === 0) return true; // 无法检测时默认成功
                    const lastMsg = msgList[msgList.length - 1];
                    const isSelf = lastMsg.classList.toString().includes('self') || lastMsg.classList.toString().includes('right') || lastMsg.querySelector('[class*="self"]') !== null;
                    if (!isSelf) {
                        this.#log.warn('最后一条消息不是自己发的');
                        return false;
                    }
                    const msgText = (lastMsg.innerText || '').trim();
                    const expected = expectedMsg.trim();
                    if (msgText.includes(expected) || expected.includes(msgText.substring(0, 20))) {
                        return true;
                    }
                    this.#log.debug('消息内容匹配验证跳过');
                    return true;
                } catch (e) {
                    this.#log.debug(`消息校验异常: ${e.message}`);
                    return true; // 异常时默认成功
                }
            }

        }

        // ============================================================
        // §13 重试（指数退避）/ 回调 / 统计 / 历史
        // ============================================================
        class RetryService {#
            s;#
            l;#
            m = new Map();#
            f = new Set();
            constructor(s, l) { this.#s = s;
                this.#l = l; const sv = this.#s.get('retryMap', {});
                this.#m = new Map(Object.entries(sv));
                this.#f = new Set(this.#s.get('failedToday', [])); }#
            save() { this.#s.set('retryMap', Object.fromEntries(this.#m));
                this.#s.set('failedToday', [...this.#f]); }
            cnt(u) { return this.#m.get(u) || 0; }
            failed(u) { return this.#f.has(u); }
            canRetry(u, max) { return !this.#f.has(u) && this.cnt(u) < max; }
            inc(u) { this.#m.set(u, this.cnt(u) + 1);
                this.#save(); }
            markFail(u) { this.#f.add(u);
                this.#save();
                this.#l.warn(`${u} 耗尽重试`); }
            reset() { this.#m.clear();
                this.#f.clear();
                this.#save(); }
            get failedList() { return [...this.#f]; }
                /** P2: 指数退避延迟 */
            getDelay(u) { return Math.min(30000, 2000 * Math.pow(2, this.cnt(u))); }
        }

        class CallbackService {#
            app;#
            log;
            constructor(app) { this.#app = app;
                this.#log = app.logger; }
            async notify(payload) {
                const c = this.#app.config.data;
                if (!c.enableCallback) return;
                try { await Utils.httpPost(`http://localhost:${c.callbackPort || 7788}/done`, {...payload, ts: Date.now() });
                    this.#log.info('已通知后端'); } catch (e) { this.#log.error(`回调失败: ${e.message}`); }
            }
        }

        class StatsService {#
            s;#
            l;
            sent = [];#
            d = '';
            constructor(s, l) { this.#s = s;
                this.#l = l;
                this.#d = this.#s.get('statsDate', ''); const t = Utils.today(); if (this.#d !== t) { this.sent = [];
                    this.#d = t;
                    this.#save(); } else { this.sent = this.#s.get('sentToday', []); } }#
            save() { this.#s.set('sentToday', this.sent);
                this.#s.set('statsDate', this.#d); }
            mark(u) { if (!this.sent.includes(u)) { this.sent.push(u);
                    this.#save(); } }
            isSent(u) { return this.sent.includes(u); }
            get count() { return this.sent.length; }
            rate(total) { return total ? `${Math.round((this.sent.length / total) * 100)}%` : '0%'; }
            reset() { this.sent = [];
                this.#d = Utils.today();
                this.#save(); }
            get date() { return this.#d; }
        }

        class HistoryService {#
            s;#
            l;#
            max;#
            queue = [];#
            flushTimer = null;
            constructor(s, l, max = 300) { this.#s = s;
                this.#l = l;
                this.#max = max; }
            add(msg, level = 'INFO') {
                // P2: 批量写入 - 先缓存，2秒后统一写
                this.#queue.push({ ts: new Date().toISOString(), level, msg });
                if (!this.#flushTimer) {
                    this.#flushTimer = setTimeout(() => this.#flush(), 2000);
                }
            }#
            flush() {
                this.#flushTimer = null;
                if (this.#queue.length === 0) return;
                const logs = this.#s.get('historyLogs', []);
                logs.unshift(...this.#queue);
                if (logs.length > this.#max) logs.length = this.#max;
                this.#s.set('historyLogs', logs);
                this.#queue = [];
            }
            all() { this.#flush(); return this.#s.get('historyLogs', []); }
            clear() { this.#queue = [];
                this.#s.set('historyLogs', []);
                this.#l.info('历史日志已清空'); }
            export () { const logs = this.all(); const t = logs.map(l => `${new Date(l.ts).toLocaleString()} [${l.level}] ${l.msg}`).join('\n');
                Utils.download(`续火日志_${Utils.today()}.txt`, t);
                this.#l.info('日志已导出'); }
        }

        // ============================================================
        // §14 Scheduler — 即时检测 + 倒计时精度
        // ============================================================
        class Scheduler {#
            app;#
            cfg;#
            log;#
            autoTmr = null;#
            cdTmr = null;#
            next = null;#
            ready = false;
            constructor(app) { this.#app = app;
                this.#cfg = app.config;
                this.#log = app.logger; }
            get nextTime() { return this.#next; }
            start() {
                const d = this.#cfg.data.initialDelay || 0;
                if (d > 0) { this.#log.info(`等待 ${d}s`);
                    setTimeout(() => { this.#ready = true;
                        this.#log.info('初始延迟结束');
                        this.#startAuto(); }, d * 1000); } else { this.#ready = true;
                    this.#startAuto(); }
                this.#next = this.#calcNext();
                this.#startCD(this.#next);
            }
            stop() { clearInterval(this.#autoTmr);
                clearInterval(this.#cdTmr);
                this.#autoTmr = this.#cdTmr = null; }
            refresh() { this.#next = this.#calcNext();
                this.#startCD(this.#next); }
            check() { this.#check(); }#
            startAuto() { clearInterval(this.#autoTmr);
                this.#autoTmr = setInterval(() => this.#check(), 15000);
                this.#check(); }#
            check() {
                if (!this.#ready || this.#app.paused || !this.#app.autoSendEnabled || this.#app.fsm.state !== 'Idle') return;
                const t = Utils.today();
                if (this.#app.stats.date !== t) { this.#log.info('新的一天');
                    this.#app.resetDay(); }
                if (this.#app.config.hasTargetUsers) { if (this.#app.parsedUsers.every(u => this.#app.stats.isSent(u) || this.#app.retry.failed(u))) { this.#app.checkDone(); return; } } else if (this.#app.stats.count > 0) return;
                if (this.#shouldSend()) { this.#log.info('发送时间到');
                    this.#app.startSend(); }
            }#
            shouldSend() { const c = this.#cfg.data; return c.sendTimeRandom ? this.#inRange(c.sendTimeRangeStart, c.sendTimeRangeEnd) : this.#past(c.sendTime); }#
            past(ts) { const { h, m, s } = Utils.tp(ts); const n = new Date(); return n.getHours() > h || (n.getHours() === h && (n.getMinutes() > m || (n.getMinutes() === m && n.getSeconds() >= s))); }#
            inRange(a, b) { const { h: sh, m: sm } = Utils.tp(a); const { h: eh, m: em } = Utils.tp(b); const n = new Date().getHours() * 60 + new Date().getMinutes(); const s = sh * 60 + sm,
                    e = eh * 60 + em; return e > s ? (n >= s && n <= e) : (n >= s || n <= e); }#
            calcNext() {
                const c = this.#cfg.data;
                const now = new Date();
                if (c.sendTimeRandom) { const { h: sh, m: sm } = Utils.tp(c.sendTimeRangeStart); const { h: eh, m: em } = Utils.tp(c.sendTimeRangeEnd); const sM = sh * 60 + sm,
                        eM = eh * 60 + em; let rM = eM > sM ? sM + Math.floor(Math.random() * (eM - sM)) : sM + Math.floor(Math.random() * (1440 - sM + eM)); const t = new Date(now);
                    t.setHours(Math.floor(rM / 60) % 24, rM % 60, 0, 0); if (t <= now) t.setDate(t.getDate() + 1); return t; }
                const { h, m, s } = Utils.tp(c.sendTime);
                const t = new Date(now);
                t.setHours(h, m, s, 0);
                if (t <= now) t.setDate(t.getDate() + 1);
                return t;
            }#
            startCD(target) {
                clearInterval(this.#cdTmr);
                const fn = () => { const diff = target - new Date(); if (diff <= 0) { this.#app.ui.setCD('00:00:00');
                        clearInterval(this.#cdTmr);
                        this.#check();
                        this.#next = this.#calcNext();
                        this.#startCD(this.#next); return; } const hh = Math.floor(diff / 3600000),
                        mm = Math.floor((diff % 3600000) / 60000),
                        ss = Math.floor((diff % 60000) / 1000);
                    this.#app.ui.setCD(`${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`); };
                fn();
                this.#cdTmr = setInterval(fn, 1000);
            }
        }

        // ============================================================
        // §15 UI — macOS 毛玻璃 + 日夜切换
        // ============================================================
        class UI {#
            app;#
            panel = null;#
            reopen = null;
            static# dragging = false;
            static# dragEl = null;
            static# ox = 0;
            static# oy = 0;
            static# dragBound = false;

            constructor(app) { this.#app = app; }
            get# log() { return this.#app.logger; }

            create() { this.#injectCSS();
                this.#mainPanel();
                this.#reopenBtn();
                this.#log.info('UI 已创建'); }
            show() { if (this.#panel) { this.#panel.style.display = '';
                    this.#reopen.style.display = 'none'; } }
            hide() { if (this.#panel) { this.#panel.style.display = 'none';
                    this.#reopen.style.display = 'flex'; } }

            setStatus(t, c) { const el = document.getElementById('dfh-st'); if (el) { el.textContent = t; if (c) el.style.color = c; } }
            setUserStatus(t, ok) { const el = document.getElementById('dfh-ust'); if (!el) return;
                el.textContent = t;
                el.style.color = ok === true ? '#30d158' : ok === false ? '#ff453a' : '#8e8e93'; }
            setProgress(t) { const el = document.getElementById('dfh-prog'); if (el) el.textContent = t; }
            setRetry(t) { const el = document.getElementById('dfh-rty'); if (el) el.textContent = t; }
            setFireDays(d) { const el = document.getElementById('dfh-fd'); if (el) el.textContent = d; }
            setCD(t) { const el = document.getElementById('dfh-cd'); if (el) el.textContent = t; }
            setNext(t) { const el = document.getElementById('dfh-nxt'); if (el) el.textContent = t; }
            setPauseBtn(paused) {
                const btn = document.getElementById('dfh-pb');
                if (!btn) return;
                btn.innerHTML = paused ? '▶ 今日继续' : '⏸ 今日暂停';
                btn.className = paused ? 'dfh-btn dfh-btn-g' : 'dfh-btn dfh-btn-o';
                const badge = document.getElementById('dfh-pbadge');
                if (badge) badge.style.display = paused ? '' : 'none';
            }
            setAutoSendBtn(enabled) {
                const btn = document.getElementById('dfh-asb');
                if (!btn) return;
                btn.innerHTML = enabled ? '🔔 定时开' : '🔕 定时关';
                btn.className = enabled ? 'dfh-btn dfh-btn-b' : 'dfh-btn';
                const badge = document.getElementById('dfh-asbadge');
                if (badge) badge.style.display = enabled ? 'none' : '';
            }
            addLog(e) { const c = document.getElementById('dfh-lg'); if (!c) return; const d = document.createElement('div');
                d.className = 'dfh-le';
                d.innerHTML = `<span class="dfh-lt">${e.time}</span><span class="dfh-lm" style="color:${Logger.COLORS[e.level]||'#ff9f0a'}">${e.msg}</span>`;
                c.prepend(d); while (c.children.length > 30) c.removeChild(c.lastChild); }
            updateProg() { const all = this.#app.parsedUsers; const s = this.#app.stats.count; const t = all.length;
                this.setProgress(`${s} / ${t}`);
                this.setStatus(s >= t && t > 0 ? '已完成' : t > 0 ? `进行中` : '未发送', s >= t && t > 0 ? '#30d158' : '#ff453a'); }
            notify(text) { if (typeof GM_notification !== 'undefined') try { GM_notification({ title: '抖音续火助手', text, timeout: 3000 }); } catch (_) { GM_notification(text, '抖音续火助手'); } }

            #
            injectCSS() {
                const s = document.createElement('style');
                s.textContent = `
:root{--dfh-bg:rgba(28,28,30,0.72);--dfh-sf:rgba(44,44,46,0.55);--dfh-sf2:rgba(58,58,60,0.4);--dfh-bd:rgba(255,255,255,0.1);--dfh-t1:#f5f5f7;--dfh-t2:#a1a1a6;--dfh-t3:#636366;--dfh-ac:#0a84ff;--dfh-r:14px;--dfh-glass:blur(60px) saturate(200%);--dfh-shadow:0 8px 40px rgba(0,0,0,0.5),inset 0 0.5px 0 rgba(255,255,255,0.06);--dfh-card-bg:rgba(255,255,255,0.04);--dfh-hover:rgba(255,255,255,0.08);--dfh-log-bg:rgba(0,0,0,0.25)}
:root.dfh-light{--dfh-bg:rgba(255,255,255,0.72);--dfh-sf:rgba(245,245,247,0.6);--dfh-sf2:rgba(0,0,0,0.06);--dfh-bd:rgba(0,0,0,0.12);--dfh-t1:#111111;--dfh-t2:#555555;--dfh-t3:#777777;--dfh-ac:#007aff;--dfh-glass:blur(60px) saturate(180%);--dfh-shadow:0 8px 40px rgba(0,0,0,0.15),inset 0 0.5px 0 rgba(255,255,255,0.6);--dfh-card-bg:rgba(0,0,0,0.04);--dfh-hover:rgba(0,0,0,0.06);--dfh-log-bg:rgba(0,0,0,0.05)}
.dfh-win{position:fixed;background:var(--dfh-bg);backdrop-filter:var(--dfh-glass);-webkit-backdrop-filter:var(--dfh-glass);border:0.5px solid var(--dfh-bd);border-radius:var(--dfh-r);box-shadow:var(--dfh-shadow);z-index:9999;color:var(--dfh-t1);font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif;overflow:hidden;user-select:none}
.dfh-hdr{padding:16px 20px 12px;cursor:move;position:relative;background:var(--dfh-card-bg)}
.dfh-tl{display:flex;align-items:center;gap:8px;margin-bottom:2px}
.dfh-tt{font-size:14px;font-weight:700;letter-spacing:-0.2px}
.dfh-st{font-size:11px;color:var(--dfh-t3);font-weight:500}
.dfh-traffic{display:flex;gap:7px;margin-bottom:10px}
.dfh-dot{width:12px;height:12px;border-radius:50%;cursor:pointer;transition:filter 0.15s}
.dfh-dot:hover{filter:brightness(1.4)}
.dfh-dot-r{background:#ff5f57}.dfh-dot-y{background:#febc2e}.dfh-dot-g{background:#28c840}
.dfh-card{background:var(--dfh-card-bg);border-radius:10px;padding:10px 12px;border:0.5px solid var(--dfh-bd)}
.dfh-grid{display:grid;gap:8px;padding:0 16px 12px}
.dfh-g2{grid-template-columns:1fr 1fr}.dfh-g3{grid-template-columns:1fr 1fr 1fr}
.dfh-lbl{font-size:10px;color:var(--dfh-t3);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:4px;font-weight:500}
.dfh-val{font-size:16px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1.2}
:root.dfh-light .dfh-val{color:var(--dfh-t1)}
.dfh-sep{height:0.5px;background:var(--dfh-bd);margin:4px 16px 0}
.dfh-btns{display:grid;gap:8px;padding:12px 16px}
.dfh-b3{grid-template-columns:1fr 1fr 1fr}
.dfh-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:9px 14px;border:none;border-radius:10px;font-size:12px;font-weight:600;cursor:pointer;color:var(--dfh-t1);background:var(--dfh-sf2);transition:all 0.15s;outline:none;letter-spacing:0.1px}
.dfh-btn:hover{background:var(--dfh-hover);transform:translateY(-1px)}.dfh-btn:active{transform:translateY(0)}
.dfh-btn-r{background:rgba(255,69,58,0.18);color:#ff453a}.dfh-btn-r:hover{background:rgba(255,69,58,0.3)}
.dfh-btn-g{background:rgba(48,209,88,0.18);color:#30d158}.dfh-btn-g:hover{background:rgba(48,209,88,0.3)}
.dfh-btn-o{background:rgba(255,159,10,0.18);color:#ff9f0a}.dfh-btn-o:hover{background:rgba(255,159,10,0.3)}
.dfh-btn-b{background:rgba(10,132,255,0.18);color:#0a84ff}.dfh-btn-b:hover{background:rgba(10,132,255,0.3)}
.dfh-btn-p{background:rgba(175,82,222,0.18);color:#bf5af2}.dfh-btn-p:hover{background:rgba(175,82,222,0.3)}
:root.dfh-light .dfh-btn-r{color:#c41a1a;background:rgba(255,59,48,0.12)}
:root.dfh-light .dfh-btn-g{color:#1a7d34;background:rgba(48,209,88,0.12)}
:root.dfh-light .dfh-btn-o{color:#a86000;background:rgba(255,159,10,0.12)}
:root.dfh-light .dfh-btn-b{color:#0062cc;background:rgba(10,132,255,0.12)}
:root.dfh-light .dfh-btn-p{color:#7b2fbe;background:rgba(175,82,222,0.12)}
.dfh-btn-s{padding:7px 10px;font-size:11px;flex:1 0 calc(25% - 6px);min-width:58px}
.dfh-btns-w{display:flex;flex-wrap:wrap;gap:6px;padding:0 16px 12px}
.dfh-log-w{padding:0 16px 14px}
.dfh-log-h{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
.dfh-log-t{font-size:12px;font-weight:600}.dfh-log-b{font-size:10px;color:var(--dfh-t3);background:var(--dfh-sf2);padding:2px 8px;border-radius:10px}
.dfh-log{height:120px;overflow-y:auto;background:var(--dfh-log-bg);border-radius:10px;padding:8px 10px;font-size:11px;line-height:1.7}
.dfh-log::-webkit-scrollbar{width:4px}.dfh-log::-webkit-scrollbar-thumb{background:var(--dfh-sf2);border-radius:2px}
.dfh-le{display:flex;gap:8px;padding:1px 0}.dfh-lt{color:var(--dfh-t3);white-space:nowrap;font-variant-numeric:tabular-nums;min-width:62px}.dfh-lm{flex:1;word-break:break-all}
:root.dfh-light .dfh-lm{color:var(--dfh-t1)}
:root.dfh-light .dfh-lt{color:var(--dfh-t3)}
:root.dfh-light .dfh-st{color:var(--dfh-t3)}
:root.dfh-light .dfh-tt{color:var(--dfh-t1)}
.dfh-ov{position:fixed;background:var(--dfh-bg);backdrop-filter:var(--dfh-glass);-webkit-backdrop-filter:var(--dfh-glass);border:0.5px solid var(--dfh-bd);border-radius:var(--dfh-r);box-shadow:0 24px 80px rgba(0,0,0,0.35),inset 0 0.5px 0 rgba(255,255,255,0.06);z-index:10000;overflow:hidden;display:flex;flex-direction:column}
.dfh-ov-h{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:0.5px solid var(--dfh-bd);cursor:move;flex-shrink:0;background:var(--dfh-card-bg)}
.dfh-ov-t{font-size:14px;font-weight:700;letter-spacing:-0.2px}
.dfh-ov-close{width:22px;height:22px;border-radius:50%;border:none;background:var(--dfh-sf2);color:var(--dfh-t2);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:13px;transition:all 0.15s;margin-left:auto}
.dfh-ov-close:hover{background:rgba(255,255,255,0.15);color:var(--dfh-t1)}
.dfh-ov-body{flex:1;overflow-y:auto;padding:14px 18px}
.dfh-ov-foot{padding:12px 18px;border-top:0.5px solid var(--dfh-bd);flex-shrink:0;background:var(--dfh-card-bg)}
.dfh-inp{width:100%;padding:8px 12px;background:var(--dfh-sf);border:0.5px solid var(--dfh-bd);border-radius:8px;color:var(--dfh-t1);font-size:13px;box-sizing:border-box;outline:none;transition:border-color 0.15s;font-family:inherit}
.dfh-inp:focus{border-color:var(--dfh-ac)}
.dfh-ta{resize:vertical;min-height:56px;font-family:inherit}
.dfh-lab{display:block;font-size:11px;color:var(--dfh-t3);margin-bottom:5px;font-weight:500;letter-spacing:0.3px}
.dfh-chk{display:flex;align-items:center;gap:8px;cursor:pointer;color:var(--dfh-t1);font-size:12px;margin-bottom:8px}
.dfh-chk input{accent-color:var(--dfh-ac)}
.dfh-sec{background:var(--dfh-card-bg);border-radius:10px;padding:14px;margin-bottom:10px;border:0.5px solid var(--dfh-bd)}
.dfh-sec h4{font-size:13px;font-weight:700;color:var(--dfh-t1);margin:0 0 10px;letter-spacing:-0.1px}
.dfh-nav{width:140px;background:var(--dfh-card-bg);padding:8px 0;border-right:0.5px solid var(--dfh-bd);flex-shrink:0}
.dfh-ni{padding:8px 14px;color:var(--dfh-t3);cursor:pointer;font-size:12px;transition:all 0.15s;border-left:2px solid transparent}
.dfh-ni:hover{color:var(--dfh-t1);background:var(--dfh-hover)}
.dfh-ni.ac{color:var(--dfh-t1);background:rgba(10,132,255,0.1);border-left-color:var(--dfh-ac);font-weight:600}
.dfh-crow{padding:9px 14px;border-bottom:0.5px solid var(--dfh-bd);transition:background 0.1s}
.dfh-crow:hover{background:var(--dfh-hover)}
.dfh-crow label{display:flex;align-items:center;gap:10px;cursor:pointer;width:100%;color:var(--dfh-t1);font-size:12px;font-weight:400}
.dfh-crow input[type="checkbox"]{width:16px;height:16px;accent-color:var(--dfh-ac);cursor:pointer;flex-shrink:0}
#dfh-reopen{position:fixed;top:20px;right:20px;width:42px;height:42px;background:var(--dfh-bg);backdrop-filter:var(--dfh-glass);-webkit-backdrop-filter:var(--dfh-glass);border:0.5px solid var(--dfh-bd);border-radius:50%;color:var(--dfh-t1);display:none;justify-content:center;align-items:center;cursor:pointer;z-index:9998;font-size:18px;box-shadow:var(--dfh-shadow);transition:all 0.2s}
#dfh-reopen:hover{transform:scale(1.1)}
.dfh-ld{font-size:10px;color:#ff9f0a;padding:2px 8px;background:rgba(255,159,10,0.12);border-radius:10px;animation:dfh-p 1.5s infinite}
@keyframes dfh-p{0%,100%{opacity:1}50%{opacity:0.4}}
.dfh-badge{font-size:10px;padding:2px 8px;border-radius:10px;font-weight:500}
.dfh-badge-o{color:#ff9f0a;background:rgba(255,159,10,0.12)}
:root.dfh-light .dfh-badge-o{color:#c77c00;background:rgba(255,159,10,0.1)}
`;
                document.head.appendChild(s);
            }

            #
            mainPanel() {
                const old = document.getElementById('dfh-panel');
                if (old) old.remove();
                const c = this.#app.config.data;
                const p = document.createElement('div');
                p.id = 'dfh-panel';
                p.className = 'dfh-win';
                p.style.width = '380px';
                const savedTop = c.panelTop,
                    savedLeft = c.panelLeft;
                if (savedTop != null && savedLeft != null) { p.style.top = savedTop + 'px';
                    p.style.left = savedLeft + 'px'; } else { p.style.top = '20px';
                    p.style.right = '20px'; }
                p.innerHTML = `
<div class="dfh-hdr" data-drag="1">
  <div class="dfh-traffic"><div class="dfh-dot dfh-dot-r" data-close="1" title="关闭"></div><div class="dfh-dot dfh-dot-y" data-close="1" title="最小化"></div><div class="dfh-dot dfh-dot-g" title="最大化"></div></div>
  <div class="dfh-tl"><span class="dfh-tt">续火花助手</span><span class="dfh-badge dfh-badge-o" id="dfh-pbadge" style="display:none">今日暂停</span><span class="dfh-badge" id="dfh-asbadge" style="display:none;background:rgba(10,132,255,0.12);color:#0a84ff">定时关</span><button id="dfh-theme" style="margin-left:auto;background:var(--dfh-sf2);border:none;width:28px;height:28px;border-radius:50%;cursor:pointer;color:var(--dfh-t1);font-size:14px;display:flex;align-items:center;justify-content:center;transition:all 0.2s" title="切换主题">🌙</button></div>
  <div class="dfh-st">V4 · DouyinFireHelper</div>
</div>
<div class="dfh-sep"></div>
<div class="dfh-grid dfh-g2" style="padding-top:12px">
  <div class="dfh-card"><div class="dfh-lbl">今日状态</div><div id="dfh-st" class="dfh-val" style="color:#30d158">未发送</div></div>
  <div class="dfh-card"><div class="dfh-lbl">用户状态</div><div id="dfh-ust" class="dfh-val" style="color:#8e8e93">未启用</div></div>
  <div class="dfh-card"><div class="dfh-lbl">发送进度</div><div id="dfh-prog" class="dfh-val" style="color:#ff453a">0 / 0</div></div>
  <div class="dfh-card"><div class="dfh-lbl">重试</div><div id="dfh-rty" class="dfh-val">0/${c.maxRetryCount}</div></div>
</div>
<div class="dfh-sep"></div>
<div class="dfh-grid dfh-g3" style="padding-top:10px">
  <div class="dfh-card"><div class="dfh-lbl">下次</div><div id="dfh-nxt" class="dfh-val" style="font-size:11px">--</div></div>
  <div class="dfh-card"><div class="dfh-lbl">倒计时</div><div id="dfh-cd" class="dfh-val" style="color:#ff453a;font-size:14px">--:--:--</div></div>
  <div class="dfh-card"><div class="dfh-lbl">火花</div><div id="dfh-fd" class="dfh-val" style="color:#30d158">${c.fireDays}</div></div>
</div>
<div class="dfh-sep"></div>
<div class="dfh-btns" style="grid-template-columns:1fr 1fr 1fr">
  <button id="dfh-pb" class="dfh-btn dfh-btn-o">⏸ 今日暂停</button>
  <button id="dfh-asb" class="dfh-btn dfh-btn-b">🔔 定时开</button>
  <button id="dfh-rst" class="dfh-btn dfh-btn-p">🔄 重置</button>
</div>
<div class="dfh-btns-w">
  <button id="dfh-cfg" class="dfh-btn dfh-btn-s">⚙ 设置</button>
  <button id="dfh-his" class="dfh-btn dfh-btn-s">📋 日志</button>
  <button id="dfh-usr" class="dfh-btn dfh-btn-s">👥 用户</button>
  <button id="dfh-day" class="dfh-btn dfh-btn-s">📅 天数</button>
  <button id="dfh-clr" class="dfh-btn dfh-btn-s">🗑 清空</button>
  <button id="dfh-rstall" class="dfh-btn dfh-btn-s">🔧 重置配置</button>
</div>
<div class="dfh-sep"></div>
<div class="dfh-log-w">
  <div class="dfh-log-h"><span class="dfh-log-t">操作日志</span><span class="dfh-log-b">实时</span></div>
  <div id="dfh-lg" class="dfh-log"><div class="dfh-le"><span class="dfh-lt">${new Date().toLocaleTimeString()}</span><span class="dfh-lm" style="color:#30d158">系统已就绪</span></div></div>
</div>`;
                document.body.appendChild(p);
                this.#panel = p;
                p.querySelector('#dfh-pb').onclick = () => this.#app.togglePause();
                p.querySelector('#dfh-asb').onclick = () => this.#app.toggleAutoSend();
                p.querySelector('#dfh-rst').onclick = () => { this.#app.stats.reset();
                    this.#app.retry.reset();
                    this.#app.messageService.resetDay();
                    this.updateProg();
                    this.#log.info('记录已重置'); };
                p.querySelector('#dfh-cfg').onclick = () => this.#settings();
                p.querySelector('#dfh-his').onclick = () => this.#history();
                p.querySelector('#dfh-usr').onclick = () => this.#userSelect();
                p.querySelector('#dfh-day').onclick = () => this.#modDays();
                p.querySelector('#dfh-clr').onclick = () => { this.#app.stats.reset();
                    this.#app.retry.reset();
                    this.#app.messageService.resetDay();
                    this.#app.hist.clear();
                    this.updateProg();
                    this.#log.info('已清空'); };
                p.querySelector('#dfh-rstall').onclick = () => { if (confirm('确定重置所有配置？')) { this.#app.storage.clear();
                        location.reload(); } };
                const themeBtn = p.querySelector('#dfh-theme');
                const applyTheme = (theme) => { if (theme === 'light') { document.documentElement.classList.add('dfh-light');
                        themeBtn.textContent = '☀️'; } else { document.documentElement.classList.remove('dfh-light');
                        themeBtn.textContent = '🌙'; }
                    this.#app.config.update({ theme }); };
                themeBtn.onclick = () => applyTheme(this.#app.config.data.theme === 'light' ? 'dark' : 'light');
                applyTheme(this.#app.config.data.theme || 'dark');
                p.querySelectorAll('[data-close]').forEach(el => el.onclick = () => this.hide());
                UI.#initDrag();
            }

            #
            reopenBtn() {
                const old = document.getElementById('dfh-reopen');
                if (old) old.remove();
                const b = document.createElement('div');
                b.id = 'dfh-reopen';
                b.textContent = '🔥';
                b.title = '打开续火助手';
                b.onclick = () => this.show();
                document.body.appendChild(b);
                this.#reopen = b;
            }

            static# initDrag() {
                if (UI.#dragBound) return;
                UI.#dragBound = true;
                document.addEventListener('mousedown', e => {
                    const hdr = e.target.closest('[data-drag], .dfh-ov-h');
                    if (!hdr || e.target.closest('button, .dfh-dot, input, select, textarea')) return;
                    const win = hdr.closest('.dfh-win, .dfh-ov');
                    if (!win) return;
                    UI.#dragging = true;
                    UI.#dragEl = win;
                    const r = win.getBoundingClientRect();
                    UI.#ox = e.clientX - r.left;
                    UI.#oy = e.clientY - r.top;
                    win.style.transition = 'none';
                    document.body.style.userSelect = 'none';
                    e.preventDefault();
                }, true);
                document.addEventListener('mousemove', e => {
                    if (!UI.#dragging || !UI.#dragEl) return;
                    const x = Math.max(0, Math.min(e.clientX - UI.#ox, window.innerWidth - UI.#dragEl.offsetWidth));
                    const y = Math.max(0, Math.min(e.clientY - UI.#oy, window.innerHeight - UI.#dragEl.offsetHeight));
                    UI.#dragEl.style.left = x + 'px';
                    UI.#dragEl.style.top = y + 'px';
                    UI.#dragEl.style.right = 'auto';
                    UI.#dragEl.style.transform = 'none';
                }, true);
                document.addEventListener('mouseup', () => {
                    if (!UI.#dragging) return;
                    UI.#dragging = false;
                    if (UI.#dragEl) { UI.#dragEl.style.transition = ''; const r = UI.#dragEl.getBoundingClientRect(); if (UI.#dragEl.id === 'dfh-panel') { const app = window.__DFH_APP; if (app) app.config.update({ panelTop: Math.round(r.top), panelLeft: Math.round(r.left) }); } }
                    UI.#dragEl = null;
                    document.body.style.userSelect = '';
                }, true);
            }

            #
            settings() {
                const old = document.getElementById('dfh-cfg-p');
                if (old) { old.remove(); return; }
                const c = this.#app.config.data;
                const p = document.createElement('div');
                p.id = 'dfh-cfg-p';
                p.className = 'dfh-ov';
                p.style.cssText = 'top:50%;left:50%;width:600px;height:500px;transform:translate(-50%,-50%)';
                p.innerHTML = `
<div class="dfh-ov-h" data-drag="1"><div class="dfh-traffic" style="margin:0"><div class="dfh-dot dfh-dot-r" data-close="1"></div></div><span class="dfh-ov-t">设置</span><button class="dfh-ov-close" data-close="1">×</button></div>
<div style="display:flex;flex:1;overflow:hidden"><div class="dfh-nav"><div class="dfh-ni ac" data-tab="basic">📅 基本</div><div class="dfh-ni" data-tab="msg">💬 消息</div><div class="dfh-ni" data-tab="usr">👥 用户</div><div class="dfh-ni" data-tab="adv">⚡ 高级</div></div>
<div class="dfh-ov-body" style="flex:1">
<div class="dfh-tab" data-tab="basic"><div class="dfh-sec"><h4>🕒 发送时间</h4><label class="dfh-chk"><input type="checkbox" id="dfh-x-tr" ${c.sendTimeRandom?'checked':''}> 随机时间</label><div id="dfh-x-ft" style="${c.sendTimeRandom?'display:none':''}"><label class="dfh-lab">时间 (HH:mm:ss)</label><input class="dfh-inp" id="dfh-x-t" value="${c.sendTime}"></div><div id="dfh-x-rt" style="${c.sendTimeRandom?'':'display:none'}"><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><div><label class="dfh-lab">开始</label><input class="dfh-inp" id="dfh-x-ts" value="${c.sendTimeRangeStart}"></div><div><label class="dfh-lab">结束</label><input class="dfh-inp" id="dfh-x-te" value="${c.sendTimeRangeEnd}"></div></div></div></div><div class="dfh-sec"><h4>⏱ 启动</h4><label class="dfh-lab">加载等待秒数</label><input class="dfh-inp" type="number" id="dfh-x-dl" min="0" max="300" value="${c.initialDelay}"></div><div class="dfh-sec"><h4>🔄 重试</h4><label class="dfh-lab">每用户最大重试</label><input class="dfh-inp" type="number" id="dfh-x-rc" min="1" max="20" value="${c.maxRetryCount}"></div><div class="dfh-sec"><h4>🔗 后端回调</h4><label class="dfh-chk"><input type="checkbox" id="dfh-x-cb" ${c.enableCallback?'checked':''}> 启用</label><label class="dfh-lab">端口</label><input class="dfh-inp" type="number" id="dfh-x-cp" value="${c.callbackPort}"></div></div>
<div class="dfh-tab" data-tab="msg" style="display:none"><div class="dfh-sec"><h4>📝 自定义消息</h4><textarea class="dfh-inp dfh-ta" id="dfh-x-msg" rows="4" placeholder="输入自定义消息内容">${c.customMessage || '续火 | 火花已续 [天数] 天'}</textarea><div style="color:var(--dfh-t3);font-size:11px;margin-top:8px;line-height:1.6"><b>可用占位符：</b><br><code style="background:var(--dfh-sf2);padding:2px 6px;border-radius:4px">[天数]</code> — 火花持续天数（按用户自动匹配）</div></div><div class="dfh-sec"><h4>🔥 重燃好友消息</h4><textarea class="dfh-inp dfh-ta" id="dfh-x-rmsg" rows="3" placeholder="重燃状态下的自定义消息">${c.reigniteMessage || '续火 | 重燃中 [重燃进度]'}</textarea><div style="color:var(--dfh-t3);font-size:11px;margin-top:8px;line-height:1.6"><b>可用占位符：</b><br><code style="background:var(--dfh-sf2);padding:2px 6px;border-radius:4px">[重燃进度]</code> — 重燃进度（如 1/3）<br><code style="background:var(--dfh-sf2);padding:2px 6px;border-radius:4px">[重燃当前]</code> — 当前次数<br><code style="background:var(--dfh-sf2);padding:2px 6px;border-radius:4px">[重燃总数]</code> — 总次数<br><code style="background:var(--dfh-sf2);padding:2px 6px;border-radius:4px">[天数]</code> — 火花天数</div></div><div class="dfh-sec"><h4>⚠️ 火花即将消失消息</h4><textarea class="dfh-inp dfh-ta" id="dfh-x-emsg" rows="3" placeholder="火花即将消失时的自定义消息">${c.expiringMessage || '续火 | 火花即将消失 [剩余天数]'}</textarea><div style="color:var(--dfh-t3);font-size:11px;margin-top:8px;line-height:1.6"><b>可用占位符：</b><br><code style="background:var(--dfh-sf2);padding:2px 6px;border-radius:4px">[剩余天数]</code> — 火花剩余天数<br><code style="background:var(--dfh-sf2);padding:2px 6px;border-radius:4px">[天数]</code> — 火花天数</div></div></div>
<div class="dfh-tab" data-tab="usr" style="display:none"><div class="dfh-sec"><h4>👥 目标用户</h4><label class="dfh-lab">用户名 (一行一个)</label><textarea class="dfh-inp dfh-ta" id="dfh-x-usr" rows="6" placeholder="每行一个用户名">${c.targetUsernames}</textarea><div style="margin-top:12px"><label class="dfh-lab">发送模式</label><div style="display:flex;gap:16px"><label class="dfh-chk"><input type="radio" name="dfh-mm" value="sequential" ${c.multiUserMode==='sequential'?'checked':''}> 顺序</label><label class="dfh-chk"><input type="radio" name="dfh-mm" value="random" ${c.multiUserMode==='random'?'checked':''}> 随机</label></div></div></div></div>
<div class="dfh-tab" data-tab="adv" style="display:none"><div class="dfh-sec"><h4>⚡ 性能</h4><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><div><label class="dfh-lab">搜索超时(ms)</label><input class="dfh-inp" type="number" id="dfh-x-sto" value="${c.userSearchTimeout}"></div><div><label class="dfh-lab">最大日志数</label><input class="dfh-inp" type="number" id="dfh-x-ml" value="${c.maxHistoryLogs}"></div></div></div></div>
</div></div>
<div class="dfh-ov-foot"><button id="dfh-save" class="dfh-btn dfh-btn-b" style="width:100%;padding:10px;font-size:13px">💾 保存设置</button></div>`;
                document.body.appendChild(p);
                p.querySelectorAll('[data-close]').forEach(el => el.onclick = () => p.remove());
                const navs = p.querySelectorAll('.dfh-ni'),
                    tabs = p.querySelectorAll('.dfh-tab');
                navs.forEach(n => n.onclick = () => { navs.forEach(x => x.classList.remove('ac'));
                    n.classList.add('ac');
                    tabs.forEach(t => t.style.display = t.dataset.tab === n.dataset.tab ? '' : 'none'); });
                p.querySelector('#dfh-x-tr').onchange = e => { p.querySelector('#dfh-x-ft').style.display = e.target.checked ? 'none' : '';
                    p.querySelector('#dfh-x-rt').style.display = e.target.checked ? '' : 'none'; };
                p.querySelector('#dfh-save').onclick = () => {
                    const v = s => p.querySelector(s) ? .value ? ? '';
                    const ck = s => p.querySelector(s) ? .checked ? ? false;
                    const rd = n => p.querySelector(`input[name="${n}"]:checked`) ? .value ? ? '';
                    const timeRe = /^([0-1]?\d|2[0-3]):[0-5]\d:[0-5]\d$/;
                    const isR = ck('#dfh-x-tr');
                    if (!isR && !timeRe.test(v('#dfh-x-t'))) { this.#log.error('时间格式错误'); return; }
                    if (isR && (!timeRe.test(v('#dfh-x-ts')) || !timeRe.test(v('#dfh-x-te')))) { this.#log.error('时间范围错误'); return; }
                    this.#app.config.update({ sendTimeRandom: isR, sendTime: v('#dfh-x-t'), sendTimeRangeStart: v('#dfh-x-ts'), sendTimeRangeEnd: v('#dfh-x-te'), initialDelay: parseInt(v('#dfh-x-dl'), 10) || 0, maxRetryCount: Math.max(1, Math.min(20, parseInt(v('#dfh-x-rc'), 10) || 3)), enableCallback: ck('#dfh-x-cb'), callbackPort: parseInt(v('#dfh-x-cp'), 10) || 7788, customMessage: v('#dfh-x-msg') || '续火 | 火花已续 [天数] 天', reigniteMessage: v('#dfh-x-rmsg') || '续火 | 重燃中 [重燃进度]', expiringMessage: v('#dfh-x-emsg') || '续火 | 火花即将消失 [剩余天数]', targetUsernames: v('#dfh-x-usr'), multiUserMode: rd('dfh-mm') || 'sequential', userSearchTimeout: parseInt(v('#dfh-x-sto'), 10) || 15000, maxHistoryLogs: parseInt(v('#dfh-x-ml'), 10) || 300 });
                    this.#app.parseUsers();
                    this.#app.scheduler.refresh();
                    p.remove();
                    this.#log.success('设置已保存');
                };
            }

            #
            history() {
                    const old = document.getElementById('dfh-his-p');
                    if (old) { old.remove(); return; }
                    const logs = this.#app.hist.all();
                    const p = document.createElement('div');
                    p.id = 'dfh-his-p';
                    p.className = 'dfh-ov';
                    p.style.cssText = 'top:50%;left:50%;width:580px;height:480px;transform:translate(-50%,-50%)';
                    p.innerHTML = `
<div class="dfh-ov-h" data-drag="1"><div class="dfh-traffic" style="margin:0"><div class="dfh-dot dfh-dot-r" data-close="1"></div></div><span class="dfh-ov-t">历史日志 <span style="color:var(--dfh-t3);font-weight:400">(${logs.length})</span></span><button class="dfh-ov-close" data-close="1">×</button></div>
<div class="dfh-ov-body">${logs.length === 0 ? '<div style="text-align:center;color:var(--dfh-t3);padding:60px"><div style="font-size:32px;margin-bottom:10px">📝</div>暂无日志</div>' : logs.map(l => `<div style="padding:7px 0;border-bottom:0.5px solid var(--dfh-bd)"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px"><span style="font-size:10px;color:var(--dfh-t3)">${new Date(l.ts).toLocaleString()}</span><span style="padding:2px 7px;border-radius:8px;font-size:9px;font-weight:600;background:${l.level==='SUCCESS'?'rgba(48,209,88,0.12)':l.level==='ERROR'?'rgba(255,69,58,0.12)':'rgba(255,159,10,0.12)'};color:${Logger.COLORS[l.level]||'#ff9f0a'}">${l.level}</span></div><div style="font-size:12px;color:var(--dfh-t1);line-height:1.4">${l.msg}</div></div>`).join('')}</div>
<div class="dfh-ov-foot" style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><button class="dfh-btn dfh-btn-g" id="dfh-hexp">📤 导出</button><button class="dfh-btn dfh-btn-r" id="dfh-hclr">🗑 清空</button></div>`;
      document.body.appendChild(p);
      p.querySelectorAll('[data-close]').forEach(el => el.onclick = () => p.remove());
      p.querySelector('#dfh-hexp').onclick = () => this.#app.hist.export();
      p.querySelector('#dfh-hclr').onclick = () => { this.#app.hist.clear(); p.remove(); };
    }

    #userSelect() {
      const old = document.getElementById('dfh-usr-p'); if (old) { old.remove(); return; }
      const curTargets = this.#app.config.data.targetUsernames.split('\n').map(u => u.trim()).filter(Boolean);
      const p = document.createElement('div'); p.id = 'dfh-usr-p'; p.className = 'dfh-ov';
      p.style.cssText = 'top:50%;left:50%;width:420px;max-height:75vh;transform:translate(-50%,-50%)';
      p.innerHTML = `
<div class="dfh-ov-h" data-drag="1"><div class="dfh-traffic" style="margin:0"><div class="dfh-dot dfh-dot-r" data-close="1"></div></div><span class="dfh-ov-t">选择用户 <span id="dfh-uc" style="color:var(--dfh-t3);font-weight:400">(加载中…)</span></span><span id="dfh-ulb" class="dfh-ld">扫描中…</span></div>
<div style="padding:8px 18px;display:flex;gap:8px;border-bottom:0.5px solid var(--dfh-bd);align-items:center"><button class="dfh-btn dfh-btn-s dfh-btn-b" id="dfh-ua">全选</button><button class="dfh-btn dfh-btn-s" id="dfh-ud">取消全选</button><button class="dfh-btn dfh-btn-s dfh-btn-o" id="dfh-urescan">🔄 重新扫描</button><span id="dfh-usel" style="margin-left:auto;font-size:11px;color:var(--dfh-ac);font-weight:600">已选：0</span></div>
<div id="dfh-ul" class="dfh-ov-body" style="max-height:240px;padding:0 4px"></div>
<div style="padding:8px 18px;border-top:0.5px solid var(--dfh-bd)"><div style="display:flex;gap:8px;align-items:center"><input class="dfh-inp" id="dfh-umanual" placeholder="手动输入用户名，回车添加" style="flex:1"><button class="dfh-btn dfh-btn-s dfh-btn-g" id="dfh-uadd">添加</button></div></div>
<div class="dfh-ov-foot" style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><button class="dfh-btn dfh-btn-g" id="dfh-uok">✅ 确认</button><button class="dfh-btn dfh-btn-r" id="dfh-uno">❌ 取消</button></div>`;
      document.body.appendChild(p);

      const listEl = p.querySelector('#dfh-ul');
      const countEl = p.querySelector('#dfh-uc');
      const badgeEl = p.querySelector('#dfh-ulb');
      const manualInp = p.querySelector('#dfh-umanual');
      const selCountEl = p.querySelector('#dfh-usel');
      let total = 0;
      const seen = new Set();

      const ITEM_SEL = '[class*="item-header-name-"], .conversationConversationItemtitle';
      const NO_MORE = '[class*="no-more-tip-"]';

      const append = names => {
        if (!names || !names.length) return;
        const frag = document.createDocumentFragment();
        names.forEach(name => { name = name.trim(); if (!name) return; const row = document.createElement('div'); row.className = 'dfh-crow'; const safe = Utils.esc(name); row.innerHTML = `<label><input type="checkbox" class="dfh-ucb" value="${safe}" ${curTargets.includes(name) ? 'checked' : ''}>${safe}</label>`; frag.appendChild(row); total++; });
        listEl.appendChild(frag);
        if (countEl) countEl.textContent = `(${total})`;
      };

      const scanNew = () => { const fresh = []; document.querySelectorAll(ITEM_SEL).forEach(el => { const text = el.textContent.trim(); if (text && !seen.has(text)) { seen.add(text); fresh.push(text); } }); return fresh; };
      const findContainer = () => { const sample = document.querySelector(ITEM_SEL); if (!sample) return null; let el = sample.parentElement; while (el && el !== document.body) { const s = window.getComputedStyle(el); if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 10) return el; el = el.parentElement; } return null; };
      const updateSelCount = () => { const checked = listEl.querySelectorAll('.dfh-ucb:checked').length; if (selCountEl) selCountEl.textContent = `已选：${checked}`; };

      const doScan = () => {
        listEl.innerHTML = ''; seen.clear(); total = 0;
        const initial = scanNew(); if (initial.length) append(initial);
        const container = findContainer();
        if (!container) {
          const apiU = this.#app.chatUsers; if (apiU.length) append(apiU.filter(n => !seen.has(n)));
          if (total === 0 && curTargets.length) append(curTargets);
          if (total === 0) listEl.innerHTML = '<div style="text-align:center;color:var(--dfh-t3);padding:30px;font-size:12px">未检测到用户<br><br>请使用下方手动输入框添加<br>或先浏览聊天列表后再点"重新扫描"</div>';
          if (badgeEl) badgeEl.remove();
          updateSelCount(); return;
        }
        const origScrollTop = container.scrollTop; let lastScrollTop = -1, stuckCount = 0;
        const step = () => {
          if (!document.body.contains(p)) { container.scrollTop = origScrollTop; return; }
          const fresh = scanNew(); if (fresh.length) append(fresh);
          if (document.querySelector(NO_MORE)) { const last = scanNew(); if (last.length) append(last); container.scrollTop = origScrollTop; if (badgeEl) badgeEl.remove(); const apiU = this.#app.chatUsers; if (apiU.length) append(apiU.filter(n => !seen.has(n))); updateSelCount(); return; }
          container.scrollTop += 500;
          if (container.scrollTop === lastScrollTop) { if (++stuckCount >= 4) { container.scrollTop = origScrollTop; if (badgeEl) badgeEl.remove(); const apiU = this.#app.chatUsers; if (apiU.length) append(apiU.filter(n => !seen.has(n))); if (total === 0 && curTargets.length) append(curTargets); updateSelCount(); return; } } else stuckCount = 0;
          lastScrollTop = container.scrollTop; setTimeout(step, 350);
        };
        setTimeout(step, 100);
      };

      doScan();
      const addManual = () => { const val = manualInp.value.trim(); if (!val) return; val.split(/[,，\n]/).forEach(n => { n = n.trim(); if (n) append([n]); }); manualInp.value = ''; updateSelCount(); };
      manualInp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addManual(); } });
      p.querySelector('#dfh-uadd').onclick = addManual;
      listEl.addEventListener('change', e => { if (e.target.classList.contains('dfh-ucb')) updateSelCount(); });
      p.querySelectorAll('[data-close]').forEach(el => el.onclick = () => p.remove());
      p.querySelector('#dfh-ua').onclick = () => { listEl.querySelectorAll('.dfh-ucb').forEach(cb => cb.checked = true); updateSelCount(); };
      p.querySelector('#dfh-ud').onclick = () => { listEl.querySelectorAll('.dfh-ucb').forEach(cb => cb.checked = false); updateSelCount(); };
      p.querySelector('#dfh-uno').onclick = () => p.remove();
      p.querySelector('#dfh-urescan').onclick = () => { doScan(); };
      p.querySelector('#dfh-uok').onclick = () => { const sel = [...listEl.querySelectorAll('.dfh-ucb:checked')].map(cb => cb.value); this.#app.config.update({ targetUsernames: sel.join('\n') }); this.#app.parseUsers(); this.updateProg(); this.#log.info(sel.length ? `已更新 ${sel.length} 个用户` : '已清空用户'); p.remove(); };
      updateSelCount();
    }

    #modDays() {
      const d = prompt('火花天数:', this.#app.config.data.fireDays);
      if (d === null) return; const n = parseInt(d, 10);
      if (isNaN(n) || n < 0) { this.#log.error('无效数字'); return; }
      this.#app.config.update({ fireDays: n, lastFireDate: Utils.today() }); this.setFireDays(n); this.#log.success(`火花天数: ${n}`);
    }
  }

  // ============================================================
  // §16 App — 编排器
  // ============================================================
  class App {
    bus = new EventBus(); storage = new Storage(); logger; config; selector = new Selector(); dom;
    fsm; scheduler; searchService; chatService; messageService; senderService;
    retry; callbackService; stats; hist; ui;
    #fireMap = {}; #streakMap = new Map(); #parsed = []; #chatU = []; #paused = false; #doneNotified = false; #running = false; #randomQueue = []; #autoSendEnabled = true;

    constructor() {
      this.logger = new Logger(this.bus);
      this.config = new Config(this.storage, this.logger);
      this.selector.reg('chat', {
        searchInput: 'input.semi-input[placeholder="搜索"][type="text"]',
        chatBtn: 'div[class*="SearchPanelitemchat_btn"]',
        sparkStatus: 'div.commonStreaknormalText',
        chatEditor: 'div[data-slate-editor="true"][contenteditable="true"]',
        convList: '.conversationConversationListwrapper',
        userName: '[class*="item-header-name-"]',
        noMore: '[class*="no-more-tip-"]',
      });
      this.dom = new DOM(this.selector, this.logger);
      this.fsm = new FSM(this.bus, this.logger);
      this.hist = new HistoryService(this.storage, this.logger, this.config.data.maxHistoryLogs);
      this.retry = new RetryService(this.storage, this.logger);
      this.stats = new StatsService(this.storage, this.logger);
      this.scheduler = new Scheduler(this);
      this.searchService = new SearchService(this);
      this.chatService = new ChatService(this);
      this.messageService = new MessageService(this);
      this.senderService = new SenderService(this);
      this.callbackService = new CallbackService(this);
      this.ui = new UI(this);
      this.#fireMap = this.storage.get('userFireDays', {});
      this.#paused = this.storage.get('isPaused', false);
      this.#autoSendEnabled = this.storage.get('autoSendEnabled', true);
      this.parseUsers();
    }

    get parsedUsers() { return this.#parsed; }
    get chatUsers() { return this.#chatU; }
    get paused() { return this.#paused; }
    get autoSendEnabled() { return this.#autoSendEnabled; }

    init() {
      this.#events(); this.#interceptAPI(); this.ui.create(); this.#menu();
      if (this.stats.date !== Utils.today()) this.resetDay();
      this.ui.setPauseBtn(this.#paused);
      this.ui.setAutoSendBtn(this.#autoSendEnabled);
      this.ui.setFireDays(this.config.data.fireDays);
      this.ui.setRetry(`0/${this.config.data.maxRetryCount}`);
      this.ui.updateProg();
      this.scheduler.start();
      this.logger.success('续火花助手 V4 已启动');
    }

    #events() {
      this.bus.on('log', e => { this.ui.addLog(e); this.hist.add(e.msg, e.level); });
      this.bus.on('state:change', ({ to }) => { if (to === 'Idle') this.ui.setStatus('等待中', '#8e8e93'); });
      this.bus.on('message:sent', ({ username }) => { this.stats.mark(username); this.#updFire(); this.ui.updateProg(); this.#checkDone(); });
      this.bus.on('message:failed', ({ username, error, permanent }) => {
        this.logger.error(`失败: ${username} - ${error}`);
        if (this.#paused) return;
        // P1: 永久失败（如用户不存在）直接标记，不重试
        if (permanent) {
          this.logger.warn(`${username}: ${error}，跳过重试`);
          this.retry.markFail(username);
          setTimeout(() => { if (!this.#paused) this.#next(); }, 2000);
          return;
        }
        if (this.retry.canRetry(username, this.config.data.maxRetryCount)) {
          this.retry.inc(username);
          const delay = this.retry.getDelay(username);
          this.logger.info(`重试 ${username} (${this.retry.cnt(username)}/${this.config.data.maxRetryCount}) ${delay/1000}s后`);
          setTimeout(() => { if (!this.#paused) this.#next(); }, delay);
        } else { this.retry.markFail(username); setTimeout(() => { if (!this.#paused) this.#next(); }, 2000); }
      });
      this.bus.on('all:done', payload => this.callbackService.notify(payload));
    }

    #interceptAPI() {
      const T = '/aweme/v1/creator/im/user_detail/';
      const origOpen = XMLHttpRequest.prototype.open, origSend = XMLHttpRequest.prototype.send;
      const self = this;
      XMLHttpRequest.prototype.open = function(m, u) { this._dfhUrl = u; return origOpen.apply(this, arguments); };
      XMLHttpRequest.prototype.send = function() {
        if (this._dfhUrl?.includes(T)) this.addEventListener('load', function() { try { const d = JSON.parse(this.responseText); if (d?.user_list) self.#procAPI(d.user_list); } catch (_) {} });
        return origSend.apply(this, arguments);
      };
      const origFetch = window.fetch;
      window.fetch = function(input, init) {
        const url = typeof input === 'string' ? input : input?.url || '';
        const r = origFetch.apply(this, arguments);
        if (url.includes(T)) r.then(res => res.clone().json().then(d => { if (d?.user_list) self.#procAPI(d.user_list); }).catch(() => {})).catch(() => {});
        return r;
      };
    }

    #procAPI(list) {
      if (!Array.isArray(list)) return;
      let n = 0;
      for (const item of list) { if (item.user_id && item.user?.nickname && !this.#chatU.includes(item.user.nickname)) { this.#chatU.push(item.user.nickname); n++; } }
      if (n) this.logger.info(`API用户 ${this.#chatU.length} 人`);
    }

    parseUsers() {
      this.#parsed = (this.config.data.targetUsernames || '').trim().split('\n').map(u => u.trim()).filter(Boolean);
      if (this.#parsed.length) this.logger.info(`目标用户 ${this.#parsed.length} 人`);
      // P2: 随机模式 - 生成随机队列
      this.#shuffleQueue();
    }
    #shuffleQueue() { this.#randomQueue = [...this.#parsed].sort(() => Math.random() - 0.5); }
    getNext() {
      const unsent = this.#parsed.filter(u => !this.stats.isSent(u) && !this.retry.failed(u));
      if (!unsent.length) return null;
      if (this.config.data.multiUserMode === 'random') {
        // P2: 从队列中取，取完重新洗牌
        while (this.#randomQueue.length > 0) {
          const next = this.#randomQueue.shift();
          if (unsent.includes(next)) return next;
        }
        this.#shuffleQueue();
        return unsent[0];
      }
      return unsent[0];
    }
    getUserFireDays(u) { return u && this.#fireMap[u] ? this.#fireMap[u] : this.config.data.fireDays; }
    setUserFireDays(u, d) { if (d > 0 && u) { this.#fireMap[u] = d; this.storage.set('userFireDays', this.#fireMap); } }
    getStreak(u) { return this.#streakMap.get(u) || { days: this.getUserFireDays(u), reignite: null, expiring: null }; }
    setStreak(u, streak) { this.#streakMap.set(u, streak); if (streak.days > 0) this.setUserFireDays(u, streak.days); }
    /** P2: 获取最大火花天数（用于UI显示） */
    getMaxFireDays() {
      const days = Object.values(this.#fireMap);
      if (days.length === 0) return this.config.data.fireDays;
      return Math.max(...days);
    }
    #updFire() {
      // P2: 不再累加全局 fireDays，改用用户天数最大值
      this.ui.setFireDays(this.getMaxFireDays());
    }

    togglePause() {
      this.#paused = !this.#paused; this.storage.set('isPaused', this.#paused); this.ui.setPauseBtn(this.#paused);
      const badge = document.getElementById('dfh-pbadge'); if (badge) badge.style.display = this.#paused ? '' : 'none';
      if (this.#paused) { this.logger.warn('今日已暂停'); this.fsm.forceIdle(); } else { this.logger.success('今日已恢复'); setTimeout(() => this.scheduler.check(), 500); }
    }
    toggleAutoSend() {
      this.#autoSendEnabled = !this.#autoSendEnabled; this.storage.set('autoSendEnabled', this.#autoSendEnabled); this.ui.setAutoSendBtn(this.#autoSendEnabled);
      this.logger.info(this.#autoSendEnabled ? '定时发送已开启' : '定时发送已关闭');
    }

    startSend() {
      if (this.#paused) { this.logger.warn('已暂停'); return; }
      if (this.#running) { this.logger.warn('进行中'); return; }
      if (this.fsm.state !== 'Idle') { this.logger.warn('进行中'); return; }
      if (this.config.hasTargetUsers) { if (!this.#parsed.filter(u => !this.stats.isSent(u) && !this.retry.failed(u)).length) { this.logger.info('全部已发送'); this.#checkDone(); return; } }
      else if (this.stats.count > 0) return;
      this.logger.info('开始发送...');
      if (this.fsm.can('SearchingUser')) this.fsm.go('SearchingUser');
      this.#next();
    }

    async #next() {
      if (this.#paused || this.#running) return;
      this.#running = true;
      try {
        const u = this.getNext();
        if (!u) { this.logger.info('无待发送用户'); this.fsm.forceIdle(); this.#checkDone(); return; }
        this.ui.setUserStatus(`搜索: ${u}`, null);
        this.ui.setRetry(`${this.retry.cnt(u)}/${this.config.data.maxRetryCount}`);
        const r = await this.searchService.search(u);
        if (this.#paused) return;
        if (!r.ok) { this.bus.emit('message:failed', { username: u, error: r.error || '搜索失败', permanent: r.permanent || false }); return; }
        if (this.fsm.can('SendMessage')) this.fsm.go('SendMessage');
        const s = await this.senderService.send(u);
        if (this.#paused) return;
        if (s.ok) {
          this.bus.emit('message:sent', { username: u });
          if (this.fsm.can('Success')) this.fsm.go('Success');
          await Utils.sleep(3000);
          if (this.#paused) return;
          this.fsm.forceIdle();
          if (this.getNext()) { if (this.fsm.can('SearchingUser')) this.fsm.go('SearchingUser'); this.#next(); } else this.#checkDone();
        } else { this.bus.emit('message:failed', { username: u, error: s.error || '发送失败' }); }
      } finally {
        this.#running = false;
      }
    }

    #checkDone() {
      if (this.#doneNotified) return;
      if (!this.config.hasTargetUsers) { if (this.stats.count > 0) { this.#doneNotified = true; this.ui.setStatus('已完成', '#30d158'); this.ui.updateProg(); this.bus.emit('all:done', { mode: 'single', status: 'success' }); this.#autoPauseAfterDone(); } return; }
      const all = this.#parsed, sent = this.stats.sent, failed = this.retry.failedList;
      const done = new Set([...sent, ...failed]);
      if (!all.every(u => done.has(u))) return;
      this.#doneNotified = true;
      const fc = failed.length, sc = sent.length;
      this.ui.updateProg();
      if (fc === 0) { this.logger.success('全部成功！'); this.ui.setStatus('全部完成', '#30d158'); this.bus.emit('all:done', { mode: 'multi', status: 'success', sentCount: sc }); }
      else if (sc === 0) { this.logger.error(`全部失败(${fc})`); this.ui.setStatus('全部失败', '#ff453a'); this.bus.emit('all:done', { mode: 'multi', status: 'all_failed', failCount: fc, failedUsers: failed }); }
      else { this.logger.warn(`完成: 成功${sc} 失败${fc}`); this.ui.setStatus(`完成 ${sc}/${sc+fc}`, '#ff9f0a'); this.bus.emit('all:done', { mode: 'multi', status: 'partial', sentCount: sc, failCount: fc, failedUsers: failed }); }
      this.#autoPauseAfterDone();
    }
    /** 任务完成后自动暂停今日任务 */
    #autoPauseAfterDone() {
      if (!this.#paused) {
        this.#paused = true;
        this.storage.set('isPaused', true);
        this.ui.setPauseBtn(true);
        const badge = document.getElementById('dfh-pbadge'); if (badge) badge.style.display = '';
        this.logger.info('今日任务已完成，自动暂停');
      }
    }

    checkDone() { this.#checkDone(); }
    resetDay() {
      this.stats.reset(); this.retry.reset(); this.messageService.resetDay(); this.#doneNotified = false;
      // 新的一天自动恢复
      if (this.#paused) {
        this.#paused = false;
        this.storage.set('isPaused', false);
        this.ui.setPauseBtn(false);
        const badge = document.getElementById('dfh-pbadge'); if (badge) badge.style.display = 'none';
        this.logger.info('新的一天，自动恢复');
      }
      this.ui.updateProg();
    }

    #menu() {
      if (typeof GM_registerMenuCommand === 'undefined') return;
      try { GM_registerMenuCommand('显示面板', () => this.ui.show()); GM_registerMenuCommand('立即发送', () => this.startSend()); GM_registerMenuCommand('设置', () => document.getElementById('dfh-cfg')?.click()); GM_registerMenuCommand('历史日志', () => document.getElementById('dfh-his')?.click()); GM_registerMenuCommand('选择用户', () => document.getElementById('dfh-usr')?.click()); } catch (_) {}
    }
  }

  // ============================================================
  // 启动
  // ============================================================
  const app = new App();
  window.__DFH_APP = app;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => app.init());
  else app.init();
})();