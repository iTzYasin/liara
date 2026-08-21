import type { Confidence, SourceDocument } from "@/modules/chat/types";

export interface CitationPolicyResult {
  text: string;
  sources: SourceDocument[];
  invalidCitationCount: number;
  confidence: Confidence;
}

const citationPattern = /\[\[(\d+)\]\]/g;
const anyCitationPattern = /\[\[([\s\S]*?)\]\]/g;
const liaraClaimPattern =
  /لیارا|پلتفرم|برنامه|سرویس|دیتابیس|دامنه|dns|سرور|باکت|ذخیره.?سازی|ایمیل|smtp|مدل|api|کنسول|cli|استقرار|deploy|پلن|شبکه خصوصی/i;

function citationIndexes(text: string) {
  return [...text.matchAll(citationPattern)].map((match) => Number(match[1]));
}

function isStructuralBlock(block: string) {
  const trimmed = block.trim();
  return (
    !trimmed ||
    /^#{1,6}\s/.test(trimmed) ||
    /^```[\s\S]*```$/.test(trimmed) ||
    /^(?:قدم بعدی|برای ادامه|نکته|هشدار)[:：]?$/i.test(trimmed) ||
    /[؟?]\s*$/.test(trimmed)
  );
}

function refusalText() {
  return [
    "**پاسخ به‌دلیل نداشتن ارجاع معتبر نمایش داده نشد.**",
    "",
    "برای جلوگیری از ارائه اطلاعات ساختگی درباره لیارا، لطفاً پرسش را دقیق‌تر کنید یا دوباره تلاش کنید.",
  ].join("\n");
}

/**
 * Enforces the grounding contract before any model-authored text reaches the UI.
 * Unknown citations and uncited Liara-specific claims are removed as whole blocks.
 */
export function enforceCitationPolicy(
  text: string,
  retrievedSources: SourceDocument[],
): CitationPolicyResult {
  const sourceByIndex = new Map(retrievedSources.map((source) => [source.citationIndex, source]));
  let invalidCitationCount = 0;
  const keptBlocks: string[] = [];

  for (const block of text.split(/\n{2,}/)) {
    let invalidMarkers = 0;
    const cleanedBlock = block.replace(anyCitationPattern, (marker, rawIndex: string) => {
      const index = /^\d+$/.test(rawIndex) ? Number(rawIndex) : NaN;
      if (!Number.isInteger(index) || !sourceByIndex.has(index)) {
        invalidMarkers += 1;
        return "";
      }
      return marker;
    }).replace(/[ \t]+\n/g, "\n").trim();
    const indexes = citationIndexes(cleanedBlock);
    const uncitedClaim = indexes.length === 0 && liaraClaimPattern.test(cleanedBlock) && !isStructuralBlock(cleanedBlock);
    invalidCitationCount += invalidMarkers;
    if (uncitedClaim) {
      if (!invalidMarkers) invalidCitationCount += 1;
      continue;
    }
    keptBlocks.push(cleanedBlock);
  }

  const blocksWithContent = keptBlocks.filter((block, index) => {
    if (!/^#{1,6}\s/.test(block)) return true;
    const nextBlock = keptBlocks[index + 1];
    return Boolean(nextBlock && !/^#{1,6}\s/.test(nextBlock));
  });
  const keptText = blocksWithContent.join("\n\n").trim();
  const usedOriginalIndexes = [...new Set(citationIndexes(keptText))]
    .filter((index) => sourceByIndex.has(index));

  if (!usedOriginalIndexes.length) {
    return {
      text: refusalText(),
      sources: [],
      invalidCitationCount: Math.max(1, invalidCitationCount),
      confidence: "low",
    };
  }

  const remap = new Map(usedOriginalIndexes.map((index, position) => [index, position + 1]));
  const normalizedText = keptText.replace(citationPattern, (_marker, rawIndex: string) => {
    const replacement = remap.get(Number(rawIndex));
    return replacement ? `[[${replacement}]]` : "";
  });
  const usedSources = usedOriginalIndexes.map((index, position) => ({
    ...sourceByIndex.get(index)!,
    citationIndex: position + 1,
  }));

  return {
    text: normalizedText,
    sources: usedSources,
    invalidCitationCount,
    confidence: invalidCitationCount ? "medium" : "high",
  };
}
