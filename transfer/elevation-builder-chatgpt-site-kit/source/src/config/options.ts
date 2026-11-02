import storefrontRulePackJson from "./rulepacks/fg2000-baseline.json";
import entranceRulePackJson from "./rulepacks/entrance-ws500.json";
import quoteRulePackJson from "./rulepacks/quote-pricing.json";
import noteLibraryJson from "./note-library.json";
import validationLibraryJson from "./validation-library.json";
import brandingJson from "./branding.json";
import type {
  BrandingConfig,
  EntranceRulePack,
  NoteLibrary,
  QuoteRulePack,
  StorefrontRulePack,
  ValidationLibrary
} from "../domain/types";

export const defaultStorefrontRulePack = storefrontRulePackJson as StorefrontRulePack;
export const defaultEntranceRulePack = entranceRulePackJson as EntranceRulePack;
export const defaultQuoteRulePack = quoteRulePackJson as QuoteRulePack;
export const defaultNoteLibrary = noteLibraryJson as NoteLibrary;
export const defaultValidationLibrary = validationLibraryJson as ValidationLibrary;
export const defaultBranding = brandingJson as BrandingConfig;

export const finishOptions = [
  { id: "clear-anodized", label: "Clear anodized" },
  { id: "bronze-anodized", label: "Bronze anodized" },
  { id: "painted", label: "Painted, confirm color" }
];

export const glassOptions = [
  { id: "quarter-clear", label: "1/4 in clear glass" },
  { id: "quarter-tempered", label: "1/4 in clear tempered" },
  { id: "quarter-laminated", label: "1/4 in laminated safety" }
];

export const hardwareOptions = [
  { id: "rim-panic", label: "Rim panic" },
  { id: "surface-vertical-rod", label: "Surface vertical rod" },
  { id: "concealed-vertical-rod", label: "Concealed vertical rod" },
  { id: "closer", label: "Closer" },
  { id: "pull-push", label: "Pull / push" }
];

export const thresholdOptions = [
  { id: "standard-threshold", label: "Standard accessible threshold" },
  { id: "no-threshold", label: "No raised threshold" },
  { id: "field-verify", label: "Field verify transition" }
];
