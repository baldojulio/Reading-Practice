// Beam search aligner with online DP for M2
import { normalizeWord } from "./tokenize.js";

const FILLERS = new Set(["uh", "um", "er", "ah", "eh", "mm", "hmm"]);

// Alignment state for beam search
class AlignmentState {
	constructor(textPos, spokenPos, cost, path) {
		this.textPos = textPos;      // position in text tokens
		this.spokenPos = spokenPos;  // position in spoken words
		this.cost = cost;            // cumulative cost
		this.path = path || [];      // alignment history
	}
	
	clone() {
		return new AlignmentState(this.textPos, this.spokenPos, this.cost, [...this.path]);
	}
}

export class Aligner {
	constructor(tokens, ui) {
		this.tokens = tokens; // array with {isWord, status}
		this.pointer = this._firstWordIndex();
		this.beamWidth = 4; // default beam width
		this.threshold = 0.8; // similarity threshold
		this.margin = 0.1; // cost margin for advancing
		this.windowSize = 10; // rolling window size for text tokens
		this.spokenBuffer = []; // buffer of spoken words
		this.beam = []; // current beam states
		// ui hooks: { updateStatus(tokenIndex, status), setPointer(idx), setTitle(tokenIndex, title) }
		this.ui = ui;
		
		// Initialize beam with starting state
		this._resetBeam();
	}

	setConfig({ beamWidth, threshold, margin, windowSize }) {
		if (Number.isFinite(beamWidth))
			this.beamWidth = Math.max(2, Math.min(10, Math.floor(beamWidth)));
		if (Number.isFinite(threshold))
			this.threshold = Math.min(1, Math.max(0, threshold));
		if (Number.isFinite(margin))
			this.margin = Math.min(1, Math.max(0, margin));
		if (Number.isFinite(windowSize))
			this.windowSize = Math.max(5, Math.min(20, Math.floor(windowSize)));
	}

	setPointer(idx) {
		this.pointer = idx;
		if (this.ui?.setPointer) this.ui.setPointer(idx);
	}

	// Consume a finalized phrase; split to words and advance
	advanceWithPhrase(phrase) {
		if (!phrase) return 0;
		const words = phrase
			.split(/\s+/)
			.map((w) => normalizeWord(w))
			.filter((w) => w);
		
		// Add words to spoken buffer
		this.spokenBuffer.push(...words);
		
		// Process alignment with beam search
		this._processBeamSearch();
		
		// Return number of words consumed
		return words.length;
	}

	// Main beam search processing
	_processBeamSearch() {
		if (this.spokenBuffer.length === 0) return;
		
		// Expand beam with new spoken words
		for (const spokenWord of this.spokenBuffer) {
			this._expandBeam(spokenWord);
		}
		
		// Check if we can advance the pointer
		this._checkAdvancement();
		
		// Clear spoken buffer
		this.spokenBuffer = [];
	}

	// Expand beam with a new spoken word
	_expandBeam(spokenWord) {
		const newBeam = [];
		
		for (const state of this.beam) {
			// Get available text tokens in window
			const textTokens = this._getTextTokensInWindow(state.textPos);
			
			for (let i = 0; i < textTokens.length; i++) {
				const textPos = textTokens[i].index;
				const textToken = textTokens[i].token;
				
				// Generate possible transitions
				const transitions = this._generateTransitions(state, textPos, textToken, spokenWord);
				newBeam.push(...transitions);
			}
		}
		
		// Prune to beam width
		this.beam = this._pruneBeam(newBeam);
	}

	// Generate possible transitions from current state
	_generateTransitions(state, textPos, textToken, spokenWord) {
		const transitions = [];
		
		// Match transition
		if (this._canMatch(spokenWord, textToken)) {
			const matchCost = 1 - similarity(spokenWord, textToken.norm);
			const newState = state.clone();
			newState.textPos = textPos + 1;
			newState.spokenPos = state.spokenPos + 1;
			newState.cost += matchCost;
			newState.path.push({
				type: 'match',
				textPos: textPos,
				spokenWord: spokenWord,
				cost: matchCost
			});
			transitions.push(newState);
		}
		
		// Substitution transition
		const subCost = 1 - similarity(spokenWord, textToken.norm);
		const subState = state.clone();
		subState.textPos = textPos + 1;
		subState.spokenPos = state.spokenPos + 1;
		subState.cost += subCost;
		subState.path.push({
			type: 'substitution',
			textPos: textPos,
			spokenWord: spokenWord,
			expected: textToken.norm,
			cost: subCost
		});
		transitions.push(subState);
		
		// Deletion transition (skip text token)
		const delState = state.clone();
		delState.textPos = textPos + 1;
		delState.spokenPos = state.spokenPos;
		delState.cost += 0.5; // moderate cost for deletion
		delState.path.push({
			type: 'deletion',
			textPos: textPos,
			expected: textToken.norm,
			cost: 0.5
		});
		transitions.push(delState);
		
		// Insertion transition (extra spoken word)
		const insertCost = FILLERS.has(spokenWord) ? 0.1 : 0.3; // low cost for fillers
		const insertState = state.clone();
		insertState.textPos = textPos;
		insertState.spokenPos = state.spokenPos + 1;
		insertState.cost += insertCost;
		insertState.path.push({
			type: 'insertion',
			spokenWord: spokenWord,
			cost: insertCost
		});
		transitions.push(insertState);
		
		return transitions;
	}

	// Check if we can advance the pointer based on beam state
	_checkAdvancement() {
		if (this.beam.length === 0) return;
		
		// Find best state
		const bestState = this.beam.reduce((best, current) => 
			current.cost < best.cost ? current : best
		);
		
		// Check if best state is significantly ahead
		const bestTextPos = bestState.textPos;
		const bestCost = bestState.cost;
		
		// Find other states that might be competitive
		const competitiveStates = this.beam.filter(state => 
			state.textPos >= bestTextPos - 1 && 
			state.cost <= bestCost + this.margin
		);
		
		// Only advance if best state is clearly ahead
		if (competitiveStates.length === 1 || 
			(bestTextPos > this.pointer + 2 && bestCost < this.beam.length * 0.5)) {
			
			// Apply the best path
			this._applyPath(bestState.path);
			this.setPointer(bestTextPos);
			
			// Reset beam for next iteration
			this._resetBeam();
		}
	}

	// Apply alignment path to tokens
	_applyPath(path) {
		for (const step of path) {
			switch (step.type) {
				case 'match':
					this._mark(step.textPos, "correct", step.spokenWord);
					break;
				case 'substitution':
					this._mark(step.textPos, "incorrect", step.spokenWord);
					break;
				case 'deletion':
					this._mark(step.textPos, "skipped", "");
					break;
				case 'insertion':
					// Insertions don't mark tokens, just consume spoken words
					break;
			}
		}
	}

	// Get text tokens in rolling window
	_getTextTokensInWindow(startPos) {
		const tokens = [];
		let pos = startPos;
		let count = 0;
		
		while (pos < this.tokens.length && count < this.windowSize) {
			if (this.tokens[pos].isWord) {
				tokens.push({
					index: pos,
					token: this.tokens[pos]
				});
				count++;
			}
			pos++;
		}
		
		return tokens;
	}

	// Prune beam to specified width
	_pruneBeam(states) {
		// Sort by cost and take top beamWidth
		return states
			.sort((a, b) => a.cost - b.cost)
			.slice(0, this.beamWidth);
	}

	// Check if words can match
	_canMatch(spokenWord, textToken) {
		return similarity(spokenWord, textToken.norm) >= this.threshold;
	}

	// Reset beam for next iteration
	_resetBeam() {
		this.beam = [new AlignmentState(this.pointer, 0, 0, [])];
	}

	// Legacy method for backward compatibility
	advanceWithWord(wNorm) {
		if (!wNorm) return false;
		if (FILLERS.has(wNorm)) return false;
		
		// Use beam search instead
		this.spokenBuffer = [wNorm];
		this._processBeamSearch();
		return true;
	}

	_mark(idx, status, heardNorm) {
		const t = this.tokens[idx];
		if (!t || !t.isWord) return;
		t.status = status;
		if (this.ui?.updateStatus) this.ui.updateStatus(idx, status);
		const expected = t ? t.norm : "";
		if (this.ui?.setTitle) {
			if (status === "incorrect") {
				const heard = heardNorm || "";
				this.ui.setTitle(
					idx,
					`Error: substitution\nExpected: ${expected}\nHeard: ${heard}`
				);
			} else if (status === "skipped") {
				this.ui.setTitle(idx, `Error: skipped\nExpected: ${expected}`);
			} else if (status === "correct") {
				this.ui.setTitle(idx, `Correct: ${expected}`);
			}
		}
	}

	_firstWordIndex() {
		for (let i = 0; i < this.tokens.length; i++)
			if (this.tokens[i].isWord) return i;
		return -1;
	}
}

// Levenshtein similarity ratio
function similarity(a, b) {
	const dist = levenshtein(a, b);
	const maxLen = Math.max(a.length, b.length) || 1;
	return 1 - dist / maxLen;
}

function levenshtein(a, b) {
	const m = a.length,
		n = b.length;
	if (m === 0) return n;
	if (n === 0) return m;
	const dp = new Array(n + 1);
	for (let j = 0; j <= n; j++) dp[j] = j;
	for (let i = 1; i <= m; i++) {
		let prev = dp[0];
		dp[0] = i;
		for (let j = 1; j <= n; j++) {
			const temp = dp[j];
			if (a[i - 1] === b[j - 1]) dp[j] = prev;
			else dp[j] = Math.min(prev + 1, dp[j] + 1, dp[j - 1] + 1);
			prev = temp;
		}
	}
	return dp[n];
}
