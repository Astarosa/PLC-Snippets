import { type ReactNode, useEffect, useState } from "react";
import {
  BOX_SPECS,
  type CoilKind,
  type CompareOp,
  type Expr,
  type LadProgram,
  type Value,
} from "../../core/ladder/ast";
import {
  canRemoveOutput,
  type ElementRef,
  getExpr,
  insertParallel,
  newElement,
  type RangeRef,
  removeExpr,
  removeOutput,
  removeRange,
  removeRung,
  replaceExpr,
  replaceOutput,
  setRungComment,
  wrapParallel,
} from "../../core/ladder/edit";
import { parseValueText, toEditableText } from "../../core/ladder/parse";

const field =
  "w-full rounded border bg-slate-950 px-2 py-1 font-mono text-[13px] text-slate-100 focus:outline-none";

/** Champ d'opérande : validé à la frappe, appliqué à la sortie du champ ou sur Entrée. */
function ValueField({
  label,
  value,
  allowLiteral,
  optional = false,
  onCommit,
}: {
  label: string;
  value: string;
  allowLiteral: boolean;
  optional?: boolean;
  onCommit: (value: Value | null) => void;
}) {
  // Les variables API s'affichent sans guillemets : on tape juste le nom.
  const shown = toEditableText(value);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const parsed = text.trim() === "" && optional ? null : parseValueText(text, allowLiteral);
  const error = parsed && !parsed.ok ? parsed.error : null;

  const commit = () => {
    if (text === shown) return;
    if (parsed === null) onCommit(null);
    else if (parsed.ok) onCommit(parsed.value);
  };

  return (
    <label className="block w-52">
      <span className="mb-0.5 block text-[11px] text-slate-400">
        {label}
        {optional && <span className="text-slate-600"> (optionnel)</span>}
      </span>
      <input
        value={text}
        placeholder={
          allowLiteral ? "Variable, #locale, %I0.0 ou constante" : "Nom de variable, #locale ou %I0.0"
        }
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            // Ne pas soumettre le formulaire du snippet : Entrée applique seulement ce champ.
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") setText(shown);
        }}
        className={`${field} ${error ? "border-amber-700" : "border-slate-700 focus:border-sky-600"}`}
      />
      {error && <span className="mt-0.5 block text-[11px] text-amber-400">{error}</span>}
    </label>
  );
}

function Choice<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(o)}
          className={`rounded border px-2 py-0.5 font-mono text-xs ${
            o === value
              ? "border-sky-600 bg-sky-950 text-sky-200"
              : "border-slate-700 text-slate-400 hover:text-slate-200"
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

const COMPARE_OPS = ["==", "<>", ">", "<", ">=", "<="] as const;
const COILS = ["COIL", "NCOIL", "SET", "RESET"] as const;

/** Propriétés de l'élément sélectionné dans l'éditeur visuel. */
function ElementInspector({
  program,
  selected,
  onChange,
  onDeleted,
}: {
  program: LadProgram;
  selected: ElementRef;
  onChange: (program: LadProgram) => void;
  onDeleted: () => void;
}) {
  if (selected.kind === "output") {
    const output = program.networks[selected.network]?.rungs[selected.rung]?.outputs[selected.output];
    if (!output) return null;
    const removable = canRemoveOutput(program, selected);
    return (
      <Panel
        title="Bobine"
        onDelete={() => {
          onChange(removeOutput(program, selected));
          onDeleted();
        }}
        deleteDisabled={!removable}
        deleteHint="Un rung doit garder au moins une bobine (sauf s'il finit par une boîte)."
      >
        <Choice
          options={COILS}
          value={output.kind}
          onChange={(kind: CoilKind) => onChange(replaceOutput(program, selected, { ...output, kind }))}
        />
        <ValueField
          label="Opérande"
          value={output.operand.text}
          allowLiteral={false}
          onCommit={(v) =>
            v && v.kind !== "literal" && onChange(replaceOutput(program, selected, { ...output, operand: v }))
          }
        />
      </Panel>
    );
  }

  const expr = getExpr(program, selected);
  if (!expr) return null;
  const replace = (e: Expr) => onChange(replaceExpr(program, selected, e));
  const remove = () => {
    onChange(removeExpr(program, selected));
    onDeleted();
  };
  const operand = (v: Value | null) => (v && v.kind !== "literal" ? v : null);

  switch (expr.type) {
    case "contact":
      return (
        <Panel title="Contact" onDelete={remove}>
          <Choice
            options={["NO", "NC"] as const}
            value={expr.kind}
            onChange={(kind) => replace({ ...expr, kind })}
          />
          <ValueField
            label="Opérande"
            value={expr.operand.text}
            allowLiteral={false}
            onCommit={(v) => {
              const o = operand(v);
              if (o) replace({ ...expr, operand: o });
            }}
          />
        </Panel>
      );
    case "edge":
      return (
        <Panel title="Front" onDelete={remove}>
          <Choice
            options={["P", "N"] as const}
            value={expr.kind}
            onChange={(kind) => replace({ ...expr, kind })}
          />
          <ValueField
            label="Opérande"
            value={expr.operand.text}
            allowLiteral={false}
            onCommit={(v) => {
              const o = operand(v);
              if (o) replace({ ...expr, operand: o });
            }}
          />
          <ValueField
            label="Bit mémoire (MEM)"
            value={expr.memory.text}
            allowLiteral={false}
            onCommit={(v) => {
              const o = operand(v);
              if (o) replace({ ...expr, memory: o });
            }}
          />
        </Panel>
      );
    case "compare":
      return (
        <Panel title="Comparateur" onDelete={remove}>
          <ValueField
            label="Valeur 1"
            value={expr.left.text}
            allowLiteral
            onCommit={(v) => v && replace({ ...expr, left: v })}
          />
          <Choice
            options={COMPARE_OPS}
            value={expr.op}
            onChange={(op: CompareOp) => replace({ ...expr, op })}
          />
          <ValueField
            label="Valeur 2"
            value={expr.right.text}
            allowLiteral
            onCommit={(v) => v && replace({ ...expr, right: v })}
          />
        </Panel>
      );
    case "box": {
      const spec = BOX_SPECS[expr.box];
      return (
        <Panel title={`Boîte ${expr.box}`} onDelete={remove}>
          {expr.instance && (
            <ValueField
              label="Instance (DB ou #multi-instance)"
              value={expr.instance.text}
              allowLiteral={false}
              onCommit={(v) => {
                if (v && (v.kind === "global" || v.kind === "local")) replace({ ...expr, instance: v });
              }}
            />
          )}
          {[...spec.inputs, ...spec.outputs].map((name) => {
            const isOutput = spec.outputs.includes(name);
            const required = spec.required.includes(name);
            return (
              <ValueField
                key={name}
                label={`${name}${isOutput ? " (sortie)" : ""}`}
                value={expr.params[name]?.text ?? ""}
                allowLiteral={!isOutput}
                optional={!required}
                onCommit={(v) => {
                  const params = { ...expr.params };
                  if (v) params[name] = v;
                  else delete params[name];
                  replace({ ...expr, params });
                }}
              />
            );
          })}
        </Panel>
      );
    }
    default:
      return null;
  }
}

function Panel({
  title,
  children,
  onDelete,
  deleteDisabled = false,
  deleteHint,
}: {
  title: string;
  children: ReactNode;
  onDelete: () => void;
  deleteDisabled?: boolean;
  deleteHint?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-300">{title}</h4>
        <p className="text-[11px] text-slate-500">
          Entrée ou clic ailleurs pour appliquer. Pas besoin de guillemets pour une variable API.
        </p>
        <button
          type="button"
          onClick={onDelete}
          disabled={deleteDisabled}
          title={deleteDisabled ? deleteHint : "Supprimer (touche Suppr)"}
          className="ml-auto rounded border border-red-900 px-2 py-0.5 text-xs text-red-300 hover:bg-red-950 disabled:opacity-40"
        >
          Supprimer
        </button>
      </div>
      <div className="flex flex-wrap items-start gap-3">{children}</div>
    </div>
  );
}

const actionButton =
  "rounded border border-slate-600 px-2 py-0.5 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-40";

/** Bandeau de sélection : propriétés de l'élément, puis actions sur son rung. */
export function Inspector({
  program,
  selected,
  onChange,
  onReplaceSelection,
  onDeleted,
}: {
  program: LadProgram;
  selected: ElementRef;
  /** Modification qui garde la sélection (même adresse). */
  onChange: (program: LadProgram) => void;
  /** Modification qui change la sélection (élément créé, ou null). */
  onReplaceSelection: (program: LadProgram, focus: Expr | null) => void;
  onDeleted: () => void;
}) {
  const rung = program.networks[selected.network]?.rungs[selected.rung];
  if (!rung) return null;
  return (
    <div className="space-y-3">
      <ElementInspector program={program} selected={selected} onChange={onChange} onDeleted={onDeleted} />
      <div className="flex flex-wrap items-center gap-2 border-t border-slate-800 pt-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Rung</span>
        {selected.kind === "expr" && (
          <button
            type="button"
            className={actionButton}
            title="Ajoute un contact en parallèle de l'élément sélectionné (Maj + clic pour englober plusieurs éléments)"
            onClick={() => {
              const contact = newElement({ kind: "contact", variant: "NO" });
              onReplaceSelection(insertParallel(program, selected, contact), contact);
            }}
          >
            ⊐ Branche parallèle
          </button>
        )}
        <button
          type="button"
          className={`${actionButton} border-red-900 text-red-300 hover:bg-red-950`}
          onClick={() => onReplaceSelection(removeRung(program, selected.network, selected.rung), null)}
        >
          Supprimer le rung
        </button>
        <input
          key={`rung-comment-${rung.comment ?? ""}`}
          defaultValue={rung.comment ?? ""}
          placeholder="Commentaire du rung"
          onBlur={(e) => {
            if (e.target.value !== (rung.comment ?? "")) {
              onChange(setRungComment(program, selected.network, selected.rung, e.target.value));
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          className="min-w-64 flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-0.5 text-xs text-slate-300 italic focus:border-sky-600 focus:outline-none"
        />
      </div>
    </div>
  );
}

/** Bandeau quand plusieurs éléments en série sont sélectionnés (Maj + clic). */
export function RangeInspector({
  program,
  range,
  onChange,
  onClear,
}: {
  program: LadProgram;
  range: RangeRef;
  onChange: (program: LadProgram, focus: Expr | null) => void;
  onClear: () => void;
}) {
  const count = range.to - range.from + 1;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-300">
          {count} élément{count > 1 ? "s" : ""} en série sélectionné{count > 1 ? "s" : ""}
        </h4>
        <p className="text-[11px] text-slate-500">
          Une branche parallèle les englobera tous. Tu peux aussi glisser un symbole dans la zone sous la
          sélection.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={actionButton}
          onClick={() => {
            const contact = newElement({ kind: "contact", variant: "NO" });
            onChange(wrapParallel(program, range, contact), contact);
          }}
        >
          ⊐ Branche parallèle autour
        </button>
        <button
          type="button"
          className={`${actionButton} border-red-900 text-red-300 hover:bg-red-950`}
          onClick={() => onChange(removeRange(program, range), null)}
        >
          Supprimer la sélection
        </button>
        <button type="button" className={actionButton} onClick={onClear}>
          Désélectionner
        </button>
      </div>
    </div>
  );
}
