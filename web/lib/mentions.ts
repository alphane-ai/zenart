import { AssetLibraryItem, BrandKitItem, CanvasNode, ReferenceAsset } from "./contracts";

export type MentionType = "object" | "asset" | "brand" | "skill" | "model";

export type MentionToken = {
  type: MentionType;
  raw: string;
  query: string;
  start: number;
  end: number;
};

export type MentionOption = {
  type: MentionType;
  id: string;
  label: string;
  description?: string;
  allowed: boolean;
};

export type MentionResolution = MentionToken & {
  id: string;
  label: string;
  resolved: boolean;
  duplicate: boolean;
  allowed: boolean;
};

export type MentionParseResult = {
  tokens: MentionToken[];
  resolutions: MentionResolution[];
  uniqueResolutions: MentionResolution[];
  unresolved: MentionToken[];
  duplicateCount: number;
  forbiddenModelMentions: MentionResolution[];
};

export type MentionPickerSource = {
  objects: CanvasNode[];
  references: ReferenceAsset[];
  assetLibraryItems: AssetLibraryItem[];
  brandKits: BrandKitItem[];
  skills: MentionOption[];
  models: MentionOption[];
};

export const mentionTypes: MentionType[] = ["object", "asset", "brand", "skill", "model"];

const mentionPattern = /@(object|asset|brand|skill|model)(?:\[([^\]\r\n]+)\]|:([^\s@,;，。！？、]+))/giu;

export const buildMentionPickerOptions = (source: MentionPickerSource): MentionOption[] => [
  ...source.objects.map((item) => ({
    type: "object" as const,
    id: item.id,
    label: item.title,
    description: item.kind,
    allowed: !item.hidden
  })),
  ...source.references.map((item) => ({
    type: "asset" as const,
    id: item.id,
    label: item.name,
    description: item.kind,
    allowed: item.validation.state === "accepted"
  })),
  ...source.assetLibraryItems.map((item) => ({
    type: "asset" as const,
    id: item.assetId,
    label: item.title,
    description: item.assetType,
    allowed: item.status === "active" && item.reusable && !item.archived
  })),
  ...source.brandKits.map((item) => ({
    type: "brand" as const,
    id: item.id,
    label: item.name,
    description: item.status,
    allowed: item.status === "active"
  })),
  ...source.skills,
  ...source.models
];

export const parseMentionTokens = (text: string): MentionToken[] => {
  const tokens: MentionToken[] = [];
  for (const match of text.matchAll(mentionPattern)) {
    const type = match[1]?.toLowerCase() as MentionType;
    if (!mentionTypes.includes(type)) {
      continue;
    }
    const query = (match[2] ?? match[3] ?? "").trim();
    if (!query) {
      continue;
    }
    tokens.push({
      type,
      raw: match[0],
      query,
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length
    });
  }
  return tokens;
};

export const resolveMentions = (text: string, options: MentionOption[]): MentionParseResult => {
  const tokens = parseMentionTokens(text);
  const seen = new Set<string>();
  const resolutions = tokens.map((token) => {
    const option = findMentionOption(token, options);
    const key = `${token.type}:${option?.id ?? token.query.toLocaleLowerCase()}`;
    const duplicate = seen.has(key);
    seen.add(key);
    return {
      ...token,
      id: option?.id ?? "",
      label: option?.label ?? token.query,
      resolved: Boolean(option),
      duplicate,
      allowed: Boolean(option?.allowed)
    };
  });

  return {
    tokens,
    resolutions,
    uniqueResolutions: resolutions.filter((item) => item.resolved && !item.duplicate),
    unresolved: tokens.filter((token) => !findMentionOption(token, options)),
    duplicateCount: resolutions.filter((item) => item.duplicate).length,
    forbiddenModelMentions: resolutions.filter((item) => item.type === "model" && (!item.resolved || !item.allowed))
  };
};

export const mentionSummary = (result: MentionParseResult) => ({
  tokenCount: result.tokens.length,
  uniqueCount: result.uniqueResolutions.length,
  duplicateCount: result.duplicateCount,
  unresolvedCount: result.unresolved.length,
  forbiddenModelCount: result.forbiddenModelMentions.length,
  types: mentionTypes.filter((type) => result.tokens.some((token) => token.type === type)),
  ids: result.uniqueResolutions.map((item) => `${item.type}:${item.id}`)
});

const findMentionOption = (token: MentionToken, options: MentionOption[]) => {
  const normalizedQuery = normalize(token.query);
  return options.find(
    (option) =>
      option.type === token.type &&
      (normalize(option.id) === normalizedQuery || normalize(option.label) === normalizedQuery)
  );
};

const normalize = (value: string) =>
  value
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+/g, " ");
