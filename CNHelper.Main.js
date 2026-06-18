if (!window.mainLoaded) { (function() {
// initialization
window.mainLoaded = true;
// Constants
const UPPER_LEFT = 0; const UPPER_RIGHT = 1; const LOWER_RIGHT = 2; const LOWER_LEFT = 3;

// prevent sentry (if any)
println = console.log;
errPrintln = console.error;
warnPrintln = console.warn;
browserPrompt = window.prompt;

// Known hosts
const CEB_SERVER_HOSTS = ["scopenoracle.mooo.com", "27.72.234.229", "127.0.0.1"];

// CEBServer related configurations
const HOST = "localhost"; const PORT = 8086; 
const CLIENT_IDENTIFIER = "SEBClientBrowser";
const PREFERRED_MODEL = "openai:gpt-5.5";

// other classes
(function AssistantOnPageSystem() {
const AOP_STORAGE = "_jawbreaker"; // localstorage cache key
let answerCache = {};
try {
    answerCache = JSON.parse(localStorage.getItem(AOP_STORAGE) || "{}");
} catch { answerCache = {}; }

function saveAnswerCache() { try { localStorage.setItem(AOP_STORAGE, JSON.stringify(answerCache)); } catch {} }

function injectSolveButtons() {
    window.aopApi.enabled = true;
    document.querySelectorAll(".i-q-index").forEach(node => {
        const questionIndex = node.innerText >>> 0;
        const questionLink = document.getElementById('qlink' + questionIndex);
        if (!questionLink) {
            return;
        }
        questionLink.style.cursor = "pointer";
        if (answerCache[questionIndex]) {
            questionLink.title = answerCache[questionIndex];
        } else {
            questionLink.title = "Click to solve"
        }
        questionLink.onclick = (e) => { 
            e.preventDefault();
            const reasoningEffort = e.shiftKey ? "high" : "medium";
            const extracted = extractQuestionJson(questionIndex);
            if (extracted === null) {
                questionLink.title = "ERROR";
                return;
            }
            const toSend = JSON.stringify(extracted); // this should not fail, i hope
            println(`[Assistant-From-Page-Click Module] Sending to ASSISTANT: ${toSend} (effort: ${reasoningEffort})`);
            questionLink.title = `Thinking... (${reasoningEffort})`;
            // send to the assistant with promise on
            assistantAPI.submitNormalTextToAssistant(`This is the question in JSON format: ${toSend}`, reasoningEffort, true)
            .then(text => {
                questionLink.title = text;
                answerCache[questionIndex] = questionLink.title;
                saveAnswerCache();
            }).catch(err => {
                questionLink.title = "ERROR: " + err;
                answerCache[questionIndex] = null; // invalidate cache
                saveAnswerCache();
            });
        };
    })
}

function clearSolveButtons() {
    window.aopApi.enabled = false;
    document.querySelectorAll(".i-q-index").forEach(node => {
        const questionIndex = node.innerText >>> 0;
        const questionLink = document.getElementById('qlink' + questionIndex);
        if (!questionLink) {
            return null;
        }
        // clears everything, including the cache
        questionLink.title = "";
        questionLink.onclick = null;
        questionLink.style.cursor = "default";
    });
    answerCache = {};
    saveAnswerCache();
}

// expose them to the main class
window.aopApi = {
    injectSolveButtons,
    clearSolveButtons,
    enabled: false
};

function cleanupTextContent(input) {
    // collapses multiple spaces into one
    return input.trim().replace(/[ \t]+/g, ' ');
}

function getCleanQuestionText(tdElement) {
    if (!tdElement) return '';
    const textParts = [];
    tdElement.childNodes.forEach(child => { // child of td
        if (child.nodeType === Node.ELEMENT_NODE) {
            if (
                child.classList.contains('q-flag-a') || child.classList.contains('q-flag-b') || // flags
                child.classList.contains('tex2jax_ignore') || // summernote wrapper
                child.classList.contains('note-editor') || // same bs
                child.tagName === 'BUTTON' ||
                child.tagName === 'IFRAME' ||
                // TODO: more could be added
                child.style.display === 'none' ||
                (child.querySelector && child.querySelector('.tawclabel')) // the word counter
            ) {
                return; 
            }
            // if its a valid element (<p> or <div>), grab it
            textParts.push(child.innerText);
        } else if (child.nodeType === Node.TEXT_NODE) {
            textParts.push(child.textContent); // grab it (if its just text)
        }
    });
    return cleanupTextContent(textParts.join('\n'));
}

function extractQuestionJson(questionNumber) {
    // summon the "Cau <n>" element, this is our only way to find it
    // this website is retarded
    const questionLink = document.getElementById('qlink' + questionNumber);
    if (!questionLink) {
        return null;
    }
    
    try {
        // extract the raw question text
        const questionTextTd = questionLink.parentElement.nextElementSibling;
        let questionText = questionTextTd ? getCleanQuestionText(questionTextTd) : ''; // fuck me

        const result = {
            question_text: questionText,
            type: "unknown"
        };

        // extract the stimulus (if any)
        const innerTable = questionLink.closest('table'); // the table that contains this question link
        if (innerTable && innerTable.parentElement && 
            innerTable.parentElement.previousElementSibling
        ) { // table -> root -> left
            const candStimulusTd = innerTable.parentElement.previousElementSibling; // candidate of being a stimulus
            if (candStimulusTd.className && 
                candStimulusTd.className.includes('qgroup-text-container')
            ) { // definitely one
                result.stimulus = cleanupTextContent(candStimulusTd.innerText);
            }
        }

        // multiple choices (MCQ single answer)
        const radios = document.querySelectorAll(`input[name="radio${questionNumber}"]`);
        if (radios.length > 0) {
            result.type = "multiple_choices";
            result.options = [];
            radios.forEach((radio, idx) => {
                const parentRow = radio.closest('tr');
                if (parentRow && parentRow.style.display === 'none') {
                    return; // row hidden -> skip
                }
                const letter = "abcdefghijklmnopqrstuvwxyz"[idx];
                const span = document.getElementById(`span${questionNumber}${letter}`);
                if (span) {
                    result.options.push({
                        key: letter.toUpperCase(),
                        text: cleanupTextContent(span.innerText)
                    });
                }
            });
            return result;
        }
        // multi select (mcq multi answers)
        const checkboxes = document.querySelectorAll(`input[name="boxtype${questionNumber}"]`);
        if (checkboxes.length > 0) {
            result.type = "multiple_select";
            result.options = [];
            checkboxes.forEach((cb, idx) => {
                const span = document.getElementById(`span${questionNumber}_${idx}`);
                const letter = "abcdefghijklmnopqrstuvwxyz"[idx];
                if (span) {
                    result.options.push({
                        key: letter.toLowerCase(),
                        text: cleanupTextContent(span.innerText)
                    });
                }
            });
            return result;
        }
        // true-false per item
        const catqTable = document.getElementById(`catq${questionNumber}`);
        if (catqTable && checkboxes.length === 0) {
            const headers = catqTable.querySelectorAll('tr:first-child td');
            const headerRow = catqTable.rows[0];

            // check if its a grid question (2+ columns)
            if (headerRow && headerRow.cells.length > 2) {
                result.type = "matrix";

                result.choices = []; // this could be TRUE/FALSE/NOT GIVEN, ...
                for (let j = 2; j < headerRow.cells.length; j++) {
                    let headerText = cleanupTextContent(headerRow.cells[j].innerText);
                    if (headerText) {
                        result.choices.push(headerText);
                    }
                }

                result.items = [];
                for (let i = 1; i < catqTable.rows.length; i++) {
                    // the 1st one is the a, b, c, d, the 2nd is the content
                    const itemTextTd = catqTable.rows[i].cells[1]; // who tf designed this
                    if (itemTextTd) {
                        result.items.push(cleanupTextContent(itemTextTd.innerText));
                    }
                }
                return result;
            }
        }
        // short answer (blank filling)
        const shortAnswerInput = document.getElementById(`shortAnswer${questionNumber}`);
        if (shortAnswerInput) {
            result.type = "short_answer";
            return result;
        }
        // essay
        const essayTextarea = document.getElementById(`textanswer${questionNumber}`);
        if (essayTextarea) {
            result.type = "long_answer";
            return result;
        }
        return result; // this platform is retarded 2
    } catch {
        return null; // 
    }
}
})();

(function () {
    function load(key) { try { return Number(localStorage.getItem(key)) || 0; } catch { return 0; } }
    function save(key, v) { try { localStorage.setItem(key, String(v >>> 0)); } catch {} }

    const UI_KEY = "_barley";
    window.uiDataSystem = {
        // position: 0–255 (8-bit)
        setPosition(pos) {
            pos = pos & 0xFF;
            let state = load(UI_KEY);
            state = (state & ~0xFF) | pos;
            save(UI_KEY, state);
        },
        // hidden stored in bit 8
        setHidden(hidden) {
            let state = load(UI_KEY);
            if (hidden) {
                state |= (1 << 8);
            } else {
                state &= ~(1 << 8);
            }
            save(UI_KEY, state);
        },
        // show in title stored in bit 9
        setShowInTitle(show) {
            let state = load(UI_KEY);
            if (show) {
                state |= (1 << 9);
            } else {
                state &= ~(1 << 9);
            }
            save(UI_KEY, state);
        },
        getPosition() { return load(UI_KEY) & 0xFF; },
        isHidden() { return (load(UI_KEY) & (1 << 8)) !== 0; },
        isShowInTitle() { return (load(UI_KEY) & (1 << 9)) !== 0; }
    };

    const PSCEB_KEY = "_hardtack";
    const PSCEB_OVERRIDE_KEY = "_shipbiscuit";
    window.psCeb = {
        // last known good host inside a list of available hosts
        setLKGCebServerIdx(domainIdx) { save(PSCEB_KEY, domainIdx); },
        getLKGCebServerIdx(domain) { return load(PSCEB_KEY); },
        // override
        setCebServerOverride(domain) { try { localStorage.setItem(PSCEB_OVERRIDE_KEY, domain); } catch {} },
        getCebServerOverride() { try { return localStorage.getItem(PSCEB_OVERRIDE_KEY) || "-1"; } catch { return "-1" } }
    };
})();

// boilerplate to setup the output system
function setOutputResult(text) {
    resultBox.textContent = text;
    resultBox.title = text;
    if (_writeOutputToTitle) {
        document.title = text;
    }
};
let _writeOutputToTitle = false;
let _previousTitle = document.title;
function setWriteOutputToTitle(enable) {
    if (_writeOutputToTitle === enable) return;
    if (enable) {
        _previousTitle = document.title; // always backup the most current title
        document.title = resultBox.textContent || "Ready!";
    } else {
        document.title = _previousTitle; // restore safely
    }
    _writeOutputToTitle = enable;
    window.uiDataSystem.setShowInTitle(enable);
}
window.setOutputResult = setOutputResult; // expose to the assistant system

let currentHost = null;
// HANDLED by CEB SERVER
function connectWithFailover(onSuccess, onError, attempts = 0) {
    let override = window.psCeb.getCebServerOverride();
    let targetHost = HOST;

    if (override && override !== "-1") {
        targetHost = override === "0" ? "127.0.0.1" : override;
    } else {
        let idx = window.psCeb.getLKGCebServerIdx();
        targetHost = CEB_SERVER_HOSTS[idx % CEB_SERVER_HOSTS.length];
    }

    native.cebServer.tryConnect(targetHost, PORT, CLIENT_IDENTIFIER, 
        (/* on success */) => {
            currentHost = targetHost;
            onSuccess();
        }, 
        (error) => {
            // if we are using automatic routing, try to auto-recover
            if (!override || override === "-1") {
                let nextIdx = (window.psCeb.getLKGCebServerIdx() + 1) % CEB_SERVER_HOSTS.length;
                window.psCeb.setLKGCebServerIdx(nextIdx);
                warnPrintln(`[CEB SERVER] ${targetHost} failed. Shifted LKG index to ${nextIdx}.`);
                // if we havent tried every host in the array yet, try the next one asap
                if (attempts < CEB_SERVER_HOSTS.length - 1) {
                    warnPrintln(`[CEB SERVER] Transparently auto-retrying next host...`);
                    native.cebServer.disconnect(); // scrub the dead socket state
                    return connectWithFailover(onSuccess, onError, attempts + 1); // recursive retry
                }
            }
            // if it was an override OR we exhausted all hosts, bubble the error to the UI
            if (onError) onError(error, targetHost);
        }
    );
}

// HANDLED by CEB SERVER
window.assistantAPI = {
    _submitToAICebServer: (queryType, payloadData, reasoningEffort, onAckCallback = null) => {
        return new Promise((resolve, reject) => {
            // connect if not already (this will NOT reconnect if alr connected)
            connectWithFailover((/* on success */) => {
                // then dispatch request
                native.cebServer.sendRequest("ai", 
                    {
                        preferred_model: PREFERRED_MODEL,
                        query_type: queryType,
                        payload: payloadData,
                        reasoning_effort: reasoningEffort
                    },
                    (cid) => {
                        if (onAckCallback) onAckCallback(cid);
                    },
                    (success) => {
                        let responseText = success.payload;
                        if (success.fallback_model) { // notice the user if it fell back
                            warnPrintln(`[CEB: AI] [${PREFERRED_MODEL}] Using fallback model: ${success.fallback_model}`);
                            responseText = `[FB] ${responseText}`;
                        }
                        println(`[CEB: AI] [${PREFERRED_MODEL}] Success! Model Response:`, success);
                        resolve(responseText);
                    },
                    (error) => {
                        errPrintln(`[CEB: AI] [${PREFERRED_MODEL}] Failed to query LLM model(s):`, error);
                        reject(`Error: ${error.error || error}`);
                    }
                );
            }, (/* on error */ error, failedHost) => {
                errPrintln(`[CEB SERVER] Cannot connect to CEB Server at ${failedHost}! Error:`, error);
                reject(`CSError (${failedHost}): ${String(error)}`);
            });
        });
    },

    submitNormalTextToAssistant(text, reasoningEffort = "low", usePromise = false) {
        if (!usePromise) window.setOutputResult("Preparing...");
        const onAck = usePromise ? null : () => window.setOutputResult("Thinking...");
        const reqPromise = this._submitToAICebServer("TEXT", text, reasoningEffort, onAck);
        if (usePromise) {
            return reqPromise;
        } else {
            reqPromise.then((result) => {
                window.setOutputResult(result);
            }).catch((err) => {
                window.setOutputResult(err);
            });
        }
    },
    
    submitImageToAssistant(base64Image, reasoningEffort = "medium", usePromise = false) {
        if (!usePromise) window.setOutputResult("Preparing...");
        const onAck = usePromise ? null : () => window.setOutputResult(`Thinking... (${reasoningEffort})`);
        const reqPromise = this._submitToAICebServer("IMAGE", base64Image, reasoningEffort, onAck);
        if (usePromise) {
            return reqPromise;
        } else {
            reqPromise.then((result) => {
                window.setOutputResult(result);
            }).catch((err) => {
                window.setOutputResult(err);
            });
        }
    },

    getAssistantProvider: () => { return "CEBServer LLMs Router"; },
    getAssistantAIModel:  () => { return PREFERRED_MODEL; }
};

// bookkeeping for global values
let capsLockOn = false;
let pos1 = null, pos2 = null;
let ctrlPressed = false;
let shiftPressed = false;

// create the overlay to visualize the selection
const overlay = document.createElement('div');
Object.assign(overlay.style, {
    position: 'absolute',
    background: 'rgba(0, 153, 255, 0)',
    border: "1px dashed rgba(127, 127, 127, 0.12)",
    mixBlendMode: "difference",
    pointerEvents: 'none',
    zIndex: 9999999,
    display: 'none'
});

// create the secret div to put the assistant/js result in
const resultBox = document.createElement("div");
Object.assign(resultBox.style, {
    fontSize: "initial",
    fontFamily: "system-ui",
    position: "fixed",
    top: "0",
    right: "0",
    width: "50%",
    padding: "6px",
    background: "transparent",
    color: "transparent",
    textAlign: "right",
    zIndex: 999999
});

// create the secret input box to use Assistant Text or JS commands
const inputBox = document.createElement("input");
Object.assign(inputBox.style, {
    fontSize: "initial",
    fontFamily: "system-ui",
    position: "fixed",
    bottom: "8px",
    left: "0",
    width: "25%",
    padding: "8px",
    background: "transparent",
    color: "black",
    border: "none",
    outline: "none",
    zIndex: 999999,
});
inputBox.spellcheck = false;

// pinging utils
function pingServer() {
    window.setOutputResult("Pinging...");
    connectWithFailover(() => {
        const startTime = performance.now();
        native.cebServer.sendRequest("ping", {}, 
        (cid) => {
            // ACK received
            const latency = Math.round(performance.now() - startTime);
            window.setOutputResult(`Pong! Latency: ${latency}ms <-> ${currentHost}`);
        },
        null, // ping doesn't use the Success block
        (error) => {
            window.setOutputResult(`Ping Error: ${error.error || error}`);
        });
    }, (error, failedHost) => {
        window.setOutputResult(`CSError (${failedHost}): Cannot ping`);
    });
}

// helper func
function onWebLoad() {
    document.documentElement.appendChild(overlay);
    document.documentElement.appendChild(resultBox);
    document.documentElement.appendChild(inputBox);
    applyResultBoxUI();
    setWriteOutputToTitle(window.uiDataSystem.isShowInTitle());
    aopApi.injectSolveButtons();
    pingServer();
    setOutputResult("Ready!");
}

// sync to localstorage
function applyResultBoxUI() {
    const isHidden = window.uiDataSystem.isHidden();
    resultBox.style.display = isHidden ? "none" : "block";

    const pos = window.uiDataSystem.getPosition();
    switch (pos) {
        case UPPER_LEFT:
            resultBox.style.top = "0px";
            resultBox.style.left = "0px";
            resultBox.style.right = "auto";
            resultBox.style.bottom = "auto";
            resultBox.style.textAlign = "left";
            break;
        case UPPER_RIGHT:
            resultBox.style.top = "0px";
            resultBox.style.left = "auto";
            resultBox.style.right = "0px";
            resultBox.style.bottom = "auto";
            resultBox.style.textAlign = "right";
            break;
        case LOWER_RIGHT:
            resultBox.style.top = "auto";
            resultBox.style.left = "auto";
            resultBox.style.right = "0px";
            resultBox.style.bottom = "8px";
            resultBox.style.textAlign = "right";
            break;
        case LOWER_LEFT:
            resultBox.style.top = "auto";
            resultBox.style.left = "0px";
            resultBox.style.right = "auto";
            resultBox.style.bottom = "40px"; // make room for the textinput
            resultBox.style.textAlign = "left";
            break;
    }
}

// insert on ready
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", onWebLoad);
} else {
    onWebLoad();
}

// listen for CTRL + SHIFT hold to change the pigment
window.addEventListener("keydown", (e) => {
    if (e.key === "Control") ctrlPressed = true;
    if (e.key === "Shift") shiftPressed = true;
    if (ctrlPressed && shiftPressed) {
        resultBox.style.color = "white";
    }
});

window.addEventListener("keyup", (e) => {
    if (e.key === "Control") ctrlPressed = false;
    if (e.key === "Shift") shiftPressed = false;
    // when either released, reset to white
    if (!ctrlPressed || !shiftPressed) {
        resultBox.style.color = "transparent";
    }
});

// command history support
const commandHistory = [];
let historyIndex = -1;

function addToHistory(cmd) {
    if (cmd.trim() === "") return;
    if (commandHistory[commandHistory.length - 1] !== cmd) {
        commandHistory.push(cmd);
    }
    historyIndex = commandHistory.length;
}

const jsTriggers = ["js:", "javascript:", "j:"];
// listen for when the user enter something
inputBox.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        let command = inputBox.value;
        inputBox.value = ""; // clear the box

        if (!command) return;
        addToHistory(command);

        if (command === "!c") { // clear the output box immediately
            setOutputResult("");
            return;
        }

        let isJS = false;
        for (const prefix of jsTriggers) {
            if (command.toLowerCase().startsWith(prefix)) {
                command = command.slice(prefix.length); // remove the prefix
                isJS = true; // this is a js command
                break;
            }
        }

        // execute as javascript
        if (isJS) {
            let output = "";
            try {
                output = eval(command);
            } catch (err) {
                output = err.toString(); // handle errors so it wont die
            } finally {
                setOutputResult(output); // print out
            }
            return;
        }
        // send to assistant
        const reasoningEffort = e.shiftKey ? "high" : "medium";
        println(`[Assistant-From-Console Module] Sending to ASSISTANT: ${command} (effort: ${reasoningEffort})`);
        assistantAPI.submitNormalTextToAssistant(command, reasoningEffort);
    }
    // history system
    if (e.key === "ArrowUp") {
        e.preventDefault();
        if (historyIndex > 0) {
            historyIndex--; // move up
            inputBox.value = commandHistory[historyIndex] ?? "";
        }
    } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (historyIndex < commandHistory.length - 1) {
            historyIndex++; // move down
            inputBox.value = commandHistory[historyIndex] ?? "";
        } else {
            historyIndex = commandHistory.length;
            inputBox.value = ""; // at the end
        }
    }
});

document.addEventListener("keydown", (e) => {
    // CHANGE OUTPUT MODE
    if (e.altKey && e.shiftKey) {
        // allow it to write to the browser's title too
        if (e.key === "q" || e.key === "Q") {
            e.preventDefault();
            setWriteOutputToTitle(!_writeOutputToTitle);
            return;
        }
        // ping the server
        if (e.key === "p" || e.key === "P") {
            e.preventDefault();
            pingServer();
            return;
        }
        // custom server
        if (e.key === "l" || e.key === "L") {
            e.preventDefault();
            let current = window.psCeb.getCebServerOverride();
            let promptVal = browserPrompt("-1 = Auto (Default)\n0 = localhost\nOr enter a custom domain/IP:", current);
            if (promptVal !== null && promptVal.trim() !== "") {
                window.psCeb.setCebServerOverride(promptVal.trim());
                native.cebServer.disconnect(); // force disconnect so next request uses new host
                window.setOutputResult(`Host override set: '${promptVal}'`);
            }
            return;
        }
    }
    
    // CLEAR OUTPUT BOX, EMERGENCY!
    if (e.altKey && (e.key === "c" || e.key === "C")) {
        e.preventDefault();
        inputBox.value = ""; // empty the window
        inputBox.blur(); // stop the blinking cursor
        setOutputResult(""); // just empty it out
        setWriteOutputToTitle(false); // reset output, if any
        aopApi.clearSolveButtons(); // clear assistant-on-page
        return;
    }

    // TOGGLE OUTPUT BOX VISIBILITY
    if (e.altKey && (e.key === "x" || e.key === "X")) {
        e.preventDefault();
        const currentlyHidden = window.uiDataSystem.isHidden();
        window.uiDataSystem.setHidden(!currentlyHidden);
        applyResultBoxUI();
        return;
    }

    // TOGGLE ASSISTANTS ON PAGE
    if (e.altKey && (e.key === "v" || e.key === "V")) {
        e.preventDefault();
        if (aopApi.enabled) {
            aopApi.clearSolveButtons();
        } else {
            aopApi.injectSolveButtons();
        }
        return;
    }

    // MOVE OUTPUT BOX AROUND
    if (e.ctrlKey && e.altKey) {
        let pos = window.uiDataSystem.getPosition();
        let changed = false;
        if (e.key === "ArrowUp") {
            if (pos === LOWER_LEFT) { pos = UPPER_LEFT; changed = true; }
            if (pos === LOWER_RIGHT) { pos = UPPER_RIGHT; changed = true; }
        } else if (e.key === "ArrowDown") {
            if (pos === UPPER_LEFT) { pos = LOWER_LEFT; changed = true; }
            if (pos === UPPER_RIGHT) { pos = LOWER_RIGHT; changed = true; }
        } else if (e.key === "ArrowLeft") {
            if (pos === UPPER_RIGHT) { pos = UPPER_LEFT; changed = true; }
            if (pos === LOWER_RIGHT) { pos = LOWER_LEFT; changed = true; }
        } else if (e.key === "ArrowRight") {
            if (pos === UPPER_LEFT) { pos = UPPER_RIGHT; changed = true; }
            if (pos === LOWER_LEFT) { pos = LOWER_RIGHT; changed = true; }
        }
        if (changed) {
            // update the gui 
            e.preventDefault();
            window.uiDataSystem.setPosition(pos);
            applyResultBoxUI();
            return;
        }
    }
});

// ====== BEGIN SCREENSHOT => ANSWER PIPELINE ======
let _dragging = false;

document.addEventListener("mousedown", (e) => {
    if (!capsLockOn) return;
    if (!e.shiftKey || e.button !== 0) return;
    e.preventDefault(); // do not interact w/ the page
    _dragging = true; // we're in dragging mode
    pos1 = {
        x: e.clientX,
        y: e.clientY
    };
    pos2 = { ...pos1 }; // copy of pos1
    highlightRegion(pos1.x, pos1.y, pos2.x, pos2.y);
});

document.addEventListener("mousemove", (e) => {
    if (!_dragging) return;
    if (!capsLockOn || !e.shiftKey) return;
    // update pos2 according to the current mouse position
    pos2 = {
        x: e.clientX,
        y: e.clientY
    };
    highlightRegion(pos1.x, pos1.y, pos2.x, pos2.y);
});

document.addEventListener("mouseup", () => {
    _dragging = false; // no longer dragging
});

// user can scroll and it can mess shit up, so update accordingly
window.addEventListener("scroll", () => {
    highlightRegion(pos1?.x, pos1?.y, pos2?.x, pos2?.y);
});

document.addEventListener("contextmenu", (e) => {
    if (!capsLockOn) return;
    if (e.shiftKey) {
        e.preventDefault(); // prevent the rc menu from disturbing us
    }
});

document.addEventListener("keyup", (e) => {
    if (e.key === "Shift") {
        _dragging = false; // no longer dragging altogether
    }
});

// listen for the document for selection
document.addEventListener("keydown", (e) => {
    // update the global caps lock state
    if (e.getModifierState("CapsLock") !== capsLockOn) {
        capsLockOn = e.getModifierState("CapsLock");
        // if caps lock is off, hide the overlay
        if (!capsLockOn) {
            overlay.style.display = 'none';
        } else {
            highlightRegion(pos1?.x, pos1?.y, pos2?.x, pos2?.y);
        }
    }

    // ESC -> reset everything (when there's something)
    if (e.key === "`" && pos1 && pos2) {
        e.preventDefault();
        resetRegionSelected();
        return;
    }
    
    // enter => submit to ASSISTANT
    if (capsLockOn && e.key === "Enter") {
        if (!pos1 || !pos2) return; // incomplete
        const minX = Math.min(pos1.x, pos2.x);
        const minY = Math.min(pos1.y, pos2.y);
        const maxX = Math.max(pos1.x, pos2.x);
        const maxY = Math.max(pos1.y, pos2.y);
        if (maxX - minX < 5 || maxY - minY < 5) return;
        e.preventDefault();
        // submit and pray
        captureScreenshotAndUploadToAssistant(minX, minY, maxX, maxY, e.shiftKey);
    }
});
// ====== END SCREENSHOT => ANSWER PIPELINE ======

/**
 * Capture the screenshot of the given region and send it to
 * the implemented assistant provider's API for processing
 */
function captureScreenshotAndUploadToAssistant(minX, minY, maxX, maxY, shiftKey) {
    resetRegionSelected();
    if (typeof native === 'undefined') throw new Error("Unsupported!");
    native.captureScreenshotDpr(minX, minY, maxX, maxY)
    .then(imageURL => {
        const finalImageURL = imageURL.startsWith("data:image/png;base64,")
            ? imageURL : `data:image/png;base64,${imageURL}`
        ;
        const reasoningEffort = shiftKey ? "high" : "medium";
        println(`[Assistant-From-Image Module] Sending screenshot to ASSISTANT (effort: ${reasoningEffort})`);
        assistantAPI.submitImageToAssistant(finalImageURL, reasoningEffort);
    });
}

/**
 * Reset and hide the visualizer
 */
function resetRegionSelected() {
    pos1 = null;
    pos2 = null;
    overlay.style.display = "none";
}

/**
 * Hightlights the given region  
 */
function highlightRegion(x1, y1, x2, y2) {
    // do NOT display if the region has a null component OR
    // caps lock is OFF
    if (!capsLockOn || x1 == null || y1 == null || x2 == null || y2 == null) {
        overlay.style.display = 'none';
        return;
    }

    // compute the min/max of the bounding box
    const minX = Math.min(x1, x2);
    const minY = Math.min(y1, y2);
    const maxX = Math.max(x1, x2);
    const maxY = Math.max(y1, y2);

    // compute the width / height since CSS bruh
    const width = maxX - minX;
    const height = maxY - minY;

    if (width < 5 || height < 5) { // make sure the region is "reasonably" large
        overlay.style.display = 'none';
        return;
    }

    overlay.style.left = (minX + window.scrollX) + "px";
    overlay.style.top = (minY + window.scrollY) + "px";
    overlay.style.width = width + "px";
    overlay.style.height = height + "px";
    overlay.style.display = 'block';
}

println("[CN-HELPER] Script loaded successfully!");
})(); }
