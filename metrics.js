// Session metrics for M1

export function computeMetrics(tokens, startedAtMs) {
	const total = tokens.filter((t) => t.isWord).length;
	let correct = 0,
		incorrect = 0,
		skipped = 0;
	for (const t of tokens) {
		if (!t.isWord) continue;
		if (t.status === "correct") correct++;
		else if (t.status === "incorrect") incorrect++;
		else if (t.status === "skipped") skipped++;
	}
	const completed = correct + incorrect + skipped;
	const now = Date.now();
	const elapsedSec = startedAtMs ? (now - startedAtMs) / 1000 : 0;
	const elapsedMin = elapsedSec / 60;
	const wpm = elapsedMin > 0 ? correct / elapsedMin : NaN;
	const accuracy = completed > 0 ? correct / completed : NaN;
	return {
		total,
		completed,
		correct,
		incorrect,
		skipped,
		wpm,
		accuracy,
		elapsedSec,
	};
}
