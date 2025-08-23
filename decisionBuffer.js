// decisionBuffer.js

/**
 * Ring buffer for tracking recent alignment decisions.
 * Stores up to `size` decisions, overwriting oldest when full.
 */
export class DecisionBuffer {
  constructor(size = 20) {
    this.size = size;
    this.buffer = [];
    this.head = 0;
    this.count = 0;
  }

  /**
   * Add a new decision to the buffer.
   * If the buffer is full, overwrite the oldest entry.
   * @param {Object} decision - The decision object to add.
   */
  push(decision) {
    if (this.count < this.size) {
      this.buffer.push(decision);
      this.count++;
    } else {
      this.buffer[this.head] = decision;
      this.head = (this.head + 1) % this.size;
    }
  }

  /**
   * Get the most recent `count` decisions.
   * @param {number} count - Number of recent decisions to retrieve.
   * @returns {Array} - Array of decision objects.
   */
  getRecent(count) {
    if (count >= this.count) return [...this.buffer];
    const result = [];
    for (let i = 0; i < count; i++) {
      const idx = (this.head - count + i + this.size) % this.size;
      if (this.buffer[idx]) result.push(this.buffer[idx]);
    }
    return result;
  }

  /**
   * Clear the buffer.
   */
  clear() {
    this.buffer = [];
    this.head = 0;
    this.count = 0;
  }
}
