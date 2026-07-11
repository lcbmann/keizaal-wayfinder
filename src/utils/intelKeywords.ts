import type { IntelTopicRow } from "../db/supabase.js";

export function matchingIntelTopics(topics: IntelTopicRow[], content: string): IntelTopicRow[] {
  return topics.filter((topic) => topic.keywords.length > 0 && topic.keywords.some((keyword) => keywordMatchesContent(keyword, content)));
}

export function keywordMatchesContent(keyword: string, content: string): boolean {
  const normalizedKeyword = keyword.trim();
  if (!normalizedKeyword) {
    return false;
  }

  return keywordInflectionVariants(normalizedKeyword).some((variant) => {
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRegExp(variant)}(?=$|[^\\p{L}\\p{N}_])`, "iu");
    return pattern.test(content);
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function keywordInflectionVariants(keyword: string): string[] {
  const variants = new Set([keyword]);
  const lower = keyword.toLocaleLowerCase();

  if (lower.length > 4 && lower.endsWith("ies")) {
    variants.add(`${keyword.slice(0, -3)}y`);
  } else if (lower.length > 4 && lower.endsWith("ves")) {
    variants.add(`${keyword.slice(0, -3)}f`);
    variants.add(`${keyword.slice(0, -3)}fe`);
  } else if (lower.length > 4 && lower.endsWith("es")) {
    variants.add(keyword.slice(0, -2));
  } else if (lower.length > 3 && lower.endsWith("s")) {
    variants.add(keyword.slice(0, -1));
  }

  if (lower.endsWith("y")) {
    variants.add(`${keyword.slice(0, -1)}ies`);
  } else if (lower.endsWith("fe")) {
    variants.add(`${keyword.slice(0, -2)}ves`);
  } else if (lower.endsWith("f")) {
    variants.add(`${keyword.slice(0, -1)}ves`);
  } else if (/(s|x|z|ch|sh)$/iu.test(keyword)) {
    variants.add(`${keyword}es`);
  } else {
    variants.add(`${keyword}s`);
  }

  return [...variants].filter(Boolean);
}
