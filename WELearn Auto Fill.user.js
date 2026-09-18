// ==UserScript==
// @name         WELearn Auto Fill
// @namespace    http://tampermonkey.net/
// @version      2026-09-18
// @description  WELearn自动答题
// @author       櫻羽若俳
// @icon         https://www.google.com/s2/favicons?sz=64&domain=google.com
// @homepage     https://www.github.com/
// @match        *://course.sflep.com/*
// @match        *://welearn.sflep.com/*
// @match        *://wetest.sflep.com/*
// @match        *://courseappserver.sflep.com/*
// @match        *://centercourseware.sflep.com/*
// @grant        unsafeWindow
// @run-at       document-end
// ==/UserScript==

// ========== 1. 只在包含课程内容的窗口执行 ==========
var debugMode = false; // 设置为 true 可在控制台输出调试信息
function WriteConsole(...msg) {
    if (debugMode)
        console.log('[WELearn Auto Fill]', ...msg);
}
(function() {
    if (window == window.top) {
        WriteConsole('[WELearn Auto Fill] 在 iframe 中，跳过执行');
        return;
    }
    // ========== 2. 防重复初始化 ==========
    if (window.__WELEARN_AUTO_FILL_INIT__) {
        WriteConsole('[WELearn Auto Fill] 脚本已初始化，跳过重复执行');
        return;
    }
    window.__WELEARN_AUTO_FILL_INIT__ = true;

    // ========== 3. 设置管理 ==========
    const DEFAULT_SETTINGS = {
        autoFill: {
            choice: true, blank: true, tof: true, select: true,
            matching: true, recording: true, wordPractice: true
        },
        showAnswer: {
            choice: true, blank: true, tof: true, select: true,
            matching: true, recording: false, wordPractice: false
        },
        delay: 200,
        // 提交模式：'manual' 手动 | 'submit' 仅自动提交 | 'submitAndNext' 自动提交并翻页
        submitMode: 'manual',
        // 单页挂机时长（秒）
        hangDuration: 60,
        // 挂机开关状态（不持久化到 localStorage，走 sessionStorage）
        hangEnabled: false,
        // 派生字段
        autoSubmit: false,
        autoNext: false
    };

    let settings = { ...DEFAULT_SETTINGS };
    let uiVisible = false;

    const HANG_SESSION_KEY = 'welearn_hang_enabled';
    function saveHangEnabled(val) {
        try {
            if (val) sessionStorage.setItem(HANG_SESSION_KEY, '1');
            else sessionStorage.removeItem(HANG_SESSION_KEY);
        } catch (e) {}
    }
    function readHangEnabled() {
        try {
            return sessionStorage.getItem(HANG_SESSION_KEY) === '1';
        } catch (e) {
            return false;
        }
    }

    function syncDerivedSettings() {
        settings.autoSubmit = (settings.submitMode !== 'manual');
        settings.autoNext   = (settings.submitMode === 'submitAndNext');
    }

    function loadSettings() {
        try {
            const saved = localStorage.getItem('welearn_auto_fill_settings');
            if (saved) {
                const parsed = JSON.parse(saved);
                settings = mergeDeep(DEFAULT_SETTINGS, parsed);
            }
            if (!settings.submitMode) {
                settings.submitMode =
                    settings.autoNext ? 'submitAndNext' :
                    (settings.autoSubmit ? 'submit' : 'manual');
            }
            // 挂机状态：从 sessionStorage 读取
            // - iframe 重载（URL 变化）：sessionStorage 保留 → 挂机继续
            // - 关闭标签页：sessionStorage 清空 → 挂机自动结束
            settings.hangEnabled = readHangEnabled();
            syncDerivedSettings();
        } catch (e) {}
    }

    function saveSettings() {
        try {
            syncDerivedSettings();
            // hangEnabled 单独走 sessionStorage，不写入 localStorage
            const toSave = { ...settings };
            delete toSave.hangEnabled;
            localStorage.setItem('welearn_auto_fill_settings', JSON.stringify(toSave));
        } catch (e) {}
    }

    function mergeDeep(target, source) {
        const result = { ...target };
        for (const key in source) {
            if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                result[key] = mergeDeep(target[key] || {}, source[key]);
            } else {
                result[key] = source[key];
            }
        }
        return result;
    }

    // ========== 4. 辅助函数 ==========
    function getDoc() {
        const iframe = document.querySelector('iframe#contentFrame');
        if (iframe && iframe.contentDocument) {
            return iframe.contentDocument;
        }
        return document; // fallback
    }

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    // ========== 5. 显示答案函数 ==========
    function showChoiceAnswers(doc, angular, type) {
        const choices = doc.querySelectorAll('et-choice');
        choices.forEach(el => {
            const ctrl = angular.element(el).controller('etChoice');
            if (ctrl && ctrl.hasKey && ctrl.key) {
                const indices = ctrl.key;
                const items = el.querySelectorAll('li, et-item-option, .choice-item, .option-item, [role="option"]');
                items.forEach((item, idx) => {
                    if (indices.includes(idx)) {
                        item.classList.add(`welearn-answer-${type}`);
                        item.style.backgroundColor = '#90ee90';
                        item.style.border = '2px solid #2e7d32';
                        item.style.borderRadius = '4px';
                    }
                });
            }
        });
    }

    function showBlankAnswers(doc, angular, type) {
        const blanks = doc.querySelectorAll('et-blank');
        blanks.forEach(el => {
            const keyEl = el.querySelector('.key');
            if (keyEl) {
                const answer = keyEl.textContent.trim();
                const input = el.querySelector('input, textarea, .blank-input, .fill-input');
                if (input) {
                    const span = document.createElement('span');
                    span.className = `welearn-answer-text-${type}`;
                    span.textContent = ' ' + answer;
                    span.style.cssText = 'color: #999; font-style: italic; font-size: 0.9em; pointer-events: none;';
                    input.parentNode.insertBefore(span, input.nextSibling);
                } else {
                    const hint = document.createElement('div');
                    hint.className = `welearn-answer-text-${type}`;
                    hint.textContent = '答案: ' + answer;
                    hint.style.cssText = 'color: #999; font-size: 0.8em; margin-top: 2px;';
                    el.appendChild(hint);
                }
            }
        });
    }

    function showTofAnswers(doc, angular, type) {
        const tofs = doc.querySelectorAll('et-tof');
        tofs.forEach(el => {
            const ctrl = angular.element(el).controller('etTof');
            let key = el.getAttribute('key');
            if (!key && ctrl && ctrl.key) key = ctrl.key[0];
            if (!key) return;
            const isTrue = key.toLowerCase() === 't';
            const labels = el.querySelectorAll('.controls > span');
            labels.forEach(label => {
                const text = label.textContent.trim().toLowerCase();
                const isMatch = isTrue
                    ? (text === 't' || text === 'true' || text.includes('对') || text.includes('正确'))
                    : (text === 'f' || text === 'false' || text.includes('错') || text.includes('错误'));
                if (isMatch) {
                    label.classList.add(`welearn-answer-${type}`);
                    label.style.backgroundColor = '#90ee90';
                    label.style.border = '2px solid #2e7d32';
                }
            });
        });
    }

    function showSelectAnswers(doc, angular, type) {
        const selects = doc.querySelectorAll('et-select');
        selects.forEach(el => {
            const ctrl = angular.element(el).controller('etSelect');
            let key = el.getAttribute('key');
            if (!key && ctrl && ctrl.key) key = ctrl.key;
            if (!key) return;
            const choiceVal = 'choice' + key;
            const options = el.querySelectorAll('option');
            options.forEach(opt => {
                if (opt.value === choiceVal) {
                    opt.classList.add(`welearn-answer-${type}`);
                    opt.style.backgroundColor = '#90ee90';
                    opt.style.fontWeight = 'bold';
                }
            });
        });
    }

    function showMatchingAnswers(doc, angular, type) {
        const matchings = doc.querySelectorAll('et-matching');
        matchings.forEach(el => {
            const ctrl = angular.element(el).controller('etMatching');
            if (!ctrl || !ctrl.keys) return;
            const leftItems = el.querySelectorAll('.left-column .item, .left .item, .left-item');
            const rightItems = el.querySelectorAll('.right-column .item, .right .item, .right-item');
            if (leftItems.length === 0 || rightItems.length === 0) return;
            ctrl.keys.forEach((targets, leftIdx) => {
                if (!Array.isArray(targets)) return;
                targets.forEach(rightIdx => {
                    const leftEl = leftItems[leftIdx];
                    const rightEl = rightItems[rightIdx];
                    if (leftEl && rightEl) {
                        leftEl.classList.add(`welearn-answer-${type}`);
                        rightEl.classList.add(`welearn-answer-${type}`);
                        leftEl.style.border = '2px dashed #f44336';
                        rightEl.style.border = '2px dashed #f44336';
                    }
                });
            });
        });
    }

    function showAnswersForType(type) {
        const doc = getDoc();
        const win = doc.defaultView || window;
        const angular = win.angular;
        if (!angular) return;
        clearAnswersForType(type);
        switch (type) {
            case 'choice': showChoiceAnswers(doc, angular, type); break;
            case 'blank': showBlankAnswers(doc, angular, type); break;
            case 'tof': showTofAnswers(doc, angular, type); break;
            case 'select': showSelectAnswers(doc, angular, type); break;
            case 'matching': showMatchingAnswers(doc, angular, type); break;
            default: break;
        }
    }

    function showAllAnswers() {
        const types = ['choice', 'blank', 'tof', 'select', 'matching'];
        types.forEach(t => { if (settings.showAnswer[t]) showAnswersForType(t); });
    }

    function clearAllAnswers() {
        const types = ['choice', 'blank', 'tof', 'select', 'matching'];
        types.forEach(t => clearAnswersForType(t));
    }

    function clearAnswersForType(type) {
        const doc = getDoc();
        doc.querySelectorAll(`.welearn-answer-${type}`).forEach(el => {
            el.classList.remove(`welearn-answer-${type}`);
            el.style.removeProperty('background-color');
            el.style.removeProperty('border');
            el.style.removeProperty('color');
            el.style.removeProperty('text-decoration');
            el.style.removeProperty('font-weight');
        });
        doc.querySelectorAll(`.welearn-answer-text-${type}`).forEach(el => el.remove());
    }

    // ========== 6. 挂机模式（单页计时 → 提交 → 翻页 → 循环） ==========
    let hangIntervalId = null;
    let hangStartTime = 0;
    let hangIndicatorEl = null;
    let hangPanelStatusEl = null;

    function getHangIndicator() {
        if (hangIndicatorEl && hangIndicatorEl.isConnected) return hangIndicatorEl;
        hangIndicatorEl = document.createElement('div');
        hangIndicatorEl.id = 'welearn-hang-indicator';
        hangIndicatorEl.style.cssText = `
            position: fixed;
            bottom: 70px;
            right: 20px;
            z-index: 99999;
            background: linear-gradient(135deg, #009688, #26a69a);
            color: white;
            padding: 10px 18px;
            border-radius: 22px;
            font-family: Arial, sans-serif;
            font-size: 14px;
            font-weight: bold;
            display: none;
            box-shadow: 0 4px 16px rgba(0,0,0,0.35);
            user-select: none;
            pointer-events: none;
            letter-spacing: 0.5px;
        `;
        document.body.appendChild(hangIndicatorEl);
        return hangIndicatorEl;
    }

    function setPanelStatus(text) {
        if (hangPanelStatusEl && hangPanelStatusEl.isConnected) {
            hangPanelStatusEl.textContent = text;
        }
    }

    function updateHangDisplay() {
        const el = getHangIndicator();
        if (!settings.hangEnabled) {
            el.style.display = 'none';
            setPanelStatus('挂机状态：未启动');
            return;
        }
        const elapsed = Math.floor((Date.now() - hangStartTime) / 1000);
        const remain = Math.max(0, settings.hangDuration - elapsed);
        el.style.display = 'block';
        el.textContent = `▶️ 挂机中 ${remain}s / ${settings.hangDuration}s`;
        setPanelStatus(`挂机中：本页剩余 ${remain}s（共 ${settings.hangDuration}s）`);
    }

    function clearHangTimer() {
        if (hangIntervalId) {
            clearInterval(hangIntervalId);
            hangIntervalId = null;
        }
    }

    function resetHangCountdown() {
        clearHangTimer();
        if (!settings.hangEnabled) {
            updateHangDisplay();
            return;
        }
        hangStartTime = Date.now();
        updateHangDisplay();
        WriteConsole(`[挂机] 本页倒计时开始：${settings.hangDuration} 秒`);

        hangIntervalId = setInterval(async () => {
            if (!settings.hangEnabled) {
                clearHangTimer();
                updateHangDisplay();
                return;
            }
            const elapsed = Math.floor((Date.now() - hangStartTime) / 1000);
            const remain = settings.hangDuration - elapsed;
            updateHangDisplay();

            if (remain <= 0) {
                clearHangTimer();
                WriteConsole('[挂机] 倒计时结束，开始收尾');
                await autoSubmitAndNext(true);

                // 1) 重新获取当前页面状态，判断是否最后一页
                let isLast = false;
                try {
                    const doc = getDoc();
                    const win = doc.defaultView || window;
                    const angular = win.angular;
                    if (angular) {
                        const injector = angular.element(doc.querySelector('.app, [ng-app], body')).injector();
                        const pathInfo = injector.get('pathInfo');
                        if (pathInfo && pathInfo.current && !pathInfo.current.nextSco) {
                            isLast = true;
                        }
                    }
                } catch (e) {}

                if (isLast) {
                    settings.hangEnabled = false;
                    saveHangEnabled(false);
                    saveSettings();
                    updateHangDisplay();
                    WriteConsole('[挂机] 已是最后一页，自动停止');
                    setTimeout(() => alert('🎉 已完成所有页面，挂机自动停止！'), 100);
                    return;
                }

                // 2) 显式翻页
                const moveResult = await goToNextPage();
                WriteConsole('[挂机] 翻页结果:', moveResult);

                if (moveResult === 'last') {
                    settings.hangEnabled = false;
                    saveHangEnabled(false); 
                    saveSettings();
                    updateHangDisplay();
                    setTimeout(() => alert('🎉 已完成所有页面，挂机自动停止！'), 100);
                } else if (moveResult === 'fail') {
                    WriteConsole('[挂机] 翻页失败，2 秒后重试一次');
                    await sleep(2000);
                    const retry = await goToNextPage();
                    WriteConsole('[挂机] 重试结果:', retry);
                    if (retry === 'fail') {
                        WriteConsole('[挂机] 重试仍失败，暂停挂机');
                        settings.hangEnabled = false;
                        saveHangEnabled(false);
                        saveSettings();
                        updateHangDisplay();
                        setTimeout(() => alert('⚠️ 自动翻页失败，挂机已暂停。请检查控制台日志，或手动翻页后重新开始挂机。'), 100);
                    }
                }
                // moveResult === 'moved' 时，URL watcher 会在 500ms 内检测到 URL 变化，
                // 触发 main() → resetHangCountdown()，自动开始下一页的倒计时。
            }
        }, 1000);
    }

    function startHangMode() {
        if (settings.hangEnabled) {
            alert('挂机已在运行中');
            return;
        }
        settings.hangEnabled = true;
        saveHangEnabled(true);
        saveSettings();
        WriteConsole('[挂机] 已启动');
        resetHangCountdown();
        alert(
            `✅ 已开始挂机\n\n` +
            `单页停留时长：${settings.hangDuration} 秒\n` +
            `模式：强制自动提交并翻页（不受提交模式影响）\n\n` +
            `右下角会显示倒计时。\n再次点击"停止挂机"可结束。`
        );
    }

    function stopHangMode() {
        if (!settings.hangEnabled) {
            alert('挂机未在运行');
            return;
        }
        settings.hangEnabled = false;
        saveHangEnabled(false);
        saveSettings();
        clearHangTimer();
        updateHangDisplay();
        WriteConsole('[挂机] 已停止');
        alert('⏹️ 已停止挂机');
    }

    // ========== 7. 控制面板 UI（单例） ==========
    function createUI() {
        document.querySelectorAll('#welearn-control-panel').forEach(el => el.remove());
        const oldBtn = document.getElementById('eocs-trigger-btn');
        if (oldBtn) oldBtn.remove();
        if (document.getElementById('welearn-control-panel')) return;

        const container = document.createElement('div');
        container.id = 'welearn-control-panel';
        container.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 99999;
            font-family: Arial, sans-serif;
            font-size: 13px;
            color: #333;
            user-select: none;
            display: flex;
            flex-direction: column;
            align-items: flex-end;
        `;

        const toggleBtn = document.createElement('div');
        toggleBtn.id = 'welearn-toggle-btn';
        toggleBtn.textContent = '⚙️';
        toggleBtn.style.cssText = `
            width: 40px;
            height: 40px;
            background: #2196f3;
            color: white;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 24px;
            cursor: pointer;
            box-shadow: 0 2px 10px rgba(0,0,0,0.3);
            transition: transform 0.2s;
            margin-bottom: 8px;
        `;
        toggleBtn.onmouseenter = () => toggleBtn.style.transform = 'scale(1.05)';
        toggleBtn.onmouseleave = () => toggleBtn.style.transform = 'scale(1)';
        toggleBtn.onclick = () => togglePanel();

        const panel = document.createElement('div');
        panel.id = 'welearn-panel';
        panel.style.cssText = `
            background: #fff;
            border-radius: 8px;
            padding: 16px 20px;
            width: 300px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.2);
            display: none;
            max-height: 80vh;
            overflow-y: auto;
            border: 1px solid #ddd;
            transition: all 0.3s;
        `;

        const title = document.createElement('div');
        title.textContent = 'WELearn 控制面板';
        title.style.cssText = 'font-weight: bold; font-size: 16px; margin-bottom: 12px; border-bottom: 1px solid #eee; padding-bottom: 8px;';

        const groups = [
            { key: 'choice', label: '选择题', canShow: true },
            { key: 'blank', label: '填空题', canShow: true },
            { key: 'tof', label: '判断题', canShow: true },
            { key: 'select', label: '下拉选择', canShow: true },
            { key: 'matching', label: '连线题', canShow: true },
            { key: 'recording', label: '口语题', canShow: false },
            { key: 'wordPractice', label: '单词练习', canShow: false }
        ];

        const groupContainer = document.createElement('div');

        groups.forEach(g => {
            const row = document.createElement('div');
            row.style.cssText = 'display: flex; align-items: center; margin: 6px 0; gap: 10px;';

            const autoLabel = document.createElement('label');
            autoLabel.style.cssText = 'display: flex; align-items: center; gap: 4px; flex: 1;';
            const autoChk = document.createElement('input');
            autoChk.type = 'checkbox';
            autoChk.checked = settings.autoFill[g.key];
            autoChk.dataset.type = g.key;
            autoChk.dataset.mode = 'auto';
            autoChk.onchange = (e) => {
                settings.autoFill[g.key] = e.target.checked;
                saveSettings();
            };
            autoLabel.appendChild(autoChk);
            autoLabel.appendChild(document.createTextNode('自动'));

            const showLabel = document.createElement('label');
            showLabel.style.cssText = 'display: flex; align-items: center; gap: 4px; flex: 1;';
            const showChk = document.createElement('input');
            showChk.type = 'checkbox';
            showChk.checked = settings.showAnswer[g.key] && g.canShow;
            showChk.disabled = !g.canShow;
            if (!g.canShow) {
                showLabel.style.opacity = '0.5';
                showLabel.title = '该题型无文本答案可显示';
            }
            showChk.dataset.type = g.key;
            showChk.dataset.mode = 'show';
            showChk.onchange = (e) => {
                if (!g.canShow) return;
                settings.showAnswer[g.key] = e.target.checked;
                saveSettings();
                if (e.target.checked) {
                    showAnswersForType(g.key);
                } else {
                    clearAnswersForType(g.key);
                }
            };
            showLabel.appendChild(showChk);
            showLabel.appendChild(document.createTextNode('显示'));

            const nameSpan = document.createElement('span');
            nameSpan.textContent = g.label;
            nameSpan.style.cssText = 'min-width: 60px; font-weight: 500;';

            row.appendChild(nameSpan);
            row.appendChild(autoLabel);
            row.appendChild(showLabel);
            groupContainer.appendChild(row);
        });

        // ----- 延迟控制 -----
        const delayRow = document.createElement('div');
        delayRow.style.cssText = 'display: flex; align-items: center; margin-top: 12px; gap: 8px; border-top: 1px solid #eee; padding-top: 12px;';
        const delayLabel = document.createElement('span');
        delayLabel.textContent = '间隔(ms):';
        const delayInput = document.createElement('input');
        delayInput.type = 'range';
        delayInput.min = 200;
        delayInput.max = 3000;
        delayInput.step = 50;
        delayInput.value = settings.delay;
        delayInput.style.cssText = 'flex: 1;';
        const delayValue = document.createElement('span');
        delayValue.textContent = settings.delay;
        delayInput.oninput = () => {
            const val = parseInt(delayInput.value);
            delayValue.textContent = val;
            settings.delay = val;
            window.delayFill = val;
            saveSettings();
        };
        delayRow.appendChild(delayLabel);
        delayRow.appendChild(delayInput);
        delayRow.appendChild(delayValue);

        // ----- 按钮行 -----
        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display: flex; justify-content: space-between; margin-top: 12px; gap: 6px;';
        const runBtn = document.createElement('button');
        runBtn.textContent = '立即答题';
        runBtn.style.cssText = 'flex:1; padding: 6px 12px; background: #4caf50; color: white; border: none; border-radius: 4px; cursor: pointer;';
        runBtn.onclick = () => { main(); };
        const showAllBtn = document.createElement('button');
        showAllBtn.textContent = '显示所有答案';
        showAllBtn.style.cssText = 'flex:1; padding: 6px 12px; background: #ff9800; color: white; border: none; border-radius: 4px; cursor: pointer;';
        showAllBtn.onclick = () => { showAllAnswers(); };
        const clearBtn = document.createElement('button');
        clearBtn.textContent = '清除显示';
        clearBtn.style.cssText = 'flex:1; padding: 6px 12px; background: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer;';
        clearBtn.onclick = () => { clearAllAnswers(); };
        btnRow.appendChild(runBtn);
        btnRow.appendChild(showAllBtn);
        btnRow.appendChild(clearBtn);

        panel.appendChild(title);
        panel.appendChild(groupContainer);
        panel.appendChild(delayRow);
        panel.appendChild(btnRow);

        // ----- 提交模式（Radio）-----
        const modeRow = document.createElement('div');
        modeRow.style.cssText = 'margin-top: 12px; border-top: 1px solid #eee; padding-top: 12px;';
        const modeTitle = document.createElement('div');
        modeTitle.textContent = '提交模式：';
        modeTitle.style.cssText = 'font-weight: 600; margin-bottom: 6px;';
        modeRow.appendChild(modeTitle);

        const modeOpts = document.createElement('div');
        modeOpts.style.cssText = 'display: flex; gap: 14px;';

        const makeRadio = (value, labelText) => {
            const label = document.createElement('label');
            label.style.cssText = 'display: flex; align-items: center; gap: 4px; cursor: pointer;';
            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = 'welearn-submit-mode';
            radio.value = value;
            radio.checked = settings.submitMode === value;
            radio.onchange = () => {
                if (radio.checked) {
                    settings.submitMode = value;
                    saveSettings();
                    WriteConsole(`[设置] submitMode = ${value}`);
                }
            };
            label.appendChild(radio);
            label.appendChild(document.createTextNode(labelText));
            return label;
        };

        modeOpts.appendChild(makeRadio('manual', '手动'));
        modeOpts.appendChild(makeRadio('submit', '仅自动提交'));
        modeOpts.appendChild(makeRadio('submitAndNext', '自动提交并翻页'));
        modeRow.appendChild(modeOpts);
        panel.appendChild(modeRow);

        // ----- 单页挂机时长 -----
        const hangDurRow = document.createElement('div');
        hangDurRow.style.cssText = 'display: flex; align-items: center; margin-top: 10px; gap: 8px;';
        const hangDurLabel = document.createElement('span');
        hangDurLabel.textContent = '单页挂机时长(秒):';
        hangDurLabel.style.cssText = 'flex-shrink: 0;';
        const hangDurInput = document.createElement('input');
        hangDurInput.type = 'number';
        hangDurInput.min = 5;
        hangDurInput.max = 99999;
        hangDurInput.value = settings.hangDuration;
        hangDurInput.style.cssText = 'width: 90px; padding: 3px 6px; border: 1px solid #ccc; border-radius: 4px;';
        hangDurInput.onchange = () => {
            let v = parseInt(hangDurInput.value, 10);
            if (isNaN(v) || v < 5) v = 5;
            hangDurInput.value = v;
            settings.hangDuration = v;
            saveSettings();
            WriteConsole(`[设置] hangDuration = ${v} 秒`);
            if (settings.hangEnabled) {
                resetHangCountdown();
            }
        };
        hangDurRow.appendChild(hangDurLabel);
        hangDurRow.appendChild(hangDurInput);
        hangDurRow.appendChild(Object.assign(document.createElement('span'), {
            textContent: '（秒）',
            style: 'color:#999;font-size:12px;'
        }));
        panel.appendChild(hangDurRow);

        // ----- 挂机 开始/停止 -----
        const hangRow = document.createElement('div');
        hangRow.style.cssText = 'display: flex; align-items: center; margin-top: 8px; gap: 8px;';
        const hangStartBtn = document.createElement('button');
        hangStartBtn.textContent = '▶️ 开始挂机';
        hangStartBtn.style.cssText = 'flex:1; padding: 8px 12px; background: #009688; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;';
        hangStartBtn.onclick = startHangMode;
        const hangStopBtn = document.createElement('button');
        hangStopBtn.textContent = '⏹️ 停止挂机';
        hangStopBtn.style.cssText = 'flex:1; padding: 8px 12px; background: #795548; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;';
        hangStopBtn.onclick = stopHangMode;
        hangRow.appendChild(hangStartBtn);
        hangRow.appendChild(hangStopBtn);
        panel.appendChild(hangRow);

        // ----- 面板内的挂机状态 -----
        hangPanelStatusEl = document.createElement('div');
        hangPanelStatusEl.id = 'welearn-hang-status';
        hangPanelStatusEl.style.cssText = 'margin-top: 8px; font-size: 12px; color: #009688; text-align: center; min-height: 16px;';
        hangPanelStatusEl.textContent = settings.hangEnabled ? '挂机中...' : '挂机状态：未启动';
        panel.appendChild(hangPanelStatusEl);

        // ----- 分数覆盖 -----
        const scoreRow = document.createElement('div');
        scoreRow.style.cssText = 'display: flex; align-items: center; margin-top: 10px; gap: 8px; border-top: 1px solid #eee; padding-top: 10px;';
        const scoreLabel = document.createElement('span');
        scoreLabel.textContent = '目标分数:';
        const scoreInput = document.createElement('input');
        scoreInput.type = 'number';
        scoreInput.min = 0;
        scoreInput.max = 100;
        scoreInput.value = 100;
        scoreInput.style.cssText = 'width: 60px; padding: 3px 6px; border: 1px solid #ccc; border-radius: 4px;';
        const scoreSetBtn = document.createElement('button');
        scoreSetBtn.textContent = '覆盖分数';
        scoreSetBtn.style.cssText = 'padding: 4px 12px; background: #e91e63; color: white; border: none; border-radius: 4px; cursor: pointer;';
        scoreSetBtn.onclick = function() {
            const v = parseInt(scoreInput.value, 10);
            if (isNaN(v) || v < 0 || v > 100) {
                alert('请输入 0~100 的分数');
                return;
            }
            overrideScore(v);
        };
        scoreRow.appendChild(scoreLabel);
        scoreRow.appendChild(scoreInput);
        scoreRow.appendChild(scoreSetBtn);
        panel.appendChild(scoreRow);

        container.appendChild(panel);
        container.appendChild(toggleBtn);
        document.body.appendChild(container);

        // 挂机状态下刷新面板状态
        if (settings.hangEnabled) {
            updateHangDisplay();
        }

        function togglePanel() {
            uiVisible = !uiVisible;
            panel.style.display = uiVisible ? 'block' : 'none';
            toggleBtn.textContent = uiVisible ? '✖' : '⚙️';
        }

        document.addEventListener('click', (e) => {
            if (uiVisible && !container.contains(e.target)) {
                togglePanel();
            }
        });

        panel.style.display = 'none';
    }

    // ========== 8. 所有解题函数 ==========
    async function solveRecordingTasksPersistent() {
        const selectors = ['et-recorder', 'et-follow-me', 'et-talk'];
        const doc = getDoc();
        const win = doc.defaultView || window;
        const angular = win.angular;

        const itemEl = doc.querySelector('et-item');
        if (!itemEl) return;
        const itemCtrl = angular.element(itemEl).controller('etItem');
        if (!itemCtrl) {
            WriteConsole("未能获取到 et-item 控制器，无法持久化数据");
            return;
        }

        for (const tag of selectors) {
            const elements = doc.querySelectorAll(tag);
            for (const el of elements) {
                const id = el.id;
                if (!id) continue;

                let interaction = {
                    id: id,
                    record_count: 1,
                    isshared: false,
                    isdifficult: false,
                    result: "100",
                    learner_response: "mock_audio_" + id + ".mp3"
                };

                if (tag === 'et-recorder') {
                    interaction.type = "performance";
                } else if (tag === 'et-follow-me') {
                    interaction.type = "performance";
                    const count = el.querySelectorAll('.sentence').length || 1;
                    interaction.learner_response = Array(count).fill("follow.mp3").join("[,]");
                    interaction.result = Array(count).fill("100").join("[,]");
                } else if (tag === 'et-talk') {
                    interaction.type = "performance";
                    const count = el.querySelectorAll('flow[record]').length || 1;
                    interaction.learner_response = "ROLE_0[,]" + Array(count).fill("talk.mp3").join("[,]");
                    interaction.result = Array(count).fill("100").join("[,]");
                }

                itemCtrl.handleStatusChange({
                    id: id,
                    isCompleted: true,
                    isScored: false,
                    noProgress: false,
                    isDirty: true,
                    interaction: interaction
                });
            }
        }

        const rootScope = angular.element(doc.querySelector('.app, body')).injector().get('$rootScope');
        if (rootScope) {
            rootScope.$broadcast("toggleKey", true);
            if (!rootScope.$$phase) rootScope.$apply();
        }
    }

    async function solveWordPractice() {
        let practiceEl = document.querySelector('et-word-practice');

        if (!practiceEl || !practiceEl.classList.contains('visible')) {
            const startPracticeBtn = document.querySelector('et-button[action="wordbank.practice()"] button');
            if (startPracticeBtn) {
                startPracticeBtn.click();
                await new Promise(r => setTimeout(r, 1000));
                practiceEl = document.querySelector('et-word-practice');
            }
        }

        if (!practiceEl) return;

        const win = practiceEl.ownerDocument.defaultView || window;
        const angular = win.angular;
        const pCtrl = angular.element(practiceEl).controller('etWordPractice');
        const rootScope = angular.element(practiceEl.closest('.app') || win.document.body).injector().get('$rootScope');

        if (pCtrl) {
            if (pCtrl.current === 0) {
                WriteConsole("正在初始化练习列表...");
                rootScope.$apply(() => {
                    pCtrl.startPractice('choose-exp');
                });
                await new Promise(r => setTimeout(r, 500));
            }

            rootScope.$apply(() => {
                if (pCtrl.shuffledWords && pCtrl.shuffledWords.length > 0) {
                    pCtrl.shuffledWords.forEach(word => {
                        word.done = true;
                        word.correct = true;
                        word.answer = (word.type === 'type-in') ? word.name : word.key;
                    });

                    pCtrl.current = pCtrl.total;
                    rootScope.$broadcast('done', true);
                }
            });

            WriteConsole("词汇练习已完成，结算界面已弹出。");
        }
    }

    async function solveTofAndSelectTasks() {
        const doc = getDoc();
        const win = doc.defaultView || window;
        const angular = win.angular;

        const itemEl = doc.querySelector('et-item');
        if (!itemEl) return;
        const itemCtrl = angular.element(itemEl).controller('etItem');
        const rootScope = angular.element(doc.querySelector('.app, body') || doc.body).injector().get('$rootScope');

        const tofElements = doc.querySelectorAll('et-tof');
        for (const el of tofElements) {
            const id = el.id;
            const ctrl = angular.element(el).controller('etTof');
            if (!ctrl || !id) continue;

            let answerKey = el.getAttribute('key');
            if (!answerKey && ctrl.key) answerKey = ctrl.key[0];
            if (!answerKey) continue;

            const finalVal = answerKey.toLowerCase() === 't' ? 't' : 'f';
            const learnerResponse = finalVal === 't' ? 'true' : 'false';

            WriteConsole(`[判断题完成] ID:${id}, 答案:${learnerResponse}`);

            rootScope.$apply(() => {
                ctrl.value = [finalVal];
                itemCtrl.handleStatusChange({
                    id: id,
                    isCompleted: true,
                    isScored: true,
                    isDirty: true,
                    score: 1,
                    interaction: { id: id, type: "true_false", learner_response: learnerResponse, result: "correct" }
                });
            });
        }

        const selectElements = doc.querySelectorAll('et-select');
        for (const el of selectElements) {
            const id = el.id;
            const ctrl = angular.element(el).controller('etSelect');
            if (!ctrl || !id) continue;

            let answerKey = el.getAttribute('key');
            if (!answerKey) {
                const keyOpt = el.querySelector('option.key');
                answerKey = keyOpt ? keyOpt.value.replace('choice', '') : null;
            }
            if (!answerKey) continue;

            const choiceVal = "choice" + answerKey;

            WriteConsole(`[下拉题完成] ID:${id}, 答案:${choiceVal}`);

            rootScope.$apply(() => {
                ctrl.value = choiceVal;
                itemCtrl.handleStatusChange({
                    id: id,
                    isCompleted: true,
                    isScored: true,
                    isDirty: true,
                    score: 1,
                    interaction: { id: id, type: "multiple_choice", learner_response: choiceVal, result: "correct" }
                });
            });
        }

        if (!rootScope.$$phase) rootScope.$apply();
    }

    async function solveBlank() {
        const doc = getDoc();
        const win = doc.defaultView || window;
        const angular = win.angular;

        const itemEl = doc.querySelector('et-item');
        if (!itemEl) return;
        const itemCtrl = angular.element(itemEl).controller('etItem');
        const rootScope = angular.element(doc.querySelector('.app, body')).injector().get('$rootScope');

        const questions = doc.querySelectorAll('et-blank');

        for (const el of questions) {
            const id = el.id;
            const tag = el.tagName.toLowerCase();
            let answer = null;
            let interactionType = "fill_in";

            const keyEl = el.querySelector('.key');
            if (keyEl) answer = keyEl.textContent.trim();

            if (answer !== null && id) {
                WriteConsole(`[自动填入] 题型:${tag}, ID:${id}, 答案:${answer}`);

                if (tag === 'et-blank') {
                    rootScope.$broadcast("optionIn." + id, answer);
                }

                itemCtrl.handleStatusChange({
                    id: id,
                    isCompleted: true,
                    isScored: true,
                    isDirty: true,
                    score: 1,
                    interaction: {
                        id: id,
                        type: interactionType,
                        learner_response: answer,
                        result: "correct"
                    }
                });
            }
        }

        if (!rootScope.$$phase) rootScope.$apply();
    }

    async function solveChoice(){
        const doc = getDoc();
        const win = doc.defaultView || window;
        const angular = win.angular;

        const appRoot = doc.querySelector('.app, [ng-app], body');
        if (!appRoot) return;
        const injector = angular.element(appRoot).injector();
        const rootScope = injector.get('$rootScope');
        const choiceElements = doc.querySelectorAll('et-choice');
        for (const el of choiceElements) {
            const id = el.id;
            if (!id) continue;

            const cCtrl = angular.element(el).controller('etChoice');
            if (cCtrl && cCtrl.hasKey && cCtrl.key) {
                const correctIndices = cCtrl.key;
                const answerStr = correctIndices.map(idx => "choice" + (idx + 1)).join("[,]");

                WriteConsole(`[内存提取] 选择题ID:${id}, 正确索引:${correctIndices}`);

                const itemEl = doc.querySelector('et-item');
                const itemCtrl = angular.element(itemEl).controller('etItem');
                if (itemCtrl) {
                    itemCtrl.handleStatusChange({
                        id: id,
                        isCompleted: true,
                        isScored: true,
                        isDirty: true,
                        score: correctIndices.length,
                        interaction: {
                            id: id,
                            type: "multiple_choice",
                            learner_response: answerStr,
                            result: "correct"
                        }
                    });
                }

                rootScope.$broadcast("answerRestore." + id, { learner_response: answerStr });
            }
        }

        if (!rootScope.$$phase) rootScope.$apply();
    }

    async function solveMatchingTasks() {
        const doc = getDoc();
        const win = doc.defaultView || window;
        const angular = win.angular;

        const itemEl = doc.querySelector('et-item');
        if (!itemEl) return;
        const itemCtrl = angular.element(itemEl).controller('etItem');
        const rootScope = angular.element(doc.querySelector('.app, body') || doc.body).injector().get('$rootScope');

        const matchingElements = doc.querySelectorAll('et-matching');

        for (const el of matchingElements) {
            const id = el.id;
            const ctrl = angular.element(el).controller('etMatching');

            if (ctrl && id) {
                let answersList = [];
                if (ctrl.keys && ctrl.keys.length > 0) {
                    ctrl.keys.forEach((targets, leftIndex) => {
                        if (Array.isArray(targets)) {
                            targets.forEach(rightIndex => {
                                answersList.push(`${leftIndex}[.]${rightIndex}`);
                            });
                        }
                    });
                }

                const responseStr = answersList.join("[,]");

                if (responseStr) {
                    WriteConsole(`[连线题内存提取] ID:${id}, 答案序列:${responseStr}`);

                    itemCtrl.handleStatusChange({
                        id: id,
                        isCompleted: true,
                        isScored: true,
                        isDirty: true,
                        score: ctrl.keys.length,
                        interaction: {
                            id: id,
                            type: "matching",
                            learner_response: responseStr,
                            result: "correct"
                        }
                    });

                    rootScope.$broadcast("answerRestore." + id, {
                        learner_response: responseStr
                    });
                }
            }
        }

        if (!rootScope.$$phase) rootScope.$apply();
        rootScope.$broadcast("viewChange");
    }

    async function goToNextPage() {
        const doc = getDoc();
        const win = doc.defaultView || window;
        const angular = win.angular;
        if (!angular) {
            WriteConsole('[翻页] 未检测到 Angular');
            return 'fail';
        }
        const appRoot = doc.querySelector('.app, [ng-app], body');
        if (!appRoot) {
            WriteConsole('[翻页] 未找到 appRoot');
            return 'fail';
        }

        let injector;
        try {
            injector = angular.element(appRoot).injector();
        } catch (e) {
            WriteConsole('[翻页] 获取 injector 失败:', e);
            return 'fail';
        }

        try {
            const apiService = injector.get('apiService');
            const pathInfo   = injector.get('pathInfo');
            const appConfig  = injector.get('appConfig');

            const current = pathInfo && pathInfo.current;
            if (!current) {
                WriteConsole('[翻页] 无法获取 pathInfo.current');
                return 'fail';
            }
            if (!current.nextSco) {
                WriteConsole('[翻页] 已是最后一页');
                return 'last';
            }

            const next = current.nextSco;
            WriteConsole('[翻页] 目标下一页:', next.title || next.id, '| noweb =', !!next.noweb);

            if (appConfig && appConfig.debug) {
                win.location.hash = '#' + next.url;
            } else if (next.noweb) {
                const ok = apiService.set("cci.service.goto", "ITEM-m-" + next.id);
                apiService.commit();
                WriteConsole('[翻页] set cci.service.goto = ITEM-m-' + next.id, '结果:', ok);
            } else {
                const ok = apiService.set("cci.service.goto", "ITEM-" + next.id);
                apiService.commit();
                WriteConsole('[翻页] set cci.service.goto = ITEM-' + next.id, '结果:', ok);
            }
            return 'moved';
        } catch (e) {
            WriteConsole('[翻页] 异常:', e);
            return 'fail';
        }
    }

    async function doSubmit(maxRetry = 3) {
        const doc = getDoc();
        const win = doc.defaultView || window;
        const angular = win.angular;
        if (!angular) return 'fail';

        const itemEl = doc.querySelector('et-item');
        if (!itemEl) {
            WriteConsole('[提交] 当前页面无 et-item');
            return 'skip';
        }
        let itemCtrl;
        try {
            itemCtrl = angular.element(itemEl).controller('etItem');
        } catch (e) { return 'fail'; }
        if (!itemCtrl || typeof itemCtrl.submit !== 'function') return 'fail';

        if (itemCtrl.isSubmitted) {
            WriteConsole('[提交] 已提交，跳过');
            return 'skip';
        }

        let progressReady = false;
        for (let i = 0; i < maxRetry; i++) {
            try {
                if (typeof itemCtrl.updateScormInfo === 'function') {
                    itemCtrl.updateScormInfo();
                }
            } catch (e) {}

            const info = itemCtrl.scormInfo || {};
            const progressNum = Number(info.progressMeasure);
            WriteConsole(`[提交] 进度检查 ${i + 1}/${maxRetry}: progress=${info.progressMeasure}`);

            if (info.progressMeasure === '1' || progressNum >= 1) {
                progressReady = true;
                break;
            }
            if (i < maxRetry - 1) {
                await sleep(1500);
                // 让 Angular 也刷新一遍
                try {
                    const rootScope = angular.element(doc.querySelector('.app, body')).injector().get('$rootScope');
                    if (rootScope && !rootScope.$$phase) rootScope.$apply();
                } catch (e) {}
            }
        }
        if (!progressReady) {
            WriteConsole('[提交] progress 一直不足 1，可能仍有未完成题目');
            // 仍尝试提交一次，让平台自己的 reject 逻辑决定
        }

        WriteConsole('[提交] 提交中...');
        try {
            await itemCtrl.submit();
            WriteConsole('[提交] 完成');
            return 'done';
        } catch (e) {
            WriteConsole('[提交] 被拒绝:', e);
            return 'fail';
        }
    }

    // ========== 9. 自动提交与翻页 ==========
    async function autoSubmitAndNext(forceNext = false) {
        if (!forceNext && settings.submitMode === 'manual') return;

        // ---------- 1) 提交 ----------
        if (forceNext || settings.autoSubmit) {
            let submitResult = await doSubmit();
            WriteConsole('[自动提交] 结果:', submitResult);

            let retry = 0;
            while (submitResult === 'fail' && retry < 2) {
                retry++;
                WriteConsole(`[自动提交] 第 ${retry} 次重试...`);
                await sleep(2000);
                submitResult = await doSubmit();
                WriteConsole(`[自动提交] 重试 ${retry} 结果:`, submitResult);
            }

            if (submitResult === 'fail') {
                WriteConsole('[自动提交] 多次提交失败，放弃翻页');
                return;
            }
        }

        // ---------- 2) 翻页 ----------
        if (forceNext || settings.autoNext) {
            await sleep(2000);
            const r = await goToNextPage();
            WriteConsole('[自动翻页] 结果:', r);
        }
    }

    // ========== 10. 分数覆盖 ==========
    async function overrideScore(targetScaled) {
        const doc = getDoc();
        const win = doc.defaultView || window;
        const angular = win.angular;
        if (!angular) return;

        const itemEl = doc.querySelector('et-item');
        if (!itemEl) {
            alert('当前页面没有 et-item，无法覆盖分数');
            return;
        }
        const injector = angular.element(doc.querySelector('.app, [ng-app], body')).injector();
        const itemCtrl = angular.element(itemEl).controller('etItem');
        const apiService = injector.get('apiService');
        const rootScope = injector.get('$rootScope');

        const scaled = Math.max(0, Math.min(100, Number(targetScaled) || 0));

        rootScope.$apply(() => {
            if (itemCtrl.scormInfo) {
                itemCtrl.scormInfo.score.scaled = String(scaled);
                itemCtrl.scormInfo.score.raw = String(scaled);
                itemCtrl.scormInfo.progressMeasure = '1';
                itemCtrl.scormInfo.completionStatus = 'completed';
            }
        });

        apiService.set('cmi.score.scaled', String(scaled));
        apiService.set('cmi.score.raw', String(scaled));
        apiService.set('cmi.progress_measure', '1');
        apiService.set('cmi.completion_status', 'completed');
        apiService.commit();

        WriteConsole(`[分数覆盖] 已写入 scaled=${scaled}`);
    }

    // ========== 11. 主答题函数 ==========
    async function main() {
        WriteConsole("WELearn Auto Fill 开始执行答题");

        window.delayFill = settings.delay;

        const doc = getDoc();
        const win = doc.defaultView || window;
        const angular = win.angular;
        if (!angular) {
            WriteConsole("未检测到 Angular，可能不是 WELearn 页面");
            return;
        }

        const tasks = [
            { key: 'recording', fn: solveRecordingTasksPersistent },
            { key: 'choice', fn: solveChoice },
            { key: 'blank', fn: solveBlank },
            { key: null, fn: solveTofAndSelectTasks, requires: ['tof', 'select'] },
            { key: 'matching', fn: solveMatchingTasks },
            { key: 'wordPractice', fn: solveWordPractice }
        ];

        for (const task of tasks) {
            let shouldRun;
            if (task.requires) {
                shouldRun = task.requires.some(k => settings.autoFill[k]);
            } else {
                shouldRun = settings.autoFill[task.key];
            }
            if (shouldRun) {
                WriteConsole(`自动答题: ${task.key || task.requires.join('+')}`);
                try {
                    await task.fn();
                } catch (e) {
                    WriteConsole(`执行任务出错:`, e);
                }
            } else {
                WriteConsole(`跳过 ${task.key || task.requires.join('+')} (自动关闭)`);
            }
        }

        // 显示答案
        const showTypes = ['choice', 'blank', 'tof', 'select', 'matching'];
        showTypes.forEach(type => {
            if (settings.showAnswer[type]) {
                setTimeout(() => showAnswersForType(type), 300);
            }
        });

        WriteConsole("所有任务执行完毕");

        // ---------- 提交/翻页调度 ----------
        if (settings.hangEnabled) {
            WriteConsole('[挂机] 页面就绪，启动单页倒计时');
            resetHangCountdown();
        } else if (settings.submitMode === 'manual') {
            WriteConsole('[提交] 手动模式，等待用户操作');
        } else {
            // 再等 1 秒让 Angular 完成最后一轮 $digest
            await sleep(1000);
            WriteConsole(`执行 提交模式=${settings.submitMode}`);
            try {
                await autoSubmitAndNext(false);
            } catch (e) {
                WriteConsole('autoSubmitAndNext 出错:', e);
            }
        }
    }

    // ========== 12. 翻页检测与自动触发 ==========
    let lastUrl = location.href;
    let checkTimer = null;

    function startUrlWatcher() {
        if (checkTimer) clearInterval(checkTimer);
        checkTimer = setInterval(() => {
            const currentUrl = location.href;
            if (currentUrl !== lastUrl) {
                lastUrl = currentUrl;
                WriteConsole(`检测到 URL 变化: ${currentUrl}`);
                setTimeout(main, 1000);
            }
        }, 500);
    }

    function installConfirmBypass() {
        const targets = [];
        const push = (w, tag) => {
            if (!w) return;
            try { targets.push([w, tag]); } catch (e) {}
        };
        try { push(window, 'sandbox-window'); } catch (e) {}
        try { if (typeof unsafeWindow !== 'undefined') push(unsafeWindow, 'unsafeWindow'); } catch (e) {}
        try { if (window.parent && window.parent !== window) push(window.parent, 'parent'); } catch (e) {}
        try { if (window.top && window.top !== window) push(window.top, 'top'); } catch (e) {}

        const seen = new Set();
        targets.forEach(([w, tag]) => {
            if (seen.has(w)) return;
            seen.add(w);
            try {
                const origConfirm = w.confirm;
                const origAlert   = w.alert;
                const newConfirm = function(msg) {
                    WriteConsole(`[Bypass] 拦截 confirm(${tag}):`, msg);
                    return true;   // 永远点确定
                };
                const newAlert = function(msg) {
                    WriteConsole(`[Bypass] 拦截 alert(${tag}):`, msg);
                };
                // 优先用 defineProperty，绕过某些只读属性
                try {
                    Object.defineProperty(w, 'confirm', {
                        configurable: true, writable: true, value: newConfirm
                    });
                } catch (e) {
                    w.confirm = newConfirm;
                }
                try {
                    Object.defineProperty(w, 'alert', {
                        configurable: true, writable: true, value: newAlert
                    });
                } catch (e) {
                    w.alert = newAlert;
                }
                WriteConsole(`[Bypass] 已劫持 [${tag}] 的 confirm/alert`);
            } catch (e) {
                WriteConsole(`[Bypass] 无法劫持 [${tag}]:`, e);
            }
        });
    }
    // ========== 13. 初始化 ==========
    (function init() {
        installConfirmBypass();

        loadSettings();
        createUI();

        // 如果本地已开启挂机，启动指示器
        if (settings.hangEnabled) {
            getHangIndicator();
            updateHangDisplay();
        }

        setTimeout(main, 1000);
        startUrlWatcher();
    })();

})();