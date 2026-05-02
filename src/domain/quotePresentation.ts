import { calculateJobQuoteSummary, type QuoteSummary } from "./quote";
import type { Elevation, Job, QuoteRulePack } from "./types";

export type QuotePresentationSection = "project" | "pricing" | "scope" | "materials" | "totals";

export interface QuotePresentationRow {
  id: string;
  label: string;
  value: string;
  section: QuotePresentationSection;
  amount?: number;
  customerVisible: boolean;
}

export interface QuotePresentation {
  title: string;
  intro: string;
  outputRows: QuotePresentationRow[];
  internalRows: QuotePresentationRow[];
  assumptions: string[];
  exclusions: string[];
  pricingProfile: {
    id: string;
    name: string;
    version: string;
    effectiveDate: string;
    owner: string;
    displayName: string;
    effectiveLabel: string;
  };
  totals: {
    subtotal: number;
    subtotalDisplay: string;
    marginPercent: number;
    marginAmount: number;
    marginDisplay: string;
    total: number;
    totalDisplay: string;
  };
}

export interface QuotePresentationInput {
  quote: QuoteSummary;
  jobLabel: string;
  customerLabel: string;
  scopeLabel: string;
  scopeValue: string;
  title?: string;
}

export function buildStorefrontQuotePresentation(
  elevations: Elevation[],
  job: Job,
  quoteRulePack: QuoteRulePack
): QuotePresentation {
  const quote = calculateJobQuoteSummary(elevations, quoteRulePack);
  return buildQuotePresentation({
    quote,
    jobLabel: `${job.number || "-"} ${job.name || ""}`.trim(),
    customerLabel: job.customer || "-",
    scopeLabel: "Elevations",
    scopeValue: elevations.map((elevation, index) => `E${index + 1} ${elevation.name}`).join(", ")
  });
}

export function buildQuotePresentation({
  quote,
  jobLabel,
  customerLabel,
  scopeLabel,
  scopeValue,
  title = "Customer Quote"
}: QuotePresentationInput): QuotePresentation {
  const pricingProfile = {
    id: quote.pricingProfileId,
    name: quote.pricingProfileName,
    version: quote.pricingProfileVersion,
    effectiveDate: quote.pricingEffectiveDate,
    owner: quote.pricingOwner,
    displayName: `${quote.pricingProfileName} v${quote.pricingProfileVersion}`,
    effectiveLabel: `${quote.pricingEffectiveDate} / ${quote.pricingOwner}`
  };
  const [intro, ...remainingAssumptions] = quote.pricingAssumptions;
  const assumptions = intro ? [intro] : [];
  const exclusions = remainingAssumptions;
  const outputRows: QuotePresentationRow[] = [
    row("job", "Job", jobLabel, "project"),
    row("customer", "Customer", customerLabel, "project"),
    row("scope", scopeLabel, scopeValue, "scope"),
    row("pricing-profile", "Pricing profile", pricingProfile.displayName, "pricing"),
    row("pricing-effective", "Pricing effective", pricingProfile.effectiveLabel, "pricing"),
    ...(quote.doorOpeningSquareFeet > 0
      ? [
          row(
            "door-opening-area",
            "Door opening area",
            `${formatSquareFeet(quote.doorOpeningSquareFeet)} sq ft noted separately`,
            "scope"
          )
        ]
      : []),
    row("opening-area", "Opening area", `${formatSquareFeet(quote.openingSquareFeet)} sq ft total`, "scope"),
    row(
      "glass",
      "Glass",
      `${formatSquareFeet(quote.glassSquareFeet)} sq ft @ ${formatCurrency(quote.glassRatePerSquareFoot)} / sq ft`,
      "materials"
    ),
    row("glass-total", "Glass total", formatCurrency(quote.glassCost), "materials", quote.glassCost),
    row(
      "aluminum",
      "Aluminum",
      `${quote.aluminumLinearFeet.toFixed(2)} ln ft @ ${formatCurrency(quote.aluminumRatePerLinearFoot)} / ln ft`,
      "materials"
    ),
    row("aluminum-total", "Aluminum total", formatCurrency(quote.aluminumCost), "materials", quote.aluminumCost),
    ...(quote.highHeavyGlassSquareFeet > 0
      ? [
          row(
            "high-heavy-glass-premium",
            "High/heavy glass premium",
            `${formatSquareFeet(quote.highHeavyGlassSquareFeet)} sq ft @ +${formatCurrency(quote.highHeavyGlassPremiumRate)} / sq ft`,
            "materials"
          ),
          row("high-heavy-glass-premium-total", "Premium total", formatCurrency(quote.highHeavyGlassPremiumCost), "materials", quote.highHeavyGlassPremiumCost)
        ]
      : []),
    ...(quote.lowHeavyGlassSquareFeet > 0
      ? [
          row(
            "low-heavy-glass-premium",
            "Heavy glass handling premium",
            `${formatSquareFeet(quote.lowHeavyGlassSquareFeet)} sq ft under 5'-0\" @ +${formatCurrency(quote.lowHeavyGlassPremiumRate)} / sq ft`,
            "materials"
          ),
          row("low-heavy-glass-premium-total", "Heavy handling total", formatCurrency(quote.lowHeavyGlassPremiumCost), "materials", quote.lowHeavyGlassPremiumCost)
        ]
      : []),
    ...(quote.singleDoorCount > 0
      ? [row("single-doors", "Single doors", `${quote.singleDoorCount} @ ${formatCurrency(quote.singleDoorPrice)}`, "materials")]
      : []),
    ...(quote.pairDoorCount > 0
      ? [row("pair-doors", "Pair doors", `${quote.pairDoorCount} @ ${formatCurrency(quote.pairDoorPrice)}`, "materials")]
      : []),
    ...(quote.doorCost > 0
      ? [row("door-total", "Door total", formatCurrency(quote.doorCost), "materials", quote.doorCost)]
      : []),
    ...(quote.marginPercent !== 0
      ? [
          row("subtotal", "Subtotal", formatCurrency(quote.subtotal), "totals", quote.subtotal),
          row("margin", "Margin", `${quote.marginPercent}% (${formatCurrency(quote.marginAmount)})`, "totals", quote.marginAmount)
        ]
      : [])
  ];

  return {
    title,
    intro: intro ?? "Budgetary field quote based on active pricing profile.",
    outputRows,
    internalRows: [
      row("pricing-profile-id", "Pricing profile ID", quote.pricingProfileId, "pricing", undefined, false),
      row("quoted-storefront-area", "Quoted storefront area", `${formatSquareFeet(quote.quotedStorefrontSquareFeet)} sq ft`, "scope", undefined, false),
      row("subtotal-internal", "Subtotal", formatCurrency(quote.subtotal), "totals", quote.subtotal, false),
      row("margin-internal", "Margin", `${quote.marginPercent}% / ${formatCurrency(quote.marginAmount)}`, "totals", quote.marginAmount, false)
    ],
    assumptions,
    exclusions,
    pricingProfile,
    totals: {
      subtotal: quote.subtotal,
      subtotalDisplay: formatCurrency(quote.subtotal),
      marginPercent: quote.marginPercent,
      marginAmount: quote.marginAmount,
      marginDisplay: formatCurrency(quote.marginAmount),
      total: quote.total,
      totalDisplay: formatCurrency(quote.total)
    }
  };
}

function row(
  id: string,
  label: string,
  value: string,
  section: QuotePresentationSection,
  amount?: number,
  customerVisible = true
): QuotePresentationRow {
  return { id, label, value, section, amount, customerVisible };
}

export function formatQuoteCurrency(value: number): string {
  return formatCurrency(value);
}

function formatSquareFeet(value: number): string {
  return value.toFixed(2);
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}
