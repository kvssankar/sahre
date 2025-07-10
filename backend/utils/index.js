/**
 * Utility functions for JSON parsing and validation
 */

/**
 * Check if a string contains valid JSON within curly braces
 * @param {string} inputString - The input string to check
 * @returns {boolean} True if contains JSON with curly braces
 */
export function hasCurlyBracesWithText(inputString) {
  const regex = /\{[^{}]*}/;
  return regex.test(inputString);
}

/**
 * Extract JSON text from within curly braces
 * @param {string} str - The input string
 * @returns {string|null} The extracted JSON string or null
 */
export function extractTextWithinCurlyBraces(str) {
  const start = str.indexOf("{");
  if (start === -1) return null; // no opening brace

  let depth = 0;
  for (let i = start; i < str.length; i++) {
    const ch = str[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        // `i` now points to the matching closing brace
        return str.slice(start, i + 1);
      }
    }
  }
  // ran out of characters => unbalanced
  return null;
}

/**
 * Safely parse JSON with fallback
 * @param {string} jsonString - The JSON string to parse
 * @param {any} fallback - Fallback value if parsing fails
 * @returns {any} Parsed JSON or fallback value
 */
export function safeJsonParse(jsonString, fallback = null) {
  try {
    return JSON.parse(jsonString);
  } catch (error) {
    console.warn("JSON parse error:", error.message);
    return fallback;
  }
}

/**
 * Extract JSON from a response using regex
 * @param {string} responseText - The response text
 * @returns {any|null} Parsed JSON or null
 */
export function extractJsonFromResponse(responseText) {
  try {
    const match = responseText.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  } catch (error) {
    console.warn("Failed to extract JSON from response:", error.message);
    return null;
  }
}

/**
 * Calculate cosine similarity between two vectors
 * @param {number[]} a - First vector
 * @param {number[]} b - Second vector
 * @returns {number} Cosine similarity score
 */
export function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Create a delay promise
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise} Promise that resolves after the delay
 */
export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Validate that required fields exist in an object
 * @param {object} obj - Object to validate
 * @param {string[]} requiredFields - Array of required field names
 * @throws {Error} If any required field is missing
 */
export function validateRequiredFields(obj, requiredFields) {
  const missing = requiredFields.filter((field) => !(field in obj));
  if (missing.length > 0) {
    throw new Error(`Missing required fields: ${missing.join(", ")}`);
  }
}
