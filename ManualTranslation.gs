/**
 * Translates static User Manual copy only. User names, locations, record data,
 * IDs and Google Sheet values are deliberately excluded by the client.
 */
const ManualTranslation = (() => {
  const SUPPORTED_LANGUAGES = new Set(["hi", "bn", "gu", "kn", "ml", "mr", "or", "pa", "ta", "te", "ur"]);
  const MAX_TEXTS = 220;
  const MAX_TEXT_LENGTH = 1200;
  const MAX_TOTAL_LENGTH = 50000;
  const CHUNK_LENGTH = 3500;

  function escapeHtml_(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function decodeHtml_(value) {
    return String(value || "")
      .replace(/<[^>]*>/g, "")
      .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
      .replace(/&#([0-9]+);/g, (_, code) => String.fromCodePoint(parseInt(code, 10)))
      .replace(/&nbsp;/gi, " ")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&amp;/gi, "&");
  }

  function translateChunk_(entries, language, output) {
    const html = entries
      .map(entry => `<p data-tm-index="${entry.index}">${escapeHtml_(entry.text)}</p>`)
      .join("");
    const translated = LanguageApp.translate(html, "en", language, { contentType: "html" });
    const pattern = /<p\b[^>]*data-tm-index\s*=\s*["']?(\d+)["']?[^>]*>([\s\S]*?)<\/p>/gi;
    let match;
    let translatedCount = 0;
    while ((match = pattern.exec(translated)) !== null) {
      const index = Number(match[1]);
      if (Number.isInteger(index) && index >= 0 && index < output.length) {
        output[index] = decodeHtml_(match[2]).trim();
        translatedCount += 1;
      }
    }
    if (translatedCount !== entries.length) {
      throw new Error("The Language service returned an incomplete User Manual translation.");
    }
  }

  function translate(user, payload) {
    const language = Utility.safeString(payload && payload.language).trim().toLowerCase();
    if (!SUPPORTED_LANGUAGES.has(language)) return Utility.error("Unsupported manual language.");

    const input = payload && Array.isArray(payload.texts) ? payload.texts : [];
    if (!input.length || input.length > MAX_TEXTS) return Utility.error("Invalid manual translation request.");

    const texts = input.map(value => Utility.safeString(value).trim());
    const totalLength = texts.reduce((sum, value) => sum + value.length, 0);
    if (texts.some(value => !value || value.length > MAX_TEXT_LENGTH) || totalLength > MAX_TOTAL_LENGTH) {
      return Utility.error("Manual translation request is too large.");
    }

    const output = texts.slice();
    let chunk = [];
    let chunkLength = 0;
    texts.forEach((text, index) => {
      const estimatedLength = text.length + 45;
      if (chunk.length && chunkLength + estimatedLength > CHUNK_LENGTH) {
        translateChunk_(chunk, language, output);
        chunk = [];
        chunkLength = 0;
      }
      chunk.push({ index, text });
      chunkLength += estimatedLength;
    });
    if (chunk.length) translateChunk_(chunk, language, output);

    return Utility.success("User manual translated.", {
      language,
      translations: output
    });
  }

  return Object.freeze({ translate });
})();
