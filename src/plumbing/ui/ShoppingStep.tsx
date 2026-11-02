import { ClipboardCopy, FileDown, FileSpreadsheet } from "lucide-react";
import { useState } from "react";
import { formatCurrency, formatPipeSize, formatQty } from "../domain/math";
import { getBrandOptions, resolveBrand, type ShoppingList } from "../domain/shopping";
import type { PlumbingConfig, PlumbingJob, PlumbingTakeoff } from "../domain/types";
import { SectionTitle, Segmented } from "./fields";

type UpdateJob = (updater: (job: PlumbingJob) => PlumbingJob) => void;
const ADD_BRAND = "__add__";

export function ShoppingStep({
  job,
  updateJob,
  config,
  takeoff,
  list,
  listText,
  onExport,
  onStatus
}: {
  job: PlumbingJob;
  updateJob: UpdateJob;
  config: PlumbingConfig;
  takeoff: PlumbingTakeoff;
  list: ShoppingList;
  listText: string;
  onExport: (type: "shopping" | "shopping-csv") => void;
  onStatus: (message: string) => void;
}) {
  const [view, setView] = useState<"list" | "cuts">("list");
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [newBrand, setNewBrand] = useState("");

  const brandKeys = [...new Set(list.sections.flatMap((section) => section.items.map((item) => item.brandKey)))].filter(
    (key) => key && getBrandOptions(key, config, job).length > 0
  );
  const groupName = (key: string) => {
    const [kind, id] = key.split(":");
    const material = config.pipingRulePack.pipeMaterials.find((candidate) => candidate.id === id);
    if (kind === "pipe") return `${material?.label ?? id} pipe`;
    if (kind === "fitting") return `${material?.label ?? id} fittings`;
    return config.materialCatalog.materials.find((candidate) => candidate.id === id)?.label ?? id;
  };

  const setBrand = (key: string, brand: string) =>
    updateJob((current) => ({ ...current, brandChoices: { ...current.brandChoices, [key]: brand } }));

  const copyList = async () => {
    try {
      await navigator.clipboard.writeText(listText);
      onStatus("Material list copied");
    } catch {
      const area = document.getElementById("pl-shopping-text") as HTMLTextAreaElement | null;
      area?.focus();
      area?.select();
      onStatus("Copy is blocked here. The list is selected below; copy it by hand.");
    }
  };

  return (
    <>
      <section className="step-content">
        <SectionTitle
          title="Shopping List"
          subtitle="What to order: pipe in full sticks or coils from the cut list, fittings by type and size, rough-in and trim parts, supports, and site materials. Labor is not on this list."
        />
        <div className="pl-output-grid">
          <button type="button" className="primary-button" onClick={() => onExport("shopping")}>
            <FileDown size={16} /> Shopping list PDF
          </button>
          <button type="button" className="secondary-button" onClick={() => onExport("shopping-csv")}>
            <FileSpreadsheet size={16} /> Spreadsheet (CSV)
          </button>
          <button type="button" className="secondary-button" onClick={copyList}>
            <ClipboardCopy size={16} /> Copy as text
          </button>
        </div>
      </section>

      {brandKeys.length > 0 && (
        <section className="step-content">
          <SectionTitle title="Brands" subtitle="Pick a brand per material group. Type a new one to add it to this job; add it permanently in the rule packs." />
          <div className="pl-brand-grid">
            {brandKeys.map((key) => {
              const options = getBrandOptions(key, config, job);
              const current = resolveBrand(key, config, job);
              return (
                <div key={key} className="field">
                  <span>{groupName(key)}</span>
                  {addingFor === key ? (
                    <div className="pl-inline-add">
                      <input
                        autoFocus
                        value={newBrand}
                        placeholder="Brand name"
                        onChange={(event) => setNewBrand(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && newBrand.trim()) {
                            setBrand(key, newBrand.trim());
                            setAddingFor(null);
                          }
                          if (event.key === "Escape") setAddingFor(null);
                        }}
                      />
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={!newBrand.trim()}
                        onClick={() => {
                          setBrand(key, newBrand.trim());
                          setAddingFor(null);
                        }}
                      >
                        Add
                      </button>
                    </div>
                  ) : (
                    <select
                      value={current}
                      onChange={(event) => {
                        if (event.target.value === ADD_BRAND) {
                          setNewBrand("");
                          setAddingFor(key);
                        } else setBrand(key, event.target.value);
                      }}
                    >
                      {options.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                      <option value={ADD_BRAND}>Add a brand...</option>
                    </select>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="step-content">
        <Segmented
          label="View"
          value={view}
          options={[
            { value: "list", label: "Order list" },
            { value: "cuts", label: `Cut list (${takeoff.cutList.length})` }
          ]}
          onChange={setView}
        />

        {view === "list" &&
          list.sections.map((section) => (
            <div key={section.name} className="pl-table-block">
              <h3>{section.name}</h3>
              <div className="pl-table-wrap">
                <table className="pl-table">
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Item</th>
                      <th className="num">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {section.items.map((item) => (
                      <tr key={item.key}>
                        <td className="pl-order-cell">{item.orderText}</td>
                        <td>
                          {item.description}
                          {item.brand && <small>{item.brand}</small>}
                        </td>
                        <td className="num">{item.extCost ? formatCurrency(item.extCost) : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Section</td>
                      <td />
                      <td className="num">{formatCurrency(section.total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          ))}
        {view === "list" && list.sections.length === 0 && <p className="field-note">Nothing to order yet. Add fixtures, pipe runs, or draw on the plans.</p>}
        {view === "list" && list.sections.length > 0 && (
          <div className="pl-quote-total">
            <span>Material total (before tax)</span>
            <strong>{formatCurrency(list.total)}</strong>
          </div>
        )}

        {view === "cuts" && (
          <>
            <p className="field-note">
              Pieces are packed into stock lengths, longest first. The order quantity never drops below the rule-pack waste allowance.
            </p>
            {takeoff.cutList.map((line) => (
              <div key={line.key} className="pl-cut-line">
                <div className="pl-check-head">
                  <strong>
                    {formatPipeSize(line.size)} {line.materialLabel}
                  </strong>
                  <span className="pl-status-chip">
                    {line.sticks} x {line.stockLengthFt}'
                  </span>
                </div>
                <small className="field-note">
                  {formatQty(line.usedFt)} ft installed in {line.pieces.length} piece{line.pieces.length === 1 ? "" : "s"} · {formatQty(line.offcutFt)} ft offcut
                </small>
                <div className="pl-pieces">
                  {line.pieces.slice(0, 60).map((piece, index) => (
                    <span key={index}>{formatQty(piece)}'</span>
                  ))}
                  {line.pieces.length > 60 && <span>+{line.pieces.length - 60} more</span>}
                </div>
              </div>
            ))}
            {takeoff.cutList.length === 0 && <p className="field-note">No pipe yet.</p>}
          </>
        )}
      </section>

      <section className="step-content">
        <SectionTitle title="Text for your supplier" subtitle="Paste into a text or an email." />
        <textarea id="pl-shopping-text" className="pl-shopping-text" readOnly value={listText} />
      </section>
    </>
  );
}
