import {
	tokenize,
	firstWordIndex,
	nextWordIndex,
	prevWordIndex,
	resetWordStatuses,
	computeSentences,
} from "./tokenize.js";
import {
	renderTokens,
	updateCurrentPointer,
	updateTokenStatus,
	bindTokenJump,
	setControlsEnabled,
	updateMetricsView,
	setTokenTitle,
	setASRStatus,
	setLastHeard,
	renderSentences,
	bindSentenceClicks,
	showDriftBanner,
} from "./ui.js";
import { computeMetrics } from "./metrics.js";
import { SpeechEngine } from "./speech.js";
import { Aligner } from "./aligner.js";
import { DecisionBuffer } from "./decisionBuffer.js"

const els = {
	fileInput: document.getElementById("fileInput"),
	demoBtn: document.getElementById("demoBtn"),
	inputText: document.getElementById("inputText"),
	loadBtn: document.getElementById("loadBtn"),
	charCount: document.getElementById("charCount"),
	tokensContainer: document.getElementById("tokensContainer"),
	startBtn: document.getElementById("startBtn"),
	resetBtn: document.getElementById("resetBtn"),
	backBtn: document.getElementById("backBtn"),
	skipBtn: document.getElementById("skipBtn"),
	incorrectBtn: document.getElementById("incorrectBtn"),
	correctBtn: document.getElementById("correctBtn"),
	micStartBtn: document.getElementById("micStartBtn"),
	micStopBtn: document.getElementById("micStopBtn"),
	langSelect: document.getElementById("langSelect"),
	lookahead: document.getElementById("lookahead"),
	lookaheadVal: document.getElementById("lookaheadVal"),
	threshold: document.getElementById("threshold"),
	thresholdVal: document.getElementById("thresholdVal"),
	realignNextSentenceBtn: document.getElementById("realignNextSentenceBtn"),
	realignDismissBtn: document.getElementById("realignDismissBtn"),
	backtrackThreshold: document.getElementById("backtrackThreshold"),
	backtrackWindow: document.getElementById("backtrackWindow"),
};

let state = {
	tokens: [],
	pointer: -1, // index in tokens array (word token)
	startedAt: null,
	sessionActive: false,
	aligner: null,
	speech: null,
	sentences: [],
	decisionBuffer: new DecisionBuffer(20), // Track last 20 decisions
	backtrackThreshold: 2.0, // Cost threshold for triggering backtrack
	backtrackWindow: 8, // Number of tokens to consider for backtrack
};

function setPointer(idx) {
	state.pointer = idx;
	updateCurrentPointer(state.tokens, els.tokensContainer, idx);
	if (state.aligner) state.aligner.pointer = idx;
	if (state.sentences) renderSentences(state.sentences, state.pointer);
}

function loadTokensFromText(text) {
	state.tokens = tokenize(text);
	state.pointer = -1;
	state.startedAt = null;
	state.sessionActive = false;
	state.decisionBuffer.clear(); // Clear decision history for new text
	renderTokens(state.tokens, els.tokensContainer);
	const firstIdx = firstWordIndex(state.tokens);
	setPointer(firstIdx);
	setControlsEnabled(state.tokens.length > 0 && firstIdx >= 0);
	refreshMetrics();
	// Prepare aligner with beam search configuration
	state.aligner = new Aligner(state.tokens, {
		updateStatus: (idx, status) => {
			updateTokenStatus(els.tokensContainer, idx, status);
			// Record automatic decisions from aligner
			if (state.sessionActive && state.tokens[idx] && state.tokens[idx].isWord) {
				state.decisionBuffer.push({
					index: idx,
					status: status,
					timestamp: Date.now(),
					expected: state.tokens[idx].norm,
					heard: status === "correct" ? state.tokens[idx].norm : "",
					automatic: true
				});
			}
		},
		setPointer: (idx) => setPointer(idx),
		setTitle: (idx, title) => setTokenTitle(els.tokensContainer, idx, title),
	});
	// Use beam search parameters instead of old lookahead
	const beamWidth = 4;
	const threshold = Number(els.threshold?.value || 0.8);
	const margin = 0.1;
	const windowSize = 10;
	state.aligner.setConfig({ beamWidth, threshold, margin, windowSize });
	
	// Load auto-backtrack configuration from UI if available
	if (els.backtrackThreshold?.value) {
		state.backtrackThreshold = Number(els.backtrackThreshold.value);
	}
	if (els.backtrackWindow?.value) {
		state.backtrackWindow = Number(els.backtrackWindow.value);
	}
	
	// Compute sentences and render list
	state.sentences = computeSentences(state.tokens);
	renderSentences(state.sentences, state.pointer);
	showDriftBanner(false);
}

function markAndAdvance(status) {
	if (state.pointer < 0) return;
	const idx = state.pointer;
	const t = state.tokens[idx];
	if (!t || !t.isWord) return;
	
	// Record decision in buffer
	state.decisionBuffer.push({
		index: idx,
		status: status,
		timestamp: Date.now(),
		expected: t.norm,
		heard: status === "correct" ? t.norm : ""
	});
	
	state.tokens[idx].status = status;
	updateTokenStatus(els.tokensContainer, idx, status);
	const next = nextWordIndex(state.tokens, idx);
	if (next >= 0) setPointer(next);
	else setPointer(-1);
	refreshMetrics();
	
	// Check if we need to auto-backtrack
	checkAutoBacktrack();
}

// Auto-backtrack functionality
function checkAutoBacktrack() {
	if (state.decisionBuffer.count < state.backtrackWindow) return;
	
	const recentDecisions = state.decisionBuffer.getRecent(state.backtrackWindow);
	const cost = calculateAlignmentCost(recentDecisions);
	
	if (cost > state.backtrackThreshold) {
		console.log(`Auto-backtrack triggered: cost ${cost.toFixed(2)} > threshold ${state.backtrackThreshold}`);
		performAutoBacktrack(recentDecisions);
	}
}

function calculateAlignmentCost(decisions) {
	let cost = 0;
	let consecutiveErrors = 0;
	
	for (const decision of decisions) {
		switch (decision.status) {
			case "correct":
				cost += 0.1; // Low cost for correct
				consecutiveErrors = 0;
				break;
			case "incorrect":
				cost += 1.0; // High cost for incorrect
				consecutiveErrors++;
				break;
			case "skipped":
				cost += 0.5; // Medium cost for skipped
				consecutiveErrors++;
				break;
		}
		
		// Penalty for consecutive errors
		if (consecutiveErrors >= 3) {
			cost += consecutiveErrors * 0.5;
		}
	}
	
	return cost;
}

function performAutoBacktrack(decisions) {
	// Find the best rollback point (look for a correct decision to roll back to)
	let rollbackIndex = -1;
	for (let i = decisions.length - 1; i >= 0; i--) {
		if (decisions[i].status === "correct") {
			rollbackIndex = decisions[i].index;
			break;
		}
	}
	
	// If no good rollback point, roll back to the beginning of the window
	if (rollbackIndex === -1) {
		rollbackIndex = decisions[0].index;
	}
	
	console.log(`Rolling back to token ${rollbackIndex}`);
	
	// Reset tokens in the backtrack window
	const startIdx = Math.max(0, rollbackIndex - 2);
	const endIdx = Math.min(state.tokens.length - 1, state.pointer);
	
	for (let i = startIdx; i <= endIdx; i++) {
		if (state.tokens[i].isWord) {
			state.tokens[i].status = "pending";
			updateTokenStatus(els.tokensContainer, i, "pending");
		}
	}
	
	// Set pointer to rollback position
	setPointer(rollbackIndex);
	
	// Clear decision buffer from rollback point
	state.decisionBuffer.clear();
	
	// Re-render tokens
	renderTokens(state.tokens, els.tokensContainer);
	refreshMetrics();
	
	// Show user feedback about auto-backtrack
	showAutoBacktrackFeedback(rollbackIndex, endIdx);
}

function showAutoBacktrackFeedback(rollbackIndex, endIdx) {
	// Highlight the rolled-back region briefly
	const tokens = els.tokensContainer.children;
	for (let i = rollbackIndex; i <= endIdx; i++) {
		if (tokens[i] && tokens[i].classList.contains('word')) {
			tokens[i].style.backgroundColor = '#fff3cd';
			setTimeout(() => {
				if (tokens[i]) tokens[i].style.backgroundColor = '';
			}, 2000);
		}
	}
}

// Manual backtrack trigger for testing
function triggerManualBacktrack() {
	if (state.decisionBuffer.count < 4) {
		console.log("Not enough decisions to backtrack");
		return;
	}
	
	const recentDecisions = state.decisionBuffer.getRecent(Math.min(state.backtrackWindow, state.decisionBuffer.count));
	console.log("Manual backtrack triggered");
	performAutoBacktrack(recentDecisions);
}

// Debug function to show current decision buffer state
function showDecisionBufferState() {
	console.log("Decision Buffer State:");
	console.log(`Count: ${state.decisionBuffer.count}`);
	console.log(`Threshold: ${state.backtrackThreshold}`);
	console.log(`Window: ${state.backtrackWindow}`);
	
	const recent = state.decisionBuffer.getRecent(Math.min(10, state.decisionBuffer.count));
	console.log("Recent decisions:", recent);
	
	const cost = calculateAlignmentCost(recent);
	console.log(`Current cost: ${cost.toFixed(2)}`);
}

function backOne() {
	if (state.pointer < 0) return;
	const prev = prevWordIndex(state.tokens, state.pointer);
	if (prev >= 0) {
		// reset previous word to pending and move pointer there
		state.tokens[prev].status = "pending";
		updateTokenStatus(els.tokensContainer, prev, "pending");
		setPointer(prev);
		refreshMetrics();
		
		// Remove the last decision from buffer
		if (state.decisionBuffer.count > 0) {
			state.decisionBuffer.count--;
			if (state.decisionBuffer.count === 0) {
				state.decisionBuffer.head = 0;
			} else {
				state.decisionBuffer.head = (state.decisionBuffer.head - 1 + state.decisionBuffer.size) % state.decisionBuffer.size;
			}
		}
	}
}

function startSession() {
	if (!state.tokens.length) return;
	resetWordStatuses(state.tokens);
	renderTokens(state.tokens, els.tokensContainer);
	const firstIdx = firstWordIndex(state.tokens);
	setPointer(firstIdx);
	state.startedAt = Date.now();
	state.sessionActive = true;
	state.decisionBuffer.clear(); // Clear decision history for new session
	refreshMetrics();
	
	// Automatically start microphone when session begins
	if (state.speech && state.speech.supported) {
		if (els.langSelect?.value) state.speech.setLanguage(els.langSelect.value);
		state.speech.start();
	}
}

function resetStatuses() {
	if (!state.tokens.length) return;
	resetWordStatuses(state.tokens);
	renderTokens(state.tokens, els.tokensContainer);
	const firstIdx = firstWordIndex(state.tokens);
	setPointer(firstIdx);
	state.startedAt = null;
	state.sessionActive = false;
	state.decisionBuffer.clear(); // Clear decision history
	refreshMetrics();
	
	// Automatically stop microphone when resetting
	if (state.speech && state.speech.running) {
		state.speech.stop();
	}
}

function refreshMetrics() {
	const m = computeMetrics(state.tokens, state.startedAt);
	updateMetricsView(m);
	checkDrift();
}

function checkDrift() {
	if (state.pointer < 0) {
		showDriftBanner(false);
		return;
	}
	let count = 0;
	let errors = 0;
	for (let i = state.pointer - 1; i >= 0 && count < 8; i--) {
		const t = state.tokens[i];
		if (!t.isWord) continue;
		if (t.status === "incorrect" || t.status === "skipped") errors++;
		if (t.status !== "pending") count++;
	}
	const show = count >= 4 && errors >= 3;
	showDriftBanner(show);
}

// Event bindings
els.fileInput.addEventListener("change", async (e) => {
	const file = e.target.files && e.target.files[0];
	if (!file) return;
	const text = await file.text();
	els.inputText.value = text;
	els.charCount.textContent = `${text.length} characters`;
});

els.inputText.addEventListener("input", () => {
	const len = els.inputText.value.length;
	els.charCount.textContent = `${len} character${len === 1 ? "" : "s"}`;
});

els.loadBtn.addEventListener("click", () => {
	const text = els.inputText.value.trim();
	if (!text) return;
	loadTokensFromText(text);
});

els.demoBtn.addEventListener("click", () => {
	const demo = `Once upon a time, in a quiet village, a young reader practiced every day.\n\nReading slowly is okay—accuracy matters more than speed.`;
	els.inputText.value = demo;
	els.charCount.textContent = `${demo.length} characters`;
});

els.startBtn.addEventListener("click", () => startSession());
els.resetBtn.addEventListener("click", () => resetStatuses());
els.backBtn.addEventListener("click", () => backOne());
els.skipBtn.addEventListener("click", () => markAndAdvance("skipped"));
els.incorrectBtn.addEventListener("click", () => markAndAdvance("incorrect"));
els.correctBtn.addEventListener("click", () => markAndAdvance("correct"));

// Sliders
els.lookahead?.addEventListener("input", () => {
	els.lookaheadVal.textContent = String(els.lookahead.value);
	if (state.aligner) {
		const beamWidth = Math.max(2, Math.min(10, Number(els.lookahead.value) + 2));
		state.aligner.setConfig({ beamWidth });
	}
});
els.threshold?.addEventListener("input", () => {
	const v = Number(els.threshold.value);
	els.thresholdVal.textContent = v.toFixed(2);
	if (state.aligner) state.aligner.setConfig({ threshold: v });
});

// Auto-backtrack controls
els.backtrackThreshold?.addEventListener("input", () => {
	const v = Number(els.backtrackThreshold.value);
	state.backtrackThreshold = v;
});

els.backtrackWindow?.addEventListener("input", () => {
	const v = Number(els.backtrackWindow.value);
	state.backtrackWindow = Math.max(4, Math.min(20, v));
});

// Keyboard shortcuts
window.addEventListener("keydown", (e) => {
	if (
		e.target &&
		(e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT")
	)
		return;
	if (!state.tokens.length) return;
	if (e.key === "ArrowLeft") {
		e.preventDefault();
		backOne();
	} else if (e.key === "ArrowRight") {
		e.preventDefault();
		markAndAdvance("correct");
	} else if (e.key.toLowerCase() === "c") {
		e.preventDefault();
		markAndAdvance("correct");
	} else if (e.key.toLowerCase() === "x") {
		e.preventDefault();
		markAndAdvance("incorrect");
	} else if (e.key.toLowerCase() === "s") {
		e.preventDefault();
		markAndAdvance("skipped");
	} else if (e.key === "0") {
		e.preventDefault();
		resetStatuses();
	} else if (e.key === "b") {
		e.preventDefault();
		triggerManualBacktrack();
	} else if (e.key === "d") {
		e.preventDefault();
		showDecisionBufferState();
	}
});

bindTokenJump(els.tokensContainer, (idx) => {
	// Jump to clicked word; set that word current without changing status
	setPointer(idx);
});

bindSentenceClicks((sentenceId) => {
	const s = state.sentences.find((x) => x.id === sentenceId);
	if (!s) return;
	setPointer(s.startIndex);
});

// Initial state
setControlsEnabled(false);

// Speech integration (M2)
state.speech = new SpeechEngine();
if (!state.speech.supported) {
	setASRStatus("unsupported");
} else {
	setASRStatus("idle");
}

function ensureSessionStarted() {
	if (!state.sessionActive) startSession();
}

state.speech.onStatus = (s) => setASRStatus(s);
state.speech.onPartial = (text) => {
	setLastHeard(text);
};
state.speech.onFinal = (text) => {
	setLastHeard(text);
	ensureSessionStarted();
	if (!state.aligner) return;
	const consumed = state.aligner.advanceWithPhrase(text);
	if (consumed > 0) {
		refreshMetrics();
		// Check for auto-backtrack after speech processing
		checkAutoBacktrack();
	}
};

els.micStartBtn.addEventListener("click", () => {
	if (!state.tokens.length) return;
	if (els.langSelect?.value) state.speech.setLanguage(els.langSelect.value);
	state.speech.start();
});
els.micStopBtn.addEventListener("click", () => {
	state.speech.stop();
});

// Drift banner actions
els.realignNextSentenceBtn?.addEventListener("click", () => {
	if (!state.sentences.length) {
		showDriftBanner(false);
		return;
	}
	const currentIdx =
		state.pointer >= 0 ? state.pointer : firstWordIndex(state.tokens);
	const currentSentence = state.sentences.find(
		(s) => s.startIndex <= currentIdx && currentIdx <= s.endIndex
	);
	if (!currentSentence) {
		showDriftBanner(false);
		return;
	}
	const next = state.sentences[currentSentence.id + 1];
	if (next) setPointer(next.startIndex);
	showDriftBanner(false);
});
els.realignDismissBtn?.addEventListener("click", () => showDriftBanner(false));
