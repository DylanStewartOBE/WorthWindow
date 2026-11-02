import { Minus, Plus } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { formatInchesFraction, formatQty, parseFeet, parseInches } from "../domain/math";

export function SectionTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="section-title pl-section-title">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="segmented">
      <legend>{label}</legend>
      <div>
        {options.map((option) => (
          <button
            type="button"
            key={option.value}
            className={value === option.value ? "selected" : ""}
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function Stepper({
  label,
  value,
  min = 0,
  onChange
}: {
  label: string;
  value: number;
  min?: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  return (
    <div className="pl-stepper" role="group" aria-label={label}>
      <button type="button" className="icon-button" aria-label={`Decrease ${label}`} onClick={() => onChange(Math.max(min, value - 1))}>
        <Minus size={16} />
      </button>
      <input
        type="number"
        inputMode="numeric"
        pattern="[0-9]*"
        min={min}
        aria-label={label}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          const parsed = Number(event.target.value);
          if (event.target.value !== "" && Number.isFinite(parsed)) onChange(Math.max(min, Math.round(parsed)));
        }}
        onBlur={() => setDraft(String(value))}
      />
      <button type="button" className="icon-button" aria-label={`Increase ${label}`} onClick={() => onChange(value + 1)}>
        <Plus size={16} />
      </button>
    </div>
  );
}

/** Free-text numeric entry that only commits a value once it parses. */
function ParsedField({
  label,
  value,
  format,
  parse,
  onChange,
  placeholder,
  inputMode = "decimal",
  hint
}: {
  label: string;
  value: number | null;
  format: (value: number) => string;
  parse: (raw: string) => number | null;
  onChange: (value: number | null) => void;
  placeholder?: string;
  inputMode?: "decimal" | "numeric";
  hint?: string;
}) {
  const [draft, setDraft] = useState(value === null ? "" : format(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(value === null ? "" : format(value));
  }, [focused, value, format]);

  const invalid = draft.trim() !== "" && parse(draft) === null;

  return (
    <label className={`field${invalid ? " pl-invalid" : ""}`}>
      <span>{label}</span>
      <input
        type="text"
        inputMode={inputMode}
        enterKeyHint="done"
        autoComplete="off"
        placeholder={placeholder}
        value={draft}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(event) => {
          setDraft(event.target.value);
          if (event.target.value.trim() === "") {
            onChange(null);
            return;
          }
          const parsed = parse(event.target.value);
          if (parsed !== null && parsed >= 0) onChange(parsed);
        }}
      />
      {hint && <small className="field-note">{hint}</small>}
    </label>
  );
}

export function FeetField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <ParsedField
      label={label}
      value={value || null}
      format={formatQty}
      parse={parseFeet}
      placeholder={`e.g. 42 or 42'6"`}
      onChange={(next) => onChange(next ?? 0)}
    />
  );
}

export function InchField({
  label,
  value,
  onChange,
  placeholder,
  hint
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <ParsedField
      label={label}
      value={value}
      format={(inches) => formatInchesFraction(inches).replace(/"$/, "")}
      parse={parseInches}
      placeholder={placeholder ?? `e.g. 17 1/2`}
      onChange={onChange}
      hint={hint}
    />
  );
}

export function OptionalCountField({
  label,
  value,
  placeholder,
  onChange
}: {
  label: string;
  value: number | null;
  placeholder: string;
  onChange: (value: number | null) => void;
}) {
  return (
    <ParsedField
      label={label}
      value={value}
      format={(count) => String(count)}
      parse={(raw) => (/^\d+$/.test(raw.trim()) ? Number(raw.trim()) : null)}
      placeholder={placeholder}
      inputMode="numeric"
      onChange={onChange}
    />
  );
}

export function MoneyField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <ParsedField
      label={label}
      value={value}
      format={(amount) => String(amount)}
      parse={(raw) => {
        const parsed = Number(raw.replace(/[$,\s]/g, ""));
        return Number.isFinite(parsed) ? parsed : null;
      }}
      onChange={(next) => onChange(next ?? 0)}
    />
  );
}

export function Metric({
  label,
  value,
  tone,
  secondary,
  compactValue
}: {
  label: string;
  value: string;
  /** Shorter value for the phone summary strip. */
  compactValue?: string;
  tone?: "warning" | "error";
  /** Hidden in the compact phone summary. */
  secondary?: boolean;
}) {
  return (
    <div className={`metric${tone ? ` pl-metric-${tone}` : ""}${secondary ? " pl-secondary" : ""}`}>
      <span>{label}</span>
      {compactValue ? (
        <strong>
          <span className="pl-full">{value}</span>
          <span className="pl-compact">{compactValue}</span>
        </strong>
      ) : (
        <strong>{value}</strong>
      )}
    </div>
  );
}

/**
 * Two-tap confirmation for destructive actions. Works where browser confirm dialogs are blocked
 * and avoids modal pop-ups on a phone.
 */
export function ConfirmButton({
  className,
  confirmLabel,
  onConfirm,
  children
}: {
  className: string;
  confirmLabel: string;
  onConfirm: () => void;
  children: ReactNode;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(timer);
  }, [armed]);

  return (
    <button
      type="button"
      className={`${className}${armed ? " pl-armed" : ""}`}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
        }
      }}
      onBlur={() => setArmed(false)}
    >
      {armed ? confirmLabel : children}
    </button>
  );
}
