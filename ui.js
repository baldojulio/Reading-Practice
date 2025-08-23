// UI rendering and interactions for M1

const STATUS_CLASSES = [
	"pending",
	"current",
	"correct",
	"incorrect",
	"skipped",
];

export function renderTokens(tokens, container) {
	container.innerHTML = "";
	const frag = document.createDocumentFragment();
	for (let i = 0; i < tokens.length; i++) {
		const t = tokens[i];
		const span = document.createElement("span");
		span.className = `token ${t.isWord ? "word" : "sep"}`;
		span.textContent = t.text;
		span.dataset.index = String(i);
		if (t.isWord) {
			span.classList.add(t.status);
			span.title = `Word ${t.id + 1}`;
		}
		frag.appendChild(span);
	}
	container.appendChild(frag);
}

export function updateCurrentPointer(tokens, container, pointerIndex) {
	// Remove existing current
	container
		.querySelectorAll(".token.word.current")
		.forEach((el) => el.classList.remove("current"));
	if (pointerIndex < 0) return;
	const el = container.querySelector(
		`.token.word[data-index="${pointerIndex}"]`
	);
	if (el) {
		el.classList.add("current");
		el.scrollIntoView({ block: "center", behavior: "smooth" });
	}
}

export function updateTokenStatus(container, tokenIndex, newStatus) {
	const el = container.querySelector(`.token.word[data-index="${tokenIndex}"]`);
	if (!el) return;
	for (const c of STATUS_CLASSES) el.classList.remove(c);
	el.classList.add(newStatus);
}

export function bindTokenJump(container, onJump) {
	container.addEventListener("click", (e) => {
		const target = e.target;
		if (!(target instanceof HTMLElement)) return;
		if (!target.classList.contains("word")) return;
		const idx = Number(target.dataset.index || -1);
		if (idx >= 0) onJump(idx);
	});
}

export function setControlsEnabled(enabled) {
	for (const id of [
		"startBtn",
		"resetBtn",
		"backBtn",
		"skipBtn",
		"incorrectBtn",
		"correctBtn",
		"micStartBtn",
		"micStopBtn",
		"langSelect",
		"lookahead",
		"threshold",
	]) {
		const el = document.getElementById(id);
		if (el) el.disabled = !enabled;
	}
}

export function updateMetricsView({
	accuracy,
	wpm,
	completed,
	total,
	elapsedSec,
}) {
	const fmtAcc = isFinite(accuracy) ? `${(accuracy * 100).toFixed(0)}%` : "–";
	const fmtWpm = isFinite(wpm) ? `${wpm.toFixed(0)}` : "–";
	document.getElementById("mAccuracy").textContent = fmtAcc;
	document.getElementById("mWpm").textContent = fmtWpm;
	document.getElementById("mProgress").textContent = `${completed} / ${total}`;
	document.getElementById("mElapsed").textContent = `${Math.max(
		0,
		Math.floor(elapsedSec)
	)}s`;
}

export function setTokenTitle(container, tokenIndex, title) {
	const el = container.querySelector(`.token.word[data-index="${tokenIndex}"]`);
	if (el) el.title = title || "";
}

export function setASRStatus(statusText) {
	const s = document.getElementById("mAsr");
	if (s) s.textContent = statusText;
	const ind = document.getElementById("micIndicator");
	if (ind) {
		ind.textContent = /listening|starting/i.test(statusText) ? "ON" : "OFF";
		ind.classList.toggle("on", /listening|starting/i.test(statusText));
		ind.classList.toggle("off", !/listening|starting/i.test(statusText));
	}
}

export function setLastHeard(text) {
	const el = document.getElementById("mHeard");
	if (el) el.textContent = text || "–";
}

export function renderSentences(sentences, currentPointerIdx) {
	const list = document.getElementById("sentencesList");
	if (!list) return;
	list.innerHTML = "";
	const frag = document.createDocumentFragment();
	const currentSentenceId = sentences.find(
		(s) => s.startIndex <= currentPointerIdx && currentPointerIdx <= s.endIndex
	)?.id;
	for (const s of sentences) {
		const div = document.createElement("div");
		div.className =
			"sentence-item" + (currentSentenceId === s.id ? " active" : "");
		div.textContent = s.preview || "(empty)";
		div.dataset.sentenceId = String(s.id);
		frag.appendChild(div);
	}
	list.appendChild(frag);
}

export function bindSentenceClicks(onClick) {
	const list = document.getElementById("sentencesList");
	if (!list) return;
	list.addEventListener("click", (e) => {
		const t = e.target;
		if (!(t instanceof HTMLElement)) return;
		const id = t.dataset.sentenceId;
		if (id != null) onClick(Number(id));
	});
}

export function showDriftBanner(show) {
	const b = document.getElementById("driftBanner");
	if (b) b.classList.toggle("hidden", !show);
}
