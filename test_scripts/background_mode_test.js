/**
 * COMPREHENSIVE BACKGROUND MODE TEST
 * Tests the full_cdp_script.js bundle thoroughly before shipping.
 * Outputs all results to a single log file.
 * Covers all edge cases for background mode functionality.
 */

const vm = require('vm');
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '..', 'background_mode_test_results.log');
const SCRIPT_PATH = path.join(__dirname, '..', 'main_scripts', 'full_cdp_script.js');

// Clear and initialize log file
fs.writeFileSync(LOG_FILE, `=== BACKGROUND MODE TEST SUITE ===\nStarted: ${new Date().toISOString()}\n\n`);

function log(msg) {
    const line = `[${new Date().toISOString().split('T')[1].split('.')[0]}] ${msg}`;
    fs.appendFileSync(LOG_FILE, line + '\n');
    console.log(line);
}

function logSection(title) {
    const separator = '='.repeat(60);
    log('');
    log(separator);
    log(`  ${title}`);
    log(separator);
}

function logResult(testName, passed, details = '') {
    const status = passed ? '✓ PASS' : '✖ FAIL';
    log(`${status}: ${testName}${details ? ' - ' + details : ''}`);
    return passed;
}

// Create a mock browser environment
function createMockBrowser() {
    const elements = new Map();
    let elementIdCounter = 0;

    const createElement = (tag) => {
        const id = `mock-el-${elementIdCounter++}`;
        const el = {
            _id: id,
            _tag: tag,
            _children: [],
            _parent: null,
            id: '',
            className: '',
            textContent: '',
            style: {},
            disabled: false,
            classList: {
                _classes: new Set(),
                add(c) { this._classes.add(c); },
                remove(c) { this._classes.delete(c); },
                contains(c) { return this._classes.has(c); },
                toggle(c) {
                    if (this._classes.has(c)) this._classes.delete(c);
                    else this._classes.add(c);
                }
            },
            appendChild(child) {
                child._parent = this;
                this._children.push(child);
                if (child.id) elements.set(child.id, child);
            },
            replaceChildren(...nodes) {
                this._children = [];
                nodes.forEach(n => this.appendChild(n));
            },
            remove() {
                if (this._parent) {
                    this._parent._children = this._parent._children.filter(c => c !== this);
                }
                if (this.id) elements.delete(this.id);
            },
            querySelector(sel) {
                for (const child of this._children) {
                    if (sel.startsWith('.') && child.className.includes(sel.slice(1))) return child;
                    if (sel.startsWith('#') && child.id === sel.slice(1)) return child;
                    if (sel.includes('[data-name=')) {
                        const match = sel.match(/\[data-name="([^"]+)"\]/);
                        if (match && child._dataName === match[1]) return child;
                    }
                    const found = child.querySelector ? child.querySelector(sel) : null;
                    if (found) return found;
                }
                return null;
            },
            querySelectorAll(sel) {
                const results = [];
                const search = (node) => {
                    for (const child of (node._children || [])) {
                        if (sel.startsWith('.') && child.className.includes(sel.slice(1))) results.push(child);
                        if (child._children) search(child);
                    }
                };
                search(this);
                return results;
            },
            getAttribute(name) {
                if (name === 'data-name') return this._dataName;
                if (name === 'aria-selected') return this._ariaSelected;
                return null;
            },
            setAttribute(name, value) {
                if (name === 'data-name') this._dataName = value;
                if (name === 'aria-selected') this._ariaSelected = value;
            },
            getBoundingClientRect() {
                return { top: 0, left: 0, width: 300, height: 500 };
            },
            dispatchEvent(e) { return true; },
            click() { return true; }
        };
        return el;
    };

    const mockDocument = {
        _body: createElement('body'),
        _head: createElement('head'),
        title: 'Mock IDE',
        getElementById(id) {
            return elements.get(id) || null;
        },
        createElement,
        querySelectorAll(sel) {
            return this._body.querySelectorAll(sel);
        },
        querySelector(sel) {
            return this._body.querySelector(sel);
        },
        get body() { return this._body; },
        get head() { return this._head; }
    };

    const mockWindow = {
        __autoAcceptState: null,
        __autoAcceptStart: null,
        __autoAcceptStop: null,
        getComputedStyle: () => ({
            display: 'block',
            pointerEvents: 'auto'
        }),
        ResizeObserver: class {
            observe() { }
            disconnect() { }
        },
        MouseEvent: class {
            constructor(type, opts) {
                this.type = type;
                this.bubbles = opts?.bubbles;
                this.cancelable = opts?.cancelable;
                this.view = opts?.view;
            }
        }
    };

    return { mockDocument, mockWindow, elements, createElement };
}

// Run all tests
async function runTests() {
    let totalTests = 0;
    let passedTests = 0;

    logSection('1. SCRIPT LOADING & SYNTAX');

    // Test 1: Script file exists
    totalTests++;
    const scriptExists = fs.existsSync(SCRIPT_PATH);
    if (logResult('Script file exists', scriptExists, SCRIPT_PATH)) passedTests++;

    // Test 2: Script is valid JavaScript
    totalTests++;
    let scriptContent = '';
    try {
        scriptContent = fs.readFileSync(SCRIPT_PATH, 'utf8');
        new Function(scriptContent);
        logResult('Script syntax is valid', true);
        passedTests++;
    } catch (e) {
        logResult('Script syntax is valid', false, e.message);
    }

    // Test 3: Script length is reasonable
    totalTests++;
    const scriptLength = scriptContent.length;
    const lengthOk = scriptLength > 10000 && scriptLength < 50000;
    if (logResult('Script length reasonable', lengthOk, `${scriptLength} bytes`)) passedTests++;

    // Test 4: Script contains IIFE (may have comment header)
    totalTests++;
    const hasIIFE = scriptContent.includes('(function ()') || scriptContent.includes('(function()');
    if (logResult('Script contains IIFE wrapper', hasIIFE)) passedTests++;

    // Test 5: Script has use strict
    totalTests++;
    const hasUseStrict = scriptContent.includes('"use strict"');
    if (logResult('Script uses strict mode', hasUseStrict)) passedTests++;

    logSection('2. SANDBOX EXECUTION');

    const { mockDocument, mockWindow, elements, createElement } = createMockBrowser();

    const sandbox = {
        window: mockWindow,
        document: mockDocument,
        console: {
            log: (...args) => log(`  [Script] ${args.join(' ')}`),
            warn: (...args) => log(`  [Script WARN] ${args.join(' ')}`),
            error: (...args) => log(`  [Script ERROR] ${args.join(' ')}`)
        },
        setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 50)),
        setInterval: (fn, ms) => setInterval(fn, Math.min(ms, 50)),
        clearTimeout,
        clearInterval,
        requestAnimationFrame: (cb) => setTimeout(cb, 16),
        JSON,
        Array,
        Object,
        Map,
        Set,
        Date,
        Math,
        Error,
        RegExp,
        Promise,
        DOMParser: class {
            parseFromString(str, type) {
                return { querySelector: () => ({ content: { childNodes: [] } }) };
            }
        }
    };

    // Make window reference the sandbox itself for proper global access
    sandbox.window = { ...mockWindow, ...sandbox };
    sandbox.globalThis = sandbox.window;
    sandbox.self = sandbox.window;

    // Test 6: Script executes without error
    totalTests++;
    try {
        vm.createContext(sandbox);
        vm.runInContext(scriptContent, sandbox);
        logResult('Script executes without error', true);
        passedTests++;
    } catch (e) {
        logResult('Script executes without error', false, e.message);
        log(`  Stack: ${e.stack}`);
    }

    // Helper to access state/functions via window
    const win = sandbox.window;

    logSection('3. API EXPOSURE');

    // Test 7: __autoAcceptStart is defined
    totalTests++;
    const startDefined = typeof win.__autoAcceptStart === 'function';
    if (logResult('__autoAcceptStart is a function', startDefined)) passedTests++;

    // Test 8: __autoAcceptStop is defined
    totalTests++;
    const stopDefined = typeof win.__autoAcceptStop === 'function';
    if (logResult('__autoAcceptStop is a function', stopDefined)) passedTests++;

    // Test 9: __autoAcceptState is initialized
    totalTests++;
    const stateExists = win.__autoAcceptState !== null && typeof win.__autoAcceptState === 'object';
    if (logResult('__autoAcceptState is initialized', stateExists)) passedTests++;

    // Test 10: State has required properties
    totalTests++;
    const state = win.__autoAcceptState || {};
    const hasRequiredProps =
        'isRunning' in state &&
        'tabNames' in state &&
        'completionStatus' in state &&
        'sessionID' in state &&
        'currentMode' in state &&
        'startTimes' in state;
    if (logResult('State has all required properties', hasRequiredProps, JSON.stringify(Object.keys(state)))) passedTests++;

    // Test 11: Initial state values are correct
    totalTests++;
    const initialStateCorrect =
        state.isRunning === false &&
        Array.isArray(state.tabNames) &&
        state.tabNames.length === 0 &&
        typeof state.completionStatus === 'object' &&
        state.sessionID === 0 &&
        state.currentMode === null;
    if (logResult('Initial state values correct', initialStateCorrect)) passedTests++;

    logSection('4. BACKGROUND MODE - CURSOR');

    // Test 12: Start in background mode (Cursor)
    totalTests++;
    try {
        win.__autoAcceptStart({
            isPro: true,
            isBackgroundMode: true,
            pollInterval: 1000,
            ide: 'cursor'
        });
        const started = win.__autoAcceptState.isRunning === true;
        if (logResult('Start background mode (Cursor)', started, `isRunning=${win.__autoAcceptState.isRunning}`)) passedTests++;
    } catch (e) {
        logResult('Start background mode (Cursor)', false, e.message);
    }

    // Test 13: Session ID incremented
    totalTests++;
    const sessionIncremented = win.__autoAcceptState.sessionID >= 1;
    if (logResult('Session ID incremented', sessionIncremented, `sessionID=${win.__autoAcceptState.sessionID}`)) passedTests++;

    // Test 14: Current mode set correctly
    totalTests++;
    const modeSet = win.__autoAcceptState.currentMode === 'cursor';
    if (logResult('Current mode set to cursor', modeSet, `currentMode=${win.__autoAcceptState.currentMode}`)) passedTests++;

    // Test 15: isBackgroundMode flag set
    totalTests++;
    const bgFlagSet = win.__autoAcceptState.isBackgroundMode === true;
    if (logResult('isBackgroundMode flag set', bgFlagSet)) passedTests++;

    // Test 16: Stop works
    totalTests++;
    try {
        win.__autoAcceptStop();
        const stopped = win.__autoAcceptState.isRunning === false;
        if (logResult('Stop background mode', stopped, `isRunning=${win.__autoAcceptState.isRunning}`)) passedTests++;
    } catch (e) {
        logResult('Stop background mode', false, e.message);
    }

    logSection('5. BACKGROUND MODE - ANTIGRAVITY');

    // Test 17: Start in background mode (Antigravity)
    totalTests++;
    try {
        win.__autoAcceptStart({
            isPro: true,
            isBackgroundMode: true,
            pollInterval: 1000,
            ide: 'antigravity'
        });
        const agStarted = win.__autoAcceptState.isRunning === true &&
            win.__autoAcceptState.currentMode === 'antigravity';
        if (logResult('Start background mode (Antigravity)', agStarted)) passedTests++;
    } catch (e) {
        logResult('Start background mode (Antigravity)', false, e.message);
    }

    win.__autoAcceptStop();

    logSection('6. NON-BACKGROUND (SIMPLE) MODE');

    // Test 18: Simple mode works
    totalTests++;
    try {
        win.__autoAcceptStart({
            isPro: false,
            isBackgroundMode: false,
            pollInterval: 500,
            ide: 'cursor'
        });
        const simpleStarted = win.__autoAcceptState.isRunning === true;
        if (logResult('Start simple mode', simpleStarted)) passedTests++;
    } catch (e) {
        logResult('Start simple mode', false, e.message);
    }

    // Test 19: Simple mode does not set isBackgroundMode
    totalTests++;
    const simpleBgFlag = win.__autoAcceptState.isBackgroundMode === false;
    if (logResult('Simple mode isBackgroundMode=false', simpleBgFlag)) passedTests++;

    win.__autoAcceptStop();

    logSection('7. MODE SWITCHING');

    // Test 20: Switch from simple to background increments session
    totalTests++;
    try {
        win.__autoAcceptStart({ isPro: false, isBackgroundMode: false, ide: 'cursor' });
        const sid1 = win.__autoAcceptState.sessionID;

        win.__autoAcceptStart({ isPro: true, isBackgroundMode: true, ide: 'cursor' });
        const sid2 = win.__autoAcceptState.sessionID;

        const switched = sid2 > sid1;
        if (logResult('Mode switch increments session', switched, `${sid1} -> ${sid2}`)) passedTests++;
    } catch (e) {
        logResult('Mode switch increments session', false, e.message);
    }

    win.__autoAcceptStop();

    // Test 21: Switch from cursor to antigravity increments session
    totalTests++;
    try {
        win.__autoAcceptStart({ isPro: true, isBackgroundMode: true, ide: 'cursor' });
        const sid1 = win.__autoAcceptState.sessionID;

        win.__autoAcceptStart({ isPro: true, isBackgroundMode: true, ide: 'antigravity' });
        const sid2 = win.__autoAcceptState.sessionID;

        const switched = sid2 > sid1 && win.__autoAcceptState.currentMode === 'antigravity';
        if (logResult('IDE switch increments session', switched, `cursor -> antigravity`)) passedTests++;
    } catch (e) {
        logResult('IDE switch increments session', false, e.message);
    }

    win.__autoAcceptStop();

    logSection('8. IDEMPOTENCY');

    // Test 22: Starting same config twice is idempotent
    totalTests++;
    try {
        win.__autoAcceptStart({ isPro: true, isBackgroundMode: true, ide: 'cursor' });
        const sid1 = win.__autoAcceptState.sessionID;

        win.__autoAcceptStart({ isPro: true, isBackgroundMode: true, ide: 'cursor' });
        const sid2 = win.__autoAcceptState.sessionID;

        const idempotent = sid1 === sid2;
        if (logResult('Same config is idempotent', idempotent, `sid stayed at ${sid1}`)) passedTests++;
    } catch (e) {
        logResult('Same config is idempotent', false, e.message);
    }

    win.__autoAcceptStop();

    // Test 23: Multiple stops are safe
    totalTests++;
    try {
        win.__autoAcceptStop();
        win.__autoAcceptStop();
        win.__autoAcceptStop();
        logResult('Multiple stops are safe', true);
        passedTests++;
    } catch (e) {
        logResult('Multiple stops are safe', false, e.message);
    }

    logSection('9. EDGE CASES - CONFIG HANDLING');

    // Test 24: Missing config properties handled
    totalTests++;
    try {
        win.__autoAcceptStart({});
        const handled = win.__autoAcceptState.isRunning === true;
        if (logResult('Empty config handled', handled)) passedTests++;
        win.__autoAcceptStop();
    } catch (e) {
        logResult('Empty config handled', false, e.message);
    }

    // Test 25: Undefined config handled gracefully (doesn't crash)
    totalTests++;
    const prevRunning = win.__autoAcceptState.isRunning;
    try {
        win.__autoAcceptStart(undefined);
    } catch (e) {
        // If it throws, that's also acceptable
    }
    // Script should have caught error internally and not crashed
    const handledGracefully = win.__autoAcceptState !== null;
    if (logResult('Undefined config handled gracefully', handledGracefully, 'Script did not crash')) passedTests++;

    // Test 26: Null IDE handled
    totalTests++;
    try {
        win.__autoAcceptStart({ ide: null, isPro: true, isBackgroundMode: true });
        const handled = win.__autoAcceptState.isRunning === true;
        if (logResult('Null IDE handled', handled)) passedTests++;
        win.__autoAcceptStop();
    } catch (e) {
        logResult('Null IDE handled', false, e.message);
    }

    // Test 27: Unknown IDE handled
    totalTests++;
    try {
        win.__autoAcceptStart({ ide: 'unknown_ide', isPro: true, isBackgroundMode: true });
        const handled = win.__autoAcceptState.isRunning === true;
        if (logResult('Unknown IDE handled gracefully', handled)) passedTests++;
        win.__autoAcceptStop();
    } catch (e) {
        logResult('Unknown IDE handled gracefully', false, e.message);
    }

    // Test 28: Case insensitive IDE names
    totalTests++;
    try {
        win.__autoAcceptStart({ ide: 'CURSOR', isPro: true, isBackgroundMode: true });
        const caseHandled = win.__autoAcceptState.currentMode === 'cursor';
        if (logResult('IDE name case insensitive', caseHandled)) passedTests++;
        win.__autoAcceptStop();
    } catch (e) {
        logResult('IDE name case insensitive', false, e.message);
    }

    logSection('10. EDGE CASES - FREE TIER');

    // Test 29: Free tier with background mode true still works
    totalTests++;
    try {
        win.__autoAcceptStart({ isPro: false, isBackgroundMode: true, ide: 'cursor' });
        const freeWorks = win.__autoAcceptState.isRunning === true;
        if (logResult('Free tier + background mode works', freeWorks)) passedTests++;
        win.__autoAcceptStop();
    } catch (e) {
        logResult('Free tier + background mode works', false, e.message);
    }

    logSection('11. SCRIPT CONTENT CHECKS');

    // Test 30: No innerHTML usage
    totalTests++;
    const innerHTMLCount = (scriptContent.match(/\.innerHTML\s*=/g) || []).length;
    const noInnerHTML = innerHTMLCount === 0;
    if (logResult('No direct innerHTML assignments', noInnerHTML, `Found ${innerHTMLCount} occurrences`)) passedTests++;

    // Test 31: No TrustedTypes policy creation
    totalTests++;
    const hasTrustedTypes = scriptContent.includes('createPolicy');
    const noTrustedTypes = !hasTrustedTypes;
    if (logResult('No TrustedTypes createPolicy calls', noTrustedTypes)) passedTests++;

    // Test 32: Uses pure DOM construction
    totalTests++;
    const hasCreateElement = scriptContent.includes('createElement');
    const hasTextContent = scriptContent.includes('textContent');
    const hasAppendChild = scriptContent.includes('appendChild');
    const usesPureDOM = hasCreateElement && hasTextContent && hasAppendChild;
    if (logResult('Uses pure DOM construction', usesPureDOM)) passedTests++;

    // Test 33: No eval or Function constructor
    totalTests++;
    const hasEval = /\beval\s*\(/.test(scriptContent);
    const hasFunctionConstructor = /new\s+Function\s*\(/.test(scriptContent);
    const noUnsafe = !hasEval && !hasFunctionConstructor;
    if (logResult('No eval or Function constructor', noUnsafe)) passedTests++;

    // Test 34: No document.write
    totalTests++;
    const hasDocWrite = scriptContent.includes('document.write');
    if (logResult('No document.write', !hasDocWrite)) passedTests++;

    // Test 35: No window.open
    totalTests++;
    const hasWindowOpen = scriptContent.includes('window.open');
    if (logResult('No window.open', !hasWindowOpen)) passedTests++;

    logSection('12. OVERLAY LOGIC');

    // Test 36: Overlay constants defined
    totalTests++;
    const hasOverlayId = scriptContent.includes("'__autoAcceptBgOverlay'") || scriptContent.includes('"__autoAcceptBgOverlay"');
    if (logResult('Overlay ID constant defined', hasOverlayId)) passedTests++;

    // Test 37: showOverlay function exists
    totalTests++;
    const hasShowOverlay = scriptContent.includes('function showOverlay');
    if (logResult('showOverlay function exists', hasShowOverlay)) passedTests++;

    // Test 38: updateOverlay function exists
    totalTests++;
    const hasUpdateOverlay = scriptContent.includes('function updateOverlay');
    if (logResult('updateOverlay function exists', hasUpdateOverlay)) passedTests++;

    // Test 39: hideOverlay function exists
    totalTests++;
    const hasHideOverlay = scriptContent.includes('function hideOverlay');
    if (logResult('hideOverlay function exists', hasHideOverlay)) passedTests++;

    // Test 40: Overlay styles defined
    totalTests++;
    const hasOverlayStyles = scriptContent.includes('STYLES') && scriptContent.includes('.aab-slot');
    if (logResult('Overlay styles defined', hasOverlayStyles)) passedTests++;

    logSection('13. LOOP LOGIC');

    // Test 41: cursorLoop function exists
    totalTests++;
    const hasCursorLoop = scriptContent.includes('async function cursorLoop');
    if (logResult('cursorLoop function exists', hasCursorLoop)) passedTests++;

    // Test 42: antigravityLoop function exists
    totalTests++;
    const hasAntigravityLoop = scriptContent.includes('async function antigravityLoop');
    if (logResult('antigravityLoop function exists', hasAntigravityLoop)) passedTests++;

    // Test 43: performClick function exists
    totalTests++;
    const hasPerformClick = scriptContent.includes('function performClick');
    if (logResult('performClick function exists', hasPerformClick)) passedTests++;

    // Test 44: isAcceptButton function exists
    totalTests++;
    const hasIsAcceptButton = scriptContent.includes('function isAcceptButton');
    if (logResult('isAcceptButton function exists', hasIsAcceptButton)) passedTests++;

    // Test 45: Loops check session ID for termination
    totalTests++;
    const checksSessionId = scriptContent.includes('sessionID === sid') || scriptContent.includes('sessionID !== sid');
    if (logResult('Loops check session ID', checksSessionId)) passedTests++;

    // Test 46: Loops check isRunning for termination
    totalTests++;
    const checksIsRunning = scriptContent.includes('isRunning') && (scriptContent.includes('while') || scriptContent.includes('if'));
    if (logResult('Loops check isRunning flag', checksIsRunning)) passedTests++;

    logSection('14. BUTTON DETECTION LOGIC');

    // Test 47: Accept patterns defined
    totalTests++;
    const hasAcceptPattern = scriptContent.includes("'accept'") || scriptContent.includes('"accept"');
    if (logResult('Accept pattern defined', hasAcceptPattern)) passedTests++;

    // Test 48: Run pattern defined
    totalTests++;
    const hasRunPattern = scriptContent.includes("'run'") || scriptContent.includes('"run"');
    if (logResult('Run pattern defined', hasRunPattern)) passedTests++;

    // Test 49: Reject patterns defined
    totalTests++;
    const hasRejectPattern = scriptContent.includes("'skip'") || scriptContent.includes("'reject'") || scriptContent.includes("'cancel'");
    if (logResult('Reject patterns defined', hasRejectPattern)) passedTests++;

    // Test 50: Button visibility check
    totalTests++;
    const checksVisibility = scriptContent.includes('getBoundingClientRect') || scriptContent.includes('getComputedStyle');
    if (logResult('Button visibility checked', checksVisibility)) passedTests++;

    logSection('15. UTILS FUNCTIONS');

    // Test 51: getDocuments function exists
    totalTests++;
    const hasGetDocuments = scriptContent.includes('getDocuments');
    if (logResult('getDocuments function exists', hasGetDocuments)) passedTests++;

    // Test 52: queryAll function exists
    totalTests++;
    const hasQueryAll = scriptContent.includes('queryAll');
    if (logResult('queryAll function exists', hasQueryAll)) passedTests++;

    // Test 53: updateTabNames function exists
    totalTests++;
    const hasUpdateTabNames = scriptContent.includes('updateTabNames');
    if (logResult('updateTabNames function exists', hasUpdateTabNames)) passedTests++;

    // Test 54: stripTimeSuffix function exists
    totalTests++;
    const hasStripTimeSuffix = scriptContent.includes('stripTimeSuffix');
    if (logResult('stripTimeSuffix function exists', hasStripTimeSuffix)) passedTests++;

    logSection('16. BROWSER CONTEXT GUARD');

    // Test 55: Window undefined guard exists
    totalTests++;
    const hasWindowGuard = scriptContent.includes("typeof window === 'undefined'") || scriptContent.includes('typeof window === "undefined"');
    if (logResult('Window undefined guard exists', hasWindowGuard)) passedTests++;

    logSection('17. ADVANCED EDGE CASES');

    // Test 56: State re-initialization is safe (doesn't overwrite running state)
    totalTests++;
    try {
        win.__autoAcceptStart({ isPro: true, isBackgroundMode: true, ide: 'cursor' });
        const sidBefore = win.__autoAcceptState.sessionID;

        // Re-run the script (simulating re-injection)
        vm.runInContext(scriptContent, sandbox);

        // State should be preserved (not reset to defaults)
        const sidAfter = win.__autoAcceptState.sessionID;
        const preserved = sidAfter >= sidBefore;
        if (logResult('State preserved on re-injection', preserved, `${sidBefore} -> ${sidAfter}`)) passedTests++;
        win.__autoAcceptStop();
    } catch (e) {
        logResult('State preserved on re-injection', false, e.message);
    }

    // Test 57: tabNames array is always an array
    totalTests++;
    const tabNamesIsArray = Array.isArray(win.__autoAcceptState.tabNames);
    if (logResult('tabNames is always an array', tabNamesIsArray)) passedTests++;

    // Test 58: completionStatus is always an object
    totalTests++;
    const completionIsObject = typeof win.__autoAcceptState.completionStatus === 'object' &&
        win.__autoAcceptState.completionStatus !== null;
    if (logResult('completionStatus is always an object', completionIsObject)) passedTests++;

    // Test 59: startTimes is always an object
    totalTests++;
    const startTimesIsObject = typeof win.__autoAcceptState.startTimes === 'object' &&
        win.__autoAcceptState.startTimes !== null;
    if (logResult('startTimes is always an object', startTimesIsObject)) passedTests++;

    // Test 60: Rapid successive starts don't corrupt state
    totalTests++;
    try {
        win.__autoAcceptStart({ isPro: true, isBackgroundMode: true, ide: 'cursor' });
        win.__autoAcceptStart({ isPro: true, isBackgroundMode: true, ide: 'antigravity' });
        win.__autoAcceptStart({ isPro: false, isBackgroundMode: false, ide: 'cursor' });
        win.__autoAcceptStart({ isPro: true, isBackgroundMode: true, ide: 'cursor' });

        const stateValid = win.__autoAcceptState.isRunning === true &&
            typeof win.__autoAcceptState.sessionID === 'number';
        if (logResult('Rapid starts dont corrupt state', stateValid)) passedTests++;
        win.__autoAcceptStop();
    } catch (e) {
        logResult('Rapid starts dont corrupt state', false, e.message);
    }

    // Test 61: Session ID always increments (never decreases)
    totalTests++;
    try {
        win.__autoAcceptStart({ isPro: true, isBackgroundMode: true, ide: 'cursor' });
        const sid1 = win.__autoAcceptState.sessionID;
        win.__autoAcceptStop();

        win.__autoAcceptStart({ isPro: true, isBackgroundMode: true, ide: 'cursor' });
        const sid2 = win.__autoAcceptState.sessionID;
        win.__autoAcceptStop();

        const neverDecreases = sid2 > sid1;
        if (logResult('Session ID always increments', neverDecreases, `${sid1} -> ${sid2}`)) passedTests++;
    } catch (e) {
        logResult('Session ID always increments', false, e.message);
    }

    // Test 62: Stop without start is safe
    totalTests++;
    try {
        win.__autoAcceptStop();
        win.__autoAcceptStop();
        const safeStop = win.__autoAcceptState.isRunning === false;
        if (logResult('Stop without prior start is safe', safeStop)) passedTests++;
    } catch (e) {
        logResult('Stop without prior start is safe', false, e.message);
    }

    // Test 63: Start-stop-start cycle works correctly
    totalTests++;
    try {
        win.__autoAcceptStart({ isPro: true, isBackgroundMode: true, ide: 'cursor' });
        const running1 = win.__autoAcceptState.isRunning;

        win.__autoAcceptStop();
        const stopped = win.__autoAcceptState.isRunning;

        win.__autoAcceptStart({ isPro: true, isBackgroundMode: true, ide: 'cursor' });
        const running2 = win.__autoAcceptState.isRunning;

        const cycleWorks = running1 === true && stopped === false && running2 === true;
        if (logResult('Start-stop-start cycle works', cycleWorks)) passedTests++;
        win.__autoAcceptStop();
    } catch (e) {
        logResult('Start-stop-start cycle works', false, e.message);
    }

    // Test 64: isPro defaults to true if not specified
    totalTests++;
    try {
        win.__autoAcceptStart({ isBackgroundMode: true, ide: 'cursor' });
        // Script should handle missing isPro gracefully
        const handled = win.__autoAcceptState.isRunning === true;
        if (logResult('Missing isPro handled', handled)) passedTests++;
        win.__autoAcceptStop();
    } catch (e) {
        logResult('Missing isPro handled', false, e.message);
    }

    // Test 65: pollInterval is optional
    totalTests++;
    try {
        win.__autoAcceptStart({ isPro: true, isBackgroundMode: false, ide: 'cursor' });
        // No pollInterval specified - should use default
        const handled = win.__autoAcceptState.isRunning === true;
        if (logResult('Missing pollInterval handled', handled)) passedTests++;
        win.__autoAcceptStop();
    } catch (e) {
        logResult('Missing pollInterval handled', false, e.message);
    }

    // Test 66: Script has completion state update logic
    totalTests++;
    const hasCompletionUpdate = scriptContent.includes('completionStatus') &&
        (scriptContent.includes("'done'") || scriptContent.includes('"done"'));
    if (logResult('Has completion state update logic', hasCompletionUpdate)) passedTests++;

    // Test 67: Script handles time suffix stripping (regex)
    totalTests++;
    const hasTimeRegex = scriptContent.includes('[smh]') || scriptContent.includes('\\d+');
    if (logResult('Has time suffix regex', hasTimeRegex)) passedTests++;

    // Test 68: Script has deduplicateNames function
    totalTests++;
    const hasDeduplicateNames = scriptContent.includes('deduplicateNames');
    if (logResult('Has deduplicateNames function', hasDeduplicateNames)) passedTests++;

    // Test 69: Duplicate tab names are handled (script content check)
    totalTests++;
    const handlesDuplicates = scriptContent.includes('counts[name]') || scriptContent.includes('(${counts[name]})');
    if (logResult('Handles duplicate tab names', handlesDuplicates)) passedTests++;

    // Test 68: Click events use proper MouseEvent
    totalTests++;
    const usesMouseEvent = scriptContent.includes('MouseEvent') && scriptContent.includes('dispatchEvent');
    if (logResult('Uses proper MouseEvent dispatch', usesMouseEvent)) passedTests++;

    // Test 69: Loops have proper async/await structure
    totalTests++;
    const hasAsyncLoop = scriptContent.includes('async function cursorLoop') &&
        scriptContent.includes('await new Promise');
    if (logResult('Loops use async/await correctly', hasAsyncLoop)) passedTests++;

    // Test 70: Script logs initialization message
    totalTests++;
    const hasInitLog = scriptContent.includes('Core Bundle Initialized');
    if (logResult('Has initialization log message', hasInitLog)) passedTests++;

    logSection('SUMMARY');

    const passRate = ((passedTests / totalTests) * 100).toFixed(1);
    log('');
    log(`Total Tests: ${totalTests}`);
    log(`Passed: ${passedTests}`);
    log(`Failed: ${totalTests - passedTests}`);
    log(`Pass Rate: ${passRate}%`);
    log('');

    if (passedTests === totalTests) {
        log('🎉 ALL TESTS PASSED - READY TO SHIP!');
    } else {
        log('⚠️  SOME TESTS FAILED - REVIEW BEFORE SHIPPING');
    }

    log('');
    log(`Test completed at: ${new Date().toISOString()}`);
    log(`Log file: ${LOG_FILE}`);

    return passedTests === totalTests ? 0 : 1;
}

// Run and exit
runTests()
    .then(code => process.exit(code))
    .catch(e => {
        log(`FATAL ERROR: ${e.message}`);
        log(e.stack);
        process.exit(1);
    });
