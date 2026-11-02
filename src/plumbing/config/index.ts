import fixtureLibraryJson from "./fixtures.json";
import materialCatalogJson from "./materials.json";
import pipingRulePackJson from "./piping.json";
import pricingJson from "./pricing.json";
import type {
  FixtureLibrary,
  MaterialCatalog,
  PipeSystem,
  PipingRulePack,
  PlumbingConfig,
  PlumbingPricingRulePack,
  RunLocation
} from "../domain/types";

export const defaultFixtureLibrary = fixtureLibraryJson as FixtureLibrary;
export const defaultMaterialCatalog = materialCatalogJson as MaterialCatalog;
export const defaultPipingRulePack = pipingRulePackJson as PipingRulePack;
export const defaultPlumbingPricing = pricingJson as PlumbingPricingRulePack;

export const defaultPlumbingConfig: PlumbingConfig = {
  fixtureLibrary: defaultFixtureLibrary,
  materialCatalog: defaultMaterialCatalog,
  pipingRulePack: defaultPipingRulePack,
  pricing: defaultPlumbingPricing
};

export const pipeSystemOptions: { value: PipeSystem; label: string }[] = defaultPipingRulePack.systems.map((rule) => ({
  value: rule.system,
  label: rule.label
}));

export const runLocationOptions: { value: RunLocation; label: string }[] = [
  { value: "underground", label: "Underground" },
  { value: "aboveground", label: "Above ground" },
  { value: "in-wall", label: "In wall" }
];
