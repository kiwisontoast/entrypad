import { defaultSettings, getSetting, setSetting, settingsSpec } from "@entrypad/core";
import type { EntrypadSettings, SettingSpec, SettingValue } from "@entrypad/core";
import { useId, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { theme } from "./theme.js";

export interface SettingsPanelProps {
  settings: EntrypadSettings;
  onChange: (next: EntrypadSettings) => void;
  /** Show only file settings (saved with the book), only app settings, or both. */
  scope?: "file" | "app" | "all";
  /**
   * Settings the host page doesn't act on yet. They stay editable and are
   * marked, so nothing is hidden from the user.
   */
  inactive?: (key: string) => boolean;
  inactiveNote?: string;
}

const scopeNote = {
  file: "Saved with the book",
  app: "Your preference",
} as const;

/**
 * Every Entrypad setting, generated from the registry in @entrypad/core, so a
 * new setting shows up here without any change to this component.
 */
export function SettingsPanel({
  settings,
  onChange,
  scope = "all",
  inactive,
  inactiveNote = "Not used on this page yet",
}: SettingsPanelProps) {
  const [query, setQuery] = useState("");
  const defaults = useMemo(defaultSettings, []);
  const searchId = useId();

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = settingsSpec.filter(
      (s) =>
        (scope === "all" || s.scope === scope) &&
        (!q || [s.label, s.description, s.group, s.key].some((t) => t.toLowerCase().includes(q))),
    );
    const byGroup = new Map<string, SettingSpec[]>();
    for (const s of shown) byGroup.set(s.group, [...(byGroup.get(s.group) ?? []), s]);
    return [...byGroup];
  }, [query, scope]);

  const changed = settingsSpec.filter((s) => getSetting(settings, s.key) !== getSetting(defaults, s.key)).length;

  return (
    <div className="entrypad-settings" style={styles.panel}>
      <div style={styles.toolbar}>
        <label htmlFor={searchId} style={styles.visuallyHidden}>
          Search settings
        </label>
        <input
          id={searchId}
          type="search"
          placeholder="Search settings"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={styles.search}
        />
        <span style={styles.muted}>{changed === 0 ? "All defaults" : `${changed} changed`}</span>
        <button type="button" disabled={changed === 0} onClick={() => onChange(defaultSettings())} style={styles.button}>
          Reset to defaults
        </button>
      </div>
      {groups.length === 0 && <p style={styles.muted}>No settings match.</p>}
      {groups.map(([group, specs]) => (
        <fieldset key={group} style={styles.fieldset}>
          <legend style={styles.legend}>{group}</legend>
          {specs.map((spec) => (
            <SettingRow
              key={spec.key}
              spec={spec}
              value={getSetting(settings, spec.key)!}
              isDefault={getSetting(settings, spec.key) === getSetting(defaults, spec.key)}
              note={inactive?.(spec.key) ? inactiveNote : undefined}
              onChange={(value) => onChange(setSetting(settings, spec.key, value))}
            />
          ))}
        </fieldset>
      ))}
    </div>
  );
}

function SettingRow(props: {
  spec: SettingSpec;
  value: SettingValue;
  isDefault: boolean;
  note: string | undefined;
  onChange: (value: SettingValue) => void;
}) {
  const { spec, value, isDefault, note, onChange } = props;
  const id = useId();
  const describedBy = `${id}-desc`;

  let control;
  if (spec.type === "boolean") {
    control = (
      <input
        id={id}
        type="checkbox"
        checked={value === true}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.checked)}
        style={styles.checkbox}
      />
    );
  } else if (spec.type === "choice") {
    control = (
      <select
        id={id}
        value={String(value)}
        aria-describedby={describedBy}
        onChange={(e) => {
          const hit = spec.choices.find((c) => String(c.value) === e.target.value);
          if (hit) onChange(hit.value);
        }}
        style={styles.select}
      >
        {spec.choices.map((c) => (
          <option key={String(c.value)} value={String(c.value)}>
            {c.label}
          </option>
        ))}
      </select>
    );
  } else {
    control = (
      <input
        id={id}
        type="number"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={Number(value)}
        aria-describedby={describedBy}
        onChange={(e) => {
          const n = e.target.valueAsNumber;
          if (Number.isFinite(n) && n >= spec.min && n <= spec.max) onChange(n);
        }}
        style={styles.number}
      />
    );
  }

  const text = (
    <div>
      <label htmlFor={id} style={{ ...styles.label, fontWeight: isDefault ? 500 : 700 }}>
        {spec.label}
        {!isDefault && <span style={styles.changed}> (changed)</span>}
      </label>
      <div id={describedBy} style={styles.muted}>
        {spec.description && <span>{spec.description} </span>}
        <span style={styles.tag}>{scopeNote[spec.scope]}</span>
        {note && <span style={{ ...styles.tag, ...styles.tagInactive }}>{note}</span>}
      </div>
    </div>
  );

  // Checkboxes sit beside their label; menus and numbers go under it at full width.
  return spec.type === "boolean" ? (
    <div style={styles.row} data-setting={spec.key} data-changed={!isDefault || undefined}>
      <div style={styles.control}>{control}</div>
      {text}
    </div>
  ) : (
    <div style={styles.stack} data-setting={spec.key} data-changed={!isDefault || undefined}>
      {text}
      <div>{control}</div>
    </div>
  );
}

const styles = {
  panel: { font: `14px/1.45 ${theme.font}`, color: theme.ink, display: "grid", gap: 12 },
  toolbar: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" },
  search: {
    flex: "1 1 200px",
    font: "inherit",
    padding: "4px 8px",
    border: `1px solid ${theme.border}`,
    borderRadius: 6,
  },
  button: {
    font: "inherit",
    padding: "4px 12px",
    border: `1px solid ${theme.border}`,
    borderRadius: 6,
    background: theme.surface,
    color: theme.ink,
  },
  fieldset: { border: `1px solid ${theme.border}`, borderRadius: 8, padding: "8px 12px 12px", margin: 0 },
  legend: { fontWeight: 600, padding: "0 4px" },
  row: { display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 10px", padding: "6px 0" },
  stack: { display: "grid", gap: 4, padding: "6px 0 6px 26px" },
  control: { display: "flex", alignItems: "flex-start", paddingTop: 3 },
  checkbox: { width: 16, height: 16, margin: 0 },
  select: { font: "inherit", maxWidth: "100%", padding: "2px 4px" },
  number: { font: "inherit", width: 110, padding: "2px 4px" },
  label: { display: "block" },
  changed: { color: theme.accent, fontWeight: 500 },
  muted: { color: theme.muted, fontSize: 12.5 },
  tag: {
    display: "inline-block",
    marginRight: 6,
    padding: "0 6px",
    border: `1px solid ${theme.border}`,
    borderRadius: 999,
    fontSize: 11.5,
    lineHeight: "17px",
    whiteSpace: "nowrap",
  },
  tagInactive: { borderStyle: "dashed" },
  visuallyHidden: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
  },
} satisfies Record<string, CSSProperties>;
